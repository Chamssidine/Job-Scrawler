import fs from "fs";
import 'dotenv/config'; 

import { crawlQueue } from './queue/setup.js';
import runDashboard from './queue/dashboard.js';
import './queue/worker.js';  

runDashboard();

async function startDiscovery(sitesData) {
  console.log(`🚀 Injection de ${sitesData.length} configs...`);
  
  const jobs = sitesData.map(site => {
    const safeJobId = site.url.replace(/[^a-zA-Z0-9]/g, '-');

    return {
      name: 'crawl-link',
      data: { 
        url: site.url, 
        depth: 0, 
        source: site.name || "unknown", 
        maxDepth: 2,
        schema: site.schema || null // <--- On injecte la config ici
      },
      opts: {
        jobId: safeJobId + Date.now(),  
        attempts: 3,
        backoff: 5000  
      }
    };
  });}
const sites = JSON.parse(fs.readFileSync("./data/sites.json"));
startDiscovery(sites);


 

