import "dotenv/config";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function filterUrlsWithAI(links, currentUrl) {
  if (links.length === 0) return [];

  // On retire les doublons éventuels au cas où
  const uniqueLinks = [...new Set(links)];
  
  // On limite le traitement à 50 liens max pour la précision de l'IA
  // Si tu en as plus, on peut faire deux lots, mais 50 c'est déjà énorme.
  const linksToProcess = uniqueLinks.slice(0, 50);

  console.log(`🤖 IA : Analyse groupée de ${linksToProcess.length} URLs pour ${currentUrl}...`);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Tu es un expert en recrutement et structure web.
          Ta mission : Analyser une liste d'URLs et sélectionner uniquement celles qui sont :
          1. Des offres d'emploi individuelles (Job details).
          2. Des listes d'offres d'emploi (Job boards/listings).

          RÈGLES :
          - Exclus tout ce qui est administratif (contact, impressum, aide, réseaux sociaux).
          - Réponds uniquement au format JSON : {"valid_urls": ["url1", "url2"]}`
        },
        {
          role: "user",
          content: `Page source : ${currentUrl}\nURLs à filtrer : ${JSON.stringify(linksToProcess)}`
        }
      ],
      response_format: { type: "json_object" } // Force la réponse en JSON
    });

    const result = JSON.parse(response.choices[0].message.content);
    const validUrls = result.valid_urls || [];

    console.log(`✅ Filtrage AI terminé : ${validUrls.length} retenues sur ${linksToProcess.length}.`);
    
    return validUrls;

  } catch (error) {
    console.error("❌ Erreur lors du filtrage AI groupé :", error.message);
    // En cas d'erreur (timeout, quota), on retourne la liste brute pour ne pas bloquer le crawler
    return linksToProcess;
  }
}