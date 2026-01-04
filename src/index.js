import fs from "fs";
import { runBatch } from "./core/batch.js";
import 'dotenv/config'; 
import { exploreDepth } from "./agent/depthExplorer.js";

const sites = JSON.parse(fs.readFileSync("./data/sites.json"));

//await exploreDepth("https://www.bundesfreiwilligendienst.de/bundesfreiwilligendienst/platz-einsatzstellensuche/einsatzstelle-suchen/");
await runBatch(sites);

