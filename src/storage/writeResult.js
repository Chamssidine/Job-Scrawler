import fs from "fs/promises";
import path from "path";

const FILE_PATH = path.join(process.cwd(), "results.json");

export async function writeResult(job) {
  // 1. Sécurité : Vérifier si job existe
  if (!job) {
    console.error("❌ writeResult appelé sans données 'job'");
    return;
  }

  try {
    // 2. Lire le fichier existant
    let data = [];
    try {
      const content = await fs.readFile(FILE_PATH, "utf-8");
      data = JSON.parse(content);
    } catch (e) {
      // Si le fichier n'existe pas, on commence avec un tableau vide
      data = [];
    }

    // 3. Vérifier les doublons avec sécurité (le crash était ici)
    const jobUrl = job.url || "";
    const exists = data.some(existingJob => existingJob && existingJob.url === jobUrl);

    if (!exists) {
      data.push({
        ...job,
        extracted_at: new Date().toISOString()
      });
      
      await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2));
      console.log(`\x1b[32m%s\x1b[0m`, `✅ OFFRE SAUVEGARDÉE : ${job.title || "Sans titre"}`);
    } else {
      console.log(`\x1b[33m%s\x1b[0m`, `ℹ️ Offre déjà existante : ${jobUrl}`);
    }
  } catch (error) {
    console.error("❌ Erreur dans writeResult:", error.message);
  }
}