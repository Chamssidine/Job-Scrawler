
import fs from "fs/promises";
import express from 'express';
import 'dotenv/config';

import { crawlQueue } from './queue/setup.js';
import setupBullBoard from './queue/dashboard.js'; 
import './queue/worker.js';

// --- Configuration ---
const PORT = process.env.PORT || 3000;
const RESULTS_PATH = "./data/results.json";
const SITES_CONFIG_PATH = "./data/sites.json"; // Fichier de config des sites

// --- Helpers ---
const readJsonFile = async (path, defaultData = []) => {
    try {
        const data = await fs.readFile(path, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return defaultData;
        }
        throw error;
    }
};

// --- Initialisation de l'application Express ---
const app = express();
app.use(express.json());
app.use(express.static('public'));

// --- BullMQ Dashboard ---
setupBullBoard(app);

// --- API Routes ---

// GET /api/results - Fournir les résultats de scan
app.get('/api/results', async (req, res) => {
    try {
        const results = await readJsonFile(RESULTS_PATH, []);
        res.json(results);
    } catch (error) {
        console.error("Erreur lors de la lecture des résultats:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// GET /api/sites - Récupérer les configurations de sites
app.get('/api/sites', async (req, res) => {
    try {
        const sites = await readJsonFile(SITES_CONFIG_PATH, []);
        res.json(sites);
    } catch (error) {
        console.error("Erreur lors de la lecture des configurations:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// POST /api/scan - Lancer un nouveau scan et/ou sauvegarder une config
app.post('/api/scan', async (req, res) => {
    const { url, name, schema, saveConfig } = req.body;

    if (!url || !name) {
        return res.status(400).json({ message: "L'URL et le Nom du projet sont requis." });
    }

    // Sauvegarder la configuration si demandé
    if (saveConfig) {
        const sites = await readJsonFile(SITES_CONFIG_PATH, []);
        const existingIndex = sites.findIndex(s => s.name === name);
        const newSite = { name, url, schema: schema || null };

        if (existingIndex !== -1) {
            sites[existingIndex] = newSite; // Mettre à jour
        } else {
            sites.push(newSite); // Ajouter
        }
        await fs.writeFile(SITES_CONFIG_PATH, JSON.stringify(sites, null, 2));
    }

    // Ajouter le job à la file d'attente
    try {
        const safeJobId = `scan:${name.replace(/[^a-zA-Z0-9]/g, '-')}:${Date.now()}`;
        await crawlQueue.add('crawl-job', { // Renommé pour plus de clarté
            url, 
            source: name, 
            schema: schema || null,
            maxDepth: 2,
            depth: 0,
        }, {
            jobId: safeJobId,
            attempts: 2,
            backoff: 5000
        });

        console.log(`✅ Nouveau scan ajouté pour : ${name} (${url})`);
        res.status(202).json({ message: "Scan ajouté à la file d'attente." });

    } catch (error) {
        console.error("Erreur lors de l'ajout du scan:", error);
        res.status(500).json({ message: "Erreur lors de l'ajout du scan." });
    }
});

// DELETE /api/sites - Supprimer une configuration
app.delete('/api/sites', async (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ message: "Le nom de la configuration est requis." });
    }

    const sites = await readJsonFile(SITES_CONFIG_PATH, []);
    const filteredSites = sites.filter(s => s.name !== name);

    if (sites.length === filteredSites.length) {
        return res.status(404).json({ message: "Configuration non trouvée." });
    }

    await fs.writeFile(SITES_CONFIG_PATH, JSON.stringify(filteredSites, null, 2));
    res.status(200).json({ message: `Configuration '${name}' supprimée.` });
});


// GET /api/export - Exporter les résultats en CSV
app.get('/api/export', async (req, res) => {
    try {
        const results = await readJsonFile(RESULTS_PATH, []);
        if (results.length === 0) {
            return res.status(404).send("Aucun résultat à exporter.");
        }

        const headers = new Set();
        results.forEach(item => Object.keys(item).forEach(key => headers.add(key)));
        const headerArray = Array.from(headers);

        const escapeCsv = (str) => {
            if (str === null || str === undefined) return ''
            str = String(str);
            if (str.includes('"') || str.includes(',') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        let csv = headerArray.join(',') + '\n';
        results.forEach(item => {
            csv += headerArray.map(header => escapeCsv(item[header])).join(',') + '\n';
        });

        res.header('Content-Type', 'text/csv');
        res.attachment('results.csv');
        res.send(csv);

    } catch (error) {
        console.error("Erreur lors de l'exportation CSV:", error);
        res.status(500).send("Erreur serveur lors de l'exportation.");
    }
});

// --- Démarrage du serveur ---
app.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
    console.log(`📊 Dashboard BullMQ disponible sur http://localhost:${PORT}/admin/queues`);
});

// --- Lancement des scans au démarrage ---
async function startInitialDiscovery() {
    try {
        const sites = await readJsonFile(SITES_CONFIG_PATH, []);
        if (sites.length > 0) {
            console.log(`🚀 Lancement des scans pour ${sites.length} configurations sauvegardées...`);
            for (const site of sites) {
                const safeJobId = `initial:${site.name.replace(/[^a-zA-Z0-9]/g, '-')}:${Date.now()}`;
                await crawlQueue.add('crawl-job', {
                    url: site.url,
                    source: site.name,
                    schema: site.schema || null,
                    maxDepth: 2,
                    depth: 0,
                }, { jobId: safeJobId });
            }
        }
    } catch (error) {
        console.error("❌ Erreur lors du lancement des scans initiaux:", error.message);
    }
}

startInitialDiscovery();
