import fs from "fs";
import 'dotenv/config'; 

import { crawlQueue } from './queue/setup.js';

async function startDiscovery(urls) {
  console.log(`🚀 Injection de ${urls.length} URLs dans la file d'attente...`);
  
  const jobs = urls.map(url => ({
    name: 'crawl-link',
    data: { 
      url, 
      depth: 0, 
      source: 'Batch-Initial', 
      maxDepth: 2 
    }
  }));

  await crawlQueue.addBulk(jobs);
  console.log("✅ Toutes les URLs sont dans Redis. Les Workers vont commencer le travail.");
}

const sites = JSON.parse(fs.readFileSync("./data/sites.json"));
startDiscovery(sites);


 

