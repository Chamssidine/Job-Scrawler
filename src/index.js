
import fs from "fs/promises";
import express from 'express';
import 'dotenv/config';

import { crawlQueue } from './queue/setup.js';
import setupBullBoard from './queue/dashboard.js'; // Importation corrigée
import './queue/worker.js';

// --- Configuration ---
const PORT = process.env.PORT || 3000;
const RESULTS_PATH = "./results.json";

// --- Initialisation de l'application Express ---
const app = express();
app.use(express.json());
app.use(express.static('public'));

// --- BullMQ Dashboard ---
setupBullBoard(app); // Utilisation correcte du module dashboard

// --- API Routes ---

// GET /api/results - Fournir les résultats de scan
app.get('/api/results', async (req, res) => {
    try {
        const data = await fs.readFile(RESULTS_PATH, 'utf-8');
        res.json(JSON.parse(data));
    } catch (error) {
        if (error.code === 'ENOENT') {
            return res.json([]);
        }
        console.error("Erreur lors de la lecture des résultats:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// POST /api/scan - Lancer un nouveau scan
app.post('/api/scan', async (req, res) => {
    const { url, name } = req.body;

    if (!url) {
        return res.status(400).json({ message: "L'URL est requise." });
    }

    try {
        const safeJobId = url.replace(/[^a-zA-Z0-9]/g, '-') + `-${Date.now()}`;

        await crawlQueue.add('crawl-link', {
            url: url,
            depth: 0,
            source: name || "scan-manuel",
            maxDepth: 2,
            schema: null
        }, {
            jobId: safeJobId,
            attempts: 3,
            backoff: 5000
        });

        console.log(`✅ Nouveau scan ajouté pour : ${url}`);
        res.status(202).json({ message: "Scan ajouté à la file d'attente." });

    } catch (error) {
        console.error("Erreur lors de l'ajout du scan:", error);
        res.status(500).json({ message: "Erreur lors de l'ajout du scan." });
    }
});

// --- Démarrage du serveur ---
app.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
    console.log(`📊 Dashboard BullMQ disponible sur http://localhost:${PORT}/admin/queues`);
});

// --- Lancement des scans initiaux ---
async function startInitialDiscovery() {
    try {
        const sitesData = JSON.parse(await fs.readFile("./data/sites.json", "utf-8"));
        console.log(`🚀 Injection de ${sitesData.length} configurations initiales...`);
        
        for (const site of sitesData) {
            const safeJobId = site.url.replace(/[^a-zA-Z0-9]/g, '-') + `-${Date.now()}`;
            await crawlQueue.add('crawl-link', {
                url: site.url,
                depth: 0,
                source: site.name || "inconnu",
                maxDepth: 2,
                schema: site.schema || null
            }, {
                jobId: safeJobId,
                attempts: 3,
                backoff: 5000
            });
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error("❌ Erreur lors du chargement des sites initiaux:", error.message);
        } else {
            console.log("ℹ️ Pas de fichier data/sites.json trouvé, aucun scan initial lancé.");
        }
    }
}

startInitialDiscovery();
