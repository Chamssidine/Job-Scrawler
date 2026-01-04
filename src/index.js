import fs from "fs";
import 'dotenv/config'; 

import { crawlQueue } from './queue/setup.js';
import runDashboard from './queue/dashboard.js';
import './queue/worker.js';  

runDashboard();

async function startDiscovery(sitesData) {
  console.log(`🚀 Injection de ${sitesData.length} URLs...`);
  
  const jobs = sitesData.map(site => {
    
    const safeJobId = site.url.replace(/:/g, '-');

    return {
      name: 'crawl-link',
      data: { 
        url: site.url, 
        depth: 0, 
        source: site.name || "unknown", 
        maxDepth: 2 
      },
      opts: {
        jobId: safeJobId,  
        attempts: 3,
        backoff: 5000  
      }
    };
  });

  await crawlQueue.addBulk(jobs);
  console.log("✅ Toutes les URLs sont dans Redis.");
}
const sites = JSON.parse(fs.readFileSync("./data/sites.json"));
startDiscovery(sites);


 

