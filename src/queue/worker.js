import { Worker } from 'bullmq';
import { connection, crawlQueue } from './setup.js';
import { crawlPage } from '../crawler/crawlPage.js';
import { agentStep } from '../agent/orchestrator.js';
import computeScore from './scoring.js';
import { SYSTEM_PROMPT } from '../agent/prompt.js';

const worker = new Worker('job-crawler', async (job) => {
  const { url, depth, source, maxDepth } = job.data;
  const state = { visited: new Set(), depth, source }; // Pour la compatibilité agentStep

  console.log(`\x1b[36m[Worker]\x1b[0m Analyse de : ${url} (Profondeur: ${depth})`);

 
  const page = await crawlPage(url);
  if (!page || !page.url) return;

 
  if (page.links && depth < maxDepth) {
    for (const link of page.links) {
      
      await crawlQueue.add('crawl-link', {
        url: link,
        depth: depth + 1,
        source,
        maxDepth
      }, { attempts: 2 });
    }
  }

 
  const scoring = computeScore(page);
  
  
  const decision = await agentStep(state, [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify({
        action: "ANALYZE_PAGE",
        page: { ...page, links: "[Filtered]" },
        scoring
      })
    }
  ]);

  return { status: 'completed', url: page.url, decision: decision.type };

}, { 
  connection, 
  concurrency: 5  
});

worker.on('completed', (job) => console.log(`\x1b[32m✔ Job ${job.id} terminé\x1b[0m`));
worker.on('failed', (job, err) => console.error(`\x1b[31m✘ Job ${job.id} échoué: ${err.message}\x1b[0m`));