import fs from "fs/promises";
import path from "path";

// --- CORRECT FILE PATH ---
const FILE_PATH = path.join(process.cwd(), "data", "results.json");

export async function writeResult(job) {
  // 1. Sécurité : Vérifier si job existe et a des propriétés essentielles
  if (!job || typeof job !== 'object') {
    console.error("❌ writeResult a été appelé avec des données invalides.");
    return;
  }

  // Nettoyer les données du job pour éviter les corruptions JSON
  const sanitizedJob = {};
  for (const key in job) {
    if (typeof job[key] === 'string') {
      // Retire les caractères de contrôle et les espaces superflus
      sanitizedJob[key] = job[key].replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();
    } else {
      sanitizedJob[key] = job[key];
    }
  }

  // S'assurer que les champs essentiels sont présents après nettoyage
  if (!sanitizedJob.url) {
      console.warn("ℹ️ Job ignoré car il manque une URL après nettoyage.", sanitizedJob);
      return;
  }

  try {
    // 2. Lire le fichier existant ou le créer
    let data = [];
    try {
      const content = await fs.readFile(FILE_PATH, "utf-8");
      if (content.trim()) { // S'assurer que le fichier n'est pas vide
          data = JSON.parse(content);
      }
    } catch (e) {
      if (e.code !== 'ENOENT') { // Ignorer si le fichier n'existe pas, mais logguer les autres erreurs
          console.error(`Erreur en lisant ${FILE_PATH}:`, e);
      }
      // Si le fichier n'existe pas ou est corrompu/vide, on commence avec un tableau vide.
      data = [];
    }

    // 3. Vérifier les doublons en se basant sur l'URL nettoyée
    const exists = data.some(existingJob => existingJob && existingJob.url === sanitizedJob.url);

    if (!exists) {
      data.push({
        ...sanitizedJob,
        extracted_at: new Date().toISOString() // Utiliser extracted_at comme standardisé
      });
      
      await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2));
      console.log(`\x1b[32m%s\x1b[0m`, `✅ RÉSULTAT SAUVEGARDÉ : ${sanitizedJob.title || sanitizedJob.url}`);
    } else {
      // Optionnel: loguer si l'offre existe déjà
      // console.log(`\x1b[33m%s\x1b[0m`, `ℹ️ Résultat déjà existant : ${sanitizedJob.url}`);
    }
  } catch (error) {
    console.error("❌ Erreur critique dans writeResult:", error.message);
  }
}
