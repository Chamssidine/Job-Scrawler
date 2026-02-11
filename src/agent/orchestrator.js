// orchestrator.js
import OpenAI from "openai";
import { crawlPage } from "../crawler/crawlPage.js";
import { writeResult } from "../storage/writeResult.js";
import "dotenv/config";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Fonction utilitaire pour convertir un schéma simple en JSON Schema pour OpenAI
function buildWriteTool(schema) {
  const defaultSchema = {
    title: { type: "string", description: "Le titre du poste ou de l'offre." },
    organization: { type: "string", description: "Le nom de l'entreprise ou de l'organisation." },
    email: { type: "string", description: "L'adresse email de contact pour postuler." },
    url: { type: "string", description: "L'URL de la page où l'offre a été trouvée." }
  };

  const schemaToUse = schema && Object.keys(schema).length > 0 ? schema : defaultSchema;

  const properties = {};
  const required = ["url"]; // L'URL est toujours requise

  // Ajouter l'URL à la liste des propriétés
  properties.url = { type: "string", description: "L'URL source de la donnée extraite" };

  for (const [key, description] of Object.entries(schemaToUse)) {
    // Si la clé existe déjà (ex: url), on ne la duplique pas
    if (!properties[key] && key !== 'url') { 
        properties[key] = { type: "string", description: typeof description === 'string' ? description : description.description };
        required.push(key);
    }
  }

  // Ajouter des champs par défaut si schéma minimal
  if (!properties.title) properties.title = { type: "string", description: "Titre de l'offre" };
  if (!properties.organization) properties.organization = { type: "string", description: "Organisation/Entreprise" };

  return {
    type: "function",
    function: {
      name: "write_result",
      description: "Sauvegarde les données structurées extraites d'une page web.",
      parameters: {
        type: "object",
        properties: {
          data: {
            type: "object",
            properties: properties,
            // Filtre pour s'assurer que le `required` ne contient que des clés valides
            required: required.filter(r => properties[r]) 
          }
        },
        required: ["data"]
      }
    }
  };
}

export async function agentStep(state, messages, customSchema = null, options = {}) {
  const { allowCrawlTool = true } = options;
  
  const tools = [
    // Optionnellement inclure l'outil de crawl
    ...(allowCrawlTool ? [{
      type: "function",
      function: {
        name: "crawl_page",
        description: "Explore une URL pour en analyser le contenu.",
        parameters: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"]
        }
      }
    }] : []),
    // Outil d'écriture dynamique
    buildWriteTool(customSchema)
  ];

  // Appel OpenAI
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini", 
    messages,
    tools: tools,
    tool_choice: "auto"
  });

  const msg = response.choices[0].message;

  if (msg.tool_calls && msg.tool_calls.length > 0) {
    console.log(`🔧 IA appelle: ${msg.tool_calls.map(c => c.function.name).join(', ')}`);
    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments || "{}");

      if (call.function.name === "crawl_page") {
        try {
          const page = await crawlPage(args.url);
          return { type: "CRAWL", data: page };
        } catch (error) {
          return { type: "CRAWL", data: null };
        }
      }

      if (call.function.name === "write_result") {
        const data = args.data;
        console.log(`✍️ write_result: title="${data.title}", email="${data.email}", url="${data.url}"`);
        await writeResult(data);
        return { type: "DONE" };
      }
    }
  }

  // Gestion des décisions de navigation (inchangé)
  if (msg.content) {
      try {
          const parsed = JSON.parse(msg.content);
          if (parsed.decision) {
              return {
                  type: "DECISION",
                  decision: parsed.decision,
                  targets: parsed.targets || [],
                  reason: parsed.reason || ""
              };
          }
      } catch (e) {
          // Si le message n'est pas un JSON de décision, on le considère comme une erreur ou un message simple
          return { type: "DECISION", decision: "REJECT", reason: "Réponse non structurée de l'IA" };
      }
  }

  return { type: "DECISION", decision: "STOP", reason: "Aucune action ou outil choisi par l'IA." };
}
