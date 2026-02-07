// orchestrator.js
import OpenAI from "openai";
import { crawlPage } from "../crawler/crawlPage.js";
import { writeResult } from "../storage/writeResult.js";
import "dotenv/config";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Fonction utilitaire pour convertir votre schema simple en JSON Schema OpenAI
function buildDynamicTool(schema) {
  const properties = {};
  const required = ["url"]; // L'URL est toujours obligatoire

  // On ajoute toujours l'URL
  properties.url = { type: "string", description: "L'URL de la page analysée" };

  for (const [key, desc] of Object.entries(schema)) {
    properties[key] = { type: "string", description: desc };
    required.push(key);
  }

  return {
    name: "write_result",
    description: "Sauvegarde les données extraites selon le schéma demandé.",
    parameters: {
      type: "object",
      properties: {
        data: {
          type: "object",
          properties: properties,
          required: required
        }
      },
      required: ["data"]
    }
  };
}

export async function agentStep(state, messages, customSchema = null) {
  
  // 1. Définir les outils de base
  const tools = [
    {
      type: "function",
      function: {
        name: "crawl_page",
        description: "Crawl une URL et retourne son contenu analysé",
        parameters: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"]
        }
      }
    }
  ];

  // 2. Ajouter l'outil d'écriture dynamique
  // Si un schéma personnalisé est fourni dans le Job, on l'utilise
  // Sinon on garde le schéma par défaut (Jobs)
  let writeTool;
  if (customSchema) {
    writeTool = {
      type: "function",
      function: buildDynamicTool(customSchema)
    };
  } else {
    // Fallback : Ancien schéma (Jobs FSJ)
    writeTool = {
      type: "function",
      function: {
        name: "write_result",
        description: "Enregistre une offre de volontariat",
        parameters: {
          type: "object",
          properties: {
            data: { // Note: j'ai uniformisé sous la clé "data"
              type: "object",
              properties: {
                title: { type: "string" },
                organization: { type: "string" },
                email: { type: "string" },
                url: { type: "string" }
              },
              required: ["title", "email"]
            }
          }
        }
      }
    };
  }
  
  tools.push(writeTool);

  // 3. Appel OpenAI
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini", 
    messages,
    tools: tools,
    tool_choice: "auto"
  });

  const msg = response.choices[0].message;

  // 4. Gestion des Outils
  if (msg.tool_calls && msg.tool_calls.length > 0) {
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
        // args.data contient maintenant les champs dynamiques (prix, titre, etc.)
        // On ajoute le type pour le tri dans le JSON final
        const resultToSave = {
           ...args.data,
           _type: customSchema ? "custom" : "job" // Marqueur interne
        };
        
        await writeResult(resultToSave);
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
          return { type: "DECISION", decision: "REJECT", reason: "JSON invalide" };
      }
  }

  return { type: "DECISION", decision: "STOP", reason: "No action" };
}