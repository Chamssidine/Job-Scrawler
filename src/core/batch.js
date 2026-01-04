import { run } from "./loop.js";

export async function runBatch(sites) {
  for (const site of sites) {
    console.log(`\n=== DÉMARRAGE : ${site.name} ===`);
    await run(site.url, site.name);
    console.log(`=== FIN : ${site.name} ===\n`);
  }
}
