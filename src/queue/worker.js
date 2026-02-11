import { Worker } from 'bullmq';
import crypto from 'crypto';
import { normalizeUrl } from '../core/url.js';
import { connection, crawlQueue } from './setup.js';
import { crawlPage } from '../crawler/crawlPage.js';
import { agentStep } from '../agent/orchestrator.js';
import { generateSystemPrompt } from '../agent/prompt.js'; // Importer la nouvelle fonction
import computeScore from '../core/scoring.js';
import { writeResult } from '../storage/writeResult.js';

const worker = new Worker('job-crawler', async (job) => {
  const { url, depth, source, maxDepth, schema } = job.data;
  const childLimit = parseInt((job.data?.childLimit ?? process.env.CHILD_LIMIT ?? '20'), 10);
  
  const state = { visited: new Set(), depth, source };

  console.log(`\x1b[36m[Worker]\x1b[0m Analyse (${source}): ${url}`);

  const page = await crawlPage(url);
  if (!page || !page.url) return;

  const buildJobId = (link, src, d) => {
    const h = crypto.createHash('md5').update(link).digest('hex');
    const s = (src || '').toString().replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const depthStr = String(d).replace(/[^0-9]/g, '');
    // BullMQ n'autorise pas ':' dans les custom IDs
    return `child-${s}-${depthStr}-${h}`;
  };

  // Propagation du schéma aux enfants (liens suivis)
  if (Array.isArray(page.links) && page.links.length && depth < maxDepth) {
    console.log(`📎 Enqueue enfants: depth=${depth}/${maxDepth} links=${page.links.length}`);
    const results = await Promise.allSettled(page.links.slice(0, childLimit).map(async (rawLink) => {
      const link = normalizeUrl(rawLink);
      return crawlQueue.add('crawl-link', {
        url: link,
        depth: depth + 1,
        source,
        maxDepth,
        schema // On transmet le schéma aux enfants
      }, {
        jobId: buildJobId(link, source, depth + 1),
        attempts: 2,
        removeOnComplete: true
      });
    }));
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const rejected = results.filter(r => r.status === 'rejected');
    const dup = rejected.length;
    if (dup) console.log(`🔁 Enqueue enfants: ${ok} ok, ${dup} rejetés. Reasons: `,
      rejected.slice(0,3).map(r => r.reason?.message || r.reason));
  } else {
    console.log(`📎 Aucun enfant enfilé: depth=${depth}, links=${Array.isArray(page.links)?page.links.length:0}`);
  }

  // Helper d'analyse d'une page pour éviter les redites
  const analyzePage = async (pg) => {
    const scoring = computeScore(pg);
    const currentSystemPrompt = generateSystemPrompt(schema);
    const decision = await agentStep(
      state,
      [
        { role: "system", content: currentSystemPrompt },
        {
          role: "user",
          content: JSON.stringify({ action: "ANALYZE_PAGE", page: { ...pg, links: "[Filtered]" }, scoring })
        }
      ],
      schema,
      { allowCrawlTool: false }
    );
    return { decision, scoring, analyzedPage: pg };
  };

  let { decision, scoring: lastScoring, analyzedPage: currentPage } = await analyzePage(page);

  // Si l'IA demande un crawl supplémentaire, on l'exécute puis on réanalyse la page crawlée
  let safety = 0;
  while (decision && decision.type === 'CRAWL' && decision.data && safety < 3) {
    console.log(`\x1b[36m[→ Crawl supplémentaire]\x1b[0m`);
    const crawled = decision.data;

    // Enqueue les liens trouvés si on peut encore descendre
    if (crawled.links && depth < maxDepth) {
      for (const link of crawled.links) {
        try {
          await crawlQueue.add('crawl-link', {
            url: link,
            depth: depth + 1,
            source,
            maxDepth,
            schema
          }, { jobId: buildJobId(link, source, depth + 1), attempts: 2, removeOnComplete: true });
        } catch {}
      }
    }

    ({ decision, scoring: lastScoring, analyzedPage: currentPage } = await analyzePage(crawled));
    safety++;
  }

  if (decision && decision.type === 'CRAWL') {
    // Si l'IA persiste à demander un crawl alors qu'il est désactivé, on convertit en FOLLOW sur liens connus
    if (page.links && page.links.length && depth < maxDepth) {
      console.log(`\x1b[33m[⚠️ Conversion CR\u00c1WL→FOLLOW]\x1b[0m ${page.links.length} liens`);
      for (const link of page.links) {
        try {
          await crawlQueue.add('crawl-link', { url: link, depth: depth + 1, source, maxDepth, schema }, { jobId: link, removeOnComplete: true });
        } catch {}
      }
    }
  } else if (decision && decision.type === 'DONE') {
    console.log(`\x1b[32m[✅ Résultat sauvegardé]\x1b[0m ${page.url}`);
    try {
      const j = currentPage?.job || {};
      const enriched = {
        url: currentPage?.url || page.url,
        title: j.title || currentPage?.title,
        organization: j.organization,
        location: j.location,
        description: j.description,
        date_posted: j.date_posted,
        valid_through: j.valid_through,
        apply_url: j.apply_url,
        email: Array.isArray(currentPage?.emails) && currentPage.emails.length ? currentPage.emails[0] : undefined,
        score: lastScoring?.score,
        reasons: lastScoring?.reasons,
        source
      };
      await writeResult(enriched);
    } catch {}
  } else if (decision && decision.type === 'DECISION') {
    console.log(`\x1b[33m[⚠️ Décision IA: ${decision.decision}]\x1b[0m ${decision.reason || ''}`);
    if (decision.decision === 'FOLLOW') {
      let enqueued = 0;
      const targets = Array.isArray(decision.targets) ? decision.targets : [];
      console.log(`\x1b[36m[→ FOLLOW] targets=${targets.length} | page.links=${Array.isArray(page.links) ? page.links.length : 0}\x1b[0m`);

      // 1) Suivre les targets explicitement fournis par l'IA
      for (const rawLink of targets.slice(0, childLimit)) {
        const link = normalizeUrl(rawLink);
        try {
          await crawlQueue.add('crawl-link', {
            url: link,
            depth: Math.min(depth + 1, maxDepth),
            source,
            maxDepth,
            schema
          }, { jobId: buildJobId(link, source, Math.min(depth+1,maxDepth)), attempts: 2, removeOnComplete: true });
          enqueued++;
        } catch {}
      }

      // 2) Fallback: si l'IA n'a pas renvoyé de targets, utiliser les liens filtrés de la page
      if (enqueued === 0 && Array.isArray(page.links) && page.links.length && depth < maxDepth) {
        for (const rawLink of page.links.slice(0, childLimit)) {
          const link = normalizeUrl(rawLink);
          try {
            await crawlQueue.add('crawl-link', {
              url: link,
              depth: depth + 1,
              source,
              maxDepth,
              schema
            }, { jobId: buildJobId(link, source, depth + 1), attempts: 2, removeOnComplete: true });
            enqueued++;
          } catch {}
        }
      }
      console.log(`\x1b[36m[→ FOLLOW] ${enqueued} liens enfilés\x1b[0m`);
    }
  }

  return { status: 'completed', url: page.url, decision: decision?.type || 'UNKNOWN' };

}, { 
  connection, 
  concurrency: 5,
  // Limiteur global: au plus 10 jobs traités par seconde
  limiter: { max: 10, duration: 1000 }
});

export default worker;

// --- Verbose Worker Event Logging ---
worker.on('active', (job) => {
  console.log(`🟦 [Active] ${job.name} ${job.id} url=${job.data?.url || ''}`);
});
worker.on('completed', (job, result) => {
  console.log(`🟩 [Completed] ${job.name} ${job.id} ->`, result);
});
worker.on('failed', (job, err) => {
  console.error(`🟥 [Failed] ${job?.name} ${job?.id} : ${err?.message || err}`);
});
