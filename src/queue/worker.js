import { Worker } from 'bullmq';
import { connection, crawlQueue } from './setup.js';
import { crawlPage } from '../crawler/crawlPage.js';
import { agentStep } from '../agent/orchestrator.js'; // Notez que nous n'importons plus SYSTEM_PROMPT statique
import computeScore from '../core/scoring.js';

// Fonction pour générer le prompt système dynamiquement
const generatePrompt = (schema) => {
  if (!schema) {
    // Prompt par défaut (votre ancien prompt FSJ)
    return `ROLE: Tu es un expert en recrutement FSJ. Cherche des offres d'emploi.`;
  }
  
  // Prompt dynamique
  const fields = Object.keys(schema).join(", ");
  return `
    ROLE: Tu es un extracteur de données universel.
    
    TA MISSION:
    Tu analyses le contenu HTML pour trouver des éléments correspondant à ce schéma : ${fields}.
    
    RÈGLES:
    1. Si tu trouves les données demandées sur la page courante -> Utilise l'outil "write_result".
    2. Si tu vois une liste de liens qui pourraient mener aux données -> Renvoie un JSON { "decision": "FOLLOW", "targets": [...] }.
    3. Sinon -> { "decision": "REJECT" }.
  `;
};

const worker = new Worker('job-crawler', async (job) => {
  // On récupère le schema depuis job.data
  const { url, depth, source, maxDepth, schema } = job.data;
  
  const state = { visited: new Set(), depth, source };

  console.log(`\x1b[36m[Worker]\x1b[0m Analyse (${source}): ${url}`);

  const page = await crawlPage(url);
  if (!page || !page.url) return;

  // Propagation du schéma aux enfants (liens suivis)
  if (page.links && depth < maxDepth) {
    for (const link of page.links) {
      await crawlQueue.add('crawl-link', {
        url: link,
        depth: depth + 1,
        source,
        maxDepth,
        schema: schema // <--- IMPORTANT : On transmet le schéma aux enfants
      }, { attempts: 2 });
    }
  }

  const scoring = computeScore(page);
  
  // Génération du prompt dynamique
  const currentSystemPrompt = generatePrompt(schema);

  const decision = await agentStep(
    state, 
    [
      { role: "system", content: currentSystemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          action: "ANALYZE_PAGE",
          page: { ...page, links: "[Filtered]" }, // On économise des tokens
          scoring
        })
      }
    ],
    schema // <--- On passe le schéma à l'orchestrateur pour construire l'outil
  );

  return { status: 'completed', url: page.url, decision: decision.type };

}, { connection, concurrency: 5 });

export default worker;