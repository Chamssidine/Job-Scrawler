import { Worker } from 'bullmq';
import { crawlPage } from '../crawler/crawlPage.js';
import { agentStep } from '../agent/orchestrator.js';
import { crawlQueue, defaultJobOptions } from './setup.js';

const worker = new Worker('crawl-tasks', async (job) => {
  const { url, depth, source, maxDepth } = job.data;
  
  console.log(`[Worker] Traitement de : ${url} (Depth: ${depth})`);

  
  const page = await crawlPage(url);
  if (!page) return;
  if (page.links && depth < maxDepth) {
    for (const link of page.links) {
      
      await crawlQueue.add('crawl-link', 
        { url: link, depth: depth + 1, source, maxDepth }, 
        defaultJobOptions
      );
    }
  }

   
  
}, { 
  connection: crawlQueue.connection,
  concurrency: 5  
});