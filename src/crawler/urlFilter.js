import "dotenv/config";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function filterUrlsWithAI(links, currentUrl) {
  if (links.length === 0) return [];

  // 1️⃣ NETTOYAGE PRÉ-IA (Économie massive de tokens)
  const noiseRegex = /\.(png|jpg|jpeg|gif|svg|pdf|zip|docx|css|js)$/i;
  const adminRegex = /(login|register|password|cart|checkout|my-account|impressum|datenschutz|privacy|cookies|contact|kontakt|presse|help|faq|social|facebook|twitter|linkedin|instagram|google)/i;

  const preFiltered = [...new Set(links)].filter(link => {
    return !noiseRegex.test(link) && !adminRegex.test(link);
  });

  if (preFiltered.length === 0) return [];

 
  const CHUNK_SIZE = 50;
  const chunks = [];
  for (let i = 0; i < preFiltered.length; i += CHUNK_SIZE) {
    chunks.push(preFiltered.slice(i, i + CHUNK_SIZE));
  }

  console.log(`🤖 IA : Analyse de ${preFiltered.length} liens en ${chunks.length} lots parallèles...`);

 
  try {
    const promises = chunks.map(async (chunk, index) => {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Tu es un expert en recrutement.
            Sélectionne UNIQUEMENT :
            1. Les offres d'emploi (job details).
            2. Les listes d'offres (job listings).
            Réponds uniquement en JSON : {"valid_urls": []}`
          },
          {
            role: "user",
            content: `Source: ${currentUrl}\nURLs : ${JSON.stringify(chunk)}`
          }
        ],
        response_format: { type: "json_object" }
      });

      const data = JSON.parse(response.choices[0].message.content);
      return data.valid_urls || [];
    });

  
    const results = await Promise.all(promises);
    
 
    const finalUrls = results.flat();

    console.log(`✅ Filtrage terminé : ${finalUrls.length} retenus.`);
    return finalUrls;

  } catch (error) {
    console.error("❌ Erreur lors du filtrage parallèle :", error.message);
 
    return preFiltered.slice(0, 10); 
  }
}