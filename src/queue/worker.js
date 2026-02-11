import { Worker } from 'bullmq';
import { connection, crawlQueue } from './setup.js';
import { crawlPage } from '../crawler/crawlPage.js';
import { agentStep } from '../agent/orchestrator.js';
import { generateSystemPrompt } from '../agent/prompt.js'; // Importer la nouvelle fonction
import computeScore from '../core/scoring.js';

const worker = new Worker('job-crawler', async (job) => {
  const { url, depth, source, maxDepth, schema } = job.data;
  
  const state = { visited: new Set(), depth, source };

  console.log(`\x1b[36m[Worker]\x1b[0m Analyse (${source}): ${url}`);

  const page = await crawlPage(url);
  if (!page || !page.url) return;

  // Propagation du schéma aux enfants (liens suivis)
  if (page.links && depth < maxDepth) {
    for (const link of page.links) {
      try {
        await crawlQueue.add('crawl-link', {
          url: link,
          depth: depth + 1,
          source,
          maxDepth,
          schema: schema // On transmet le schéma aux enfants
        }, {
          jobId: link, // Déduplication simple basée sur l'URL
          attempts: 2,
          removeOnComplete: true
        });
      } catch (e) {
        // Si job déjà existant (même jobId), on ignore calmement
      }
    }
  }

  const scoring = computeScore(page);
  
  // Génération du prompt dynamique en utilisant la nouvelle fonction
  const currentSystemPrompt = generateSystemPrompt(schema);

  const decision = await agentStep(
    state, 
    [
      { role: "system", content: currentSystemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          action: "ANALYZE_PAGE",
          page: { ...page, links: "[Filtered]" }, 
          scoring
        })
      }
    ],
    schema 
  );

  return { status: 'completed', url: page.url, decision: decision.type };

}, { 
  connection, 
  concurrency: 5,
  // Limiteur global: au plus 10 jobs traités par seconde
  limiter: { max: 10, duration: 1000 }
});

export default worker;
