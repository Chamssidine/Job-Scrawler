import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { crawlQueue } from './setup.js';

const runDashboard = () => {
  const app = express();
  
  // Middleware pour parser le JSON entrant
  app.use(express.json());

  // 1. Configurer BullBoard (interface technique des files)
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [new BullMQAdapter(crawlQueue)],
    serverAdapter: serverAdapter,
  });

  // 2. Servir le Frontend (dossier public)
  app.use(express.static(path.join(process.cwd(), 'public')));
  app.use('/admin/queues', serverAdapter.getRouter());

  // 3. API : Lire les résultats (results.json)
  app.get('/api/results', async (req, res) => {
    const filePath = path.join(process.cwd(), "results.json");
    try {
      const content = await fs.readFile(filePath, "utf-8");
      res.json(JSON.parse(content));
    } catch (error) {
      // Si le fichier n'existe pas encore, on renvoie un tableau vide
      res.json([]);
    }
  });

  // 4. API : Ajouter une URL manuellement
  app.post('/api/scan', async (req, res) => {
    const { url, name } = req.body;

    if (!url) return res.status(400).json({ error: "URL manquante" });

    const safeJobId = url.replace(/[^a-zA-Z0-9]/g, '-');

    console.log(`📥 API : Ajout manuel de ${url}`);

    await crawlQueue.add('crawl-link', {
      url: url,
      depth: 0,
      source: name || "Manual User",
      maxDepth: 2
    }, {
      jobId: safeJobId + Date.now(), // Unique ID pour éviter les conflits
      attempts: 3,
      backoff: 5000
    });

    res.json({ success: true, message: "Crawl démarré !" });
  });

  // Lancement du serveur
  app.listen(3000, () => {
    console.log('\x1b[35m%s\x1b[0m', '🚀 UI Moderne: http://localhost:3000');
    console.log('\x1b[35m%s\x1b[0m', '📊 BullBoard: http://localhost:3000/admin/queues');
  });
};

export default runDashboard;