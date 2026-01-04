// orchestrator.js
import OpenAI from "openai";
import { crawlPage } from "../crawler/crawlPage.js";
import { writeResult } from "../storage/writeResult.js";
import "dotenv/config";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function agentStep(state, messages) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini", 
    messages,
    tools: [
      {
        type: "function",
        function: {
          name: "crawl_page",
          description: "Crawl eine URL und retourne son contenu analysé",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string" }
            },
            required: ["url"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "write_result",
          description: "Enregistre une offre de volontariat complète une fois identifiée",
          parameters: {
            type: "object",
            properties: {
              job: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Le titre de la mission (ex: FSJ dans une école)" },
                  organization: { type: "string", description: "Le nom de la structure d'accueil" },
                  location: { type: "string", description: "La ville ou le code postal" },
                  email: { type: "string", description: "L'email de contact trouvé" },
                  url: { type: "string", description: "L'URL de la page actuelle" },
                  description: { type: "string", description: "Un court résumé de la mission" }
                },
                required: ["title", "organization", "email", "url"]
              }
            },
            required: ["job"]
          }
        }
      }
    ],
    tool_choice: "auto"
  });

  const msg = response.choices[0].message;

  if (msg.tool_calls && msg.tool_calls.length > 0) {
    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments || "{}");

      if (call.function.name === "crawl_page") {
        try {
          const page = await crawlPage(args.url);
          
          // WICHTIG: Falls page null ist, geben wir trotzdem ein Objekt zurück, 
          // damit loop.js nicht abstürzt
          return {
            type: "CRAWL",
            data: page // page kann null sein, das ist ok für loop.js
          };
        } catch (error) {
          console.error(`❌ Fehler im Tool crawl_page: ${error.message}`);
          return { type: "CRAWL", data: null };
        }
      }

      if (call.function.name === "write_result") {
        const args = JSON.parse(call.function.arguments || "{}");

        const jobData = args.job || args;
        await writeResult(jobData);
        return { type: "DONE" };
      }
    }
  }

  // ... (Rest deines Codes für CAS 2 und Fallback)
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
          return { type: "DECISION", decision: "REJECT", reason: "Format JSON invalide" };
      }
  }

  return { type: "DECISION", decision: "STOP", reason: "No action" };
}