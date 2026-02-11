import fs from "fs/promises";
import path from "path";
import { normalizeUrl } from "../core/url.js";

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

  // Normaliser URL
  if (sanitizedJob.url) sanitizedJob.url = normalizeUrl(sanitizedJob.url);

  // S'assurer que les champs essentiels sont présents après nettoyage
  if (!sanitizedJob.url) {
      console.warn("ℹ️ Job ignoré car il manque une URL après nettoyage.", sanitizedJob);
      return;
  }

  // Vérifier qu'on a au moins un titre ou une organisation
  const hasTitle = sanitizedJob.title || sanitizedJob.name || sanitizedJob.organization;
  if (!hasTitle) {
      // Relax: si on a une URL et du contenu, on écrit quand même
      console.warn("⚠️ Job ignoré: pas de titre/organisation, mais URL présente:", sanitizedJob.url);
      // Au lieu de retourner, on peut ajouter un titre par défaut
      // return;
  }

  try {
    console.log(`📝 writeResult: ${sanitizedJob.title || sanitizedJob.url}`);
    // 2. Lire le fichier existant ou le créer (avec backup si corrompu)
    let data = [];
    try {
      const content = await fs.readFile(FILE_PATH, "utf-8");
      if (content.trim()) {
        try {
          data = JSON.parse(content);
        } catch (parseErr) {
          const backupName = `${FILE_PATH}.bak.${Date.now()}.json`;
          await fs.writeFile(backupName, content);
          console.error(`Fichier résultats corrompu, backup créé: ${backupName}. Réinitialisation.`);
          data = [];
          await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2));
        }
      }
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error(`Erreur en lisant ${FILE_PATH}:`, e);
      }
      data = [];
    }

    // 3. Upsert par URL (merge si existe déjà)
    const idx = data.findIndex(existingJob => existingJob && existingJob.url === sanitizedJob.url);

    if (idx === -1) {
      data.push({
        ...sanitizedJob,
        extracted_at: new Date().toISOString()
      });
      await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2));
      console.log(`\x1b[32m%s\x1b[0m`, `✅ RÉSULTAT SAUVEGARDÉ : ${sanitizedJob.title || sanitizedJob.url}`);
    } else {
      const current = data[idx] || {};
      const merged = { ...current };
      for (const [k, v] of Object.entries(sanitizedJob)) {
        if (k === 'extracted_at') continue;
        if (v !== undefined && v !== null && v !== '') {
          merged[k] = v;
        }
      }
      // Conserver la date d'extraction originale, ajouter updated_at
      merged.extracted_at = current.extracted_at || new Date().toISOString();
      merged.updated_at = new Date().toISOString();
      data[idx] = merged;
      await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2));
      console.log(`\x1b[36m%s\x1b[0m`, `🔄 RÉSULTAT MIS À JOUR : ${merged.title || merged.url}`);
    }
  } catch (error) {
    console.error("❌ Erreur critique dans writeResult:", error.message);
  }
}
