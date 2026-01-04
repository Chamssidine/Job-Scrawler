// loop.js
import { agentStep } from "../agent/orchestrator.js";
import { logProgress } from "./logger.js";
import computeScore from "./scoring.js";
import { SYSTEM_PROMPT } from "../agent/prompt.js";
import { URL } from "url";

export async function run(startUrl, sourceName) {
  const state = {
    visited: new Set(),
    queue: [startUrl],
    depth: 0,
    source: sourceName,
    maxDepth: 2
  };

  const messages = [
    { role: "system", content: SYSTEM_PROMPT }
  ];

  while (state.queue.length > 0) {
    const currentUrl = state.queue.shift();
    if (state.visited.has(currentUrl)) continue;

    logProgress(state, `Crawling : ${currentUrl}`);

    // 1️⃣ Demander le crawl
    const step = await agentStep(state, [
      ...messages,
      {
        role: "user",
        content: JSON.stringify({
          action: "CRAWL_URL",
          url: currentUrl,
          depth: state.depth
        })
      }
    ]);

    if (step.type === "CRAWL") {
      const page = step.data;

      if (!page || !page.url) {
        logProgress(state, `⚠️ Échec ou page vide : ${currentUrl}`);
        state.visited.add(currentUrl);
        continue;
      }

      state.visited.add(page.url);
   
      if (page.links && page.links.length > 0 && state.depth < state.maxDepth) {
        let addedCount = 0;
        for (const link of page.links) {
          if (!state.visited.has(link) && !state.queue.includes(link)) {
            state.queue.push(link);
            addedCount++;
          }
        }
        logProgress(state, `➕ ${addedCount} nouveaux liens ajoutés à la queue`);
      }
 
      const scoring = computeScore(page);
      logProgress(state, `Score=${scoring.score} | Emails: ${page.emails.length}`);

      const decision = await agentStep(state, [
        ...messages,
        {
          role: "user",
          content: JSON.stringify({
            action: "ANALYZE_PAGE",
            page: { ...page, links: "[Filtered]" },  
            scoring
          })
        }
      ]);

      if (decision.type === "DECISION" && decision.decision === "ACCEPT") {
        logProgress(state, "✅ Offre acceptée et enregistrée !");
        
        return; 
      }
      if (decision.type === "DONE") {
        logProgress(state, "✅ Offre traitée et sauvegardée.");
        continue; // On passe à l'URL suivante dans la queue
      }

      if (decision.type === "DECISION") {
        logProgress(state, `Décision IA : ${decision.decision} – ${decision.reason || ""}`);
      }

      logProgress(state, `Décision IA : ${decision.decision}`);
      
 
      state.depth++;
    }

    if (step.type === "DONE") return;
  }

  logProgress(state, "Fin du processus : queue vide.");
}