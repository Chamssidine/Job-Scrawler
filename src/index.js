import fs from "fs/promises";
import express from 'express';
import 'dotenv/config';

import { crawlQueue } from './queue/setup.js';
import setupBullBoard from './queue/dashboard.js'; 
import './queue/worker.js';

// --- Configuration ---
const PORT = process.env.PORT || 3000;
const RESULTS_PATH = "./data/results.json";
const SITES_CONFIG_PATH = "./data/sites.json";

// --- Helpers ---
const readJsonFile = async (path, defaultData = []) => {
    try {
        const fileContent = await fs.readFile(path, 'utf-8');
        const cleanedContent = fileContent.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
        if (cleanedContent.trim() === '') return defaultData;
        return JSON.parse(cleanedContent);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.writeFile(path, JSON.stringify(defaultData, null, 2));
            return defaultData;
        }
        console.error(`Erreur critique lors de la lecture ou du parsing de ${path}:`, error);
        return defaultData;
    }
};

// Helper function to remove control characters from strings
const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    // Removes ASCII control characters & other common problematic unicode characters
    return str.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();
};

// --- Initialisation de l'application Express ---
const app = express();
app.use(express.json());
app.use(express.static('public'));

// --- BullMQ Dashboard ---
setupBullBoard(app);

// --- API Routes ---

// GET /api/results
app.get('/api/results', async (req, res) => {
    try {
        const results = await readJsonFile(RESULTS_PATH, []);
        res.json(results);
    } catch (error) {
        console.error("Erreur lors de la lecture des résultats:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// GET /api/sites
app.get('/api/sites', async (req, res) => {
    try {
        const sites = await readJsonFile(SITES_CONFIG_PATH, []);
        res.json(sites);
    } catch (error) {
        console.error("Erreur lors de la lecture des configurations:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// POST /api/scan - Lancer un nouveau scan et/ou sauvegarder une config (AVEC SANITIZATION)
app.post('/api/scan', async (req, res) => {
    const { url, name, schema, saveConfig } = req.body;

    // --- SANITIZATION ---
    const sanitizedName = name ? sanitizeString(name) : "";
    const sanitizedUrl = url ? sanitizeString(url) : "";
    let sanitizedSchema = null;

    if (schema) {
        sanitizedSchema = {};
        for (const key in schema) {
            const sanitizedKey = sanitizeString(key);
            const sanitizedValue = sanitizeString(schema[key]);
            if (sanitizedKey) {
                sanitizedSchema[sanitizedKey] = sanitizedValue;
            }
        }
        if (Object.keys(sanitizedSchema).length === 0) {
            sanitizedSchema = null;
        }
    }
    // --- END SANITIZATION ---

    if (!sanitizedUrl || !sanitizedName) {
        return res.status(400).json({ message: "L'URL et le Nom du projet sont requis." });
    }

    if (saveConfig) {
        try {
            const sites = await readJsonFile(SITES_CONFIG_PATH, []);
            const existingIndex = sites.findIndex(s => s.name === sanitizedName);
            const newSite = { name: sanitizedName, url: sanitizedUrl, schema: sanitizedSchema || null };

            if (existingIndex !== -1) {
                sites[existingIndex] = newSite;
            } else {
                sites.push(newSite);
            }
            await fs.writeFile(SITES_CONFIG_PATH, JSON.stringify(sites, null, 2));
        } catch(err) {
            console.error("Erreur lors de la sauvegarde de la configuration:", err);
            return res.status(500).json({ message: "Impossible de sauvegarder la configuration." });
        }
    }

    try {
        const safeJobId = `scan:${sanitizedName.replace(/[^a-zA-Z0-9]/g, '-')}:${Date.now()}`;
        await crawlQueue.add('crawl-job', { 
            url: sanitizedUrl, 
            source: sanitizedName, 
            schema: sanitizedSchema || null,
            maxDepth: 2,
            depth: 0,
        }, {
            jobId: safeJobId,
            attempts: 2,
            backoff: 5000
        });

        console.log(`✅ Nouveau scan ajouté pour : ${sanitizedName} (${sanitizedUrl})`);
        res.status(202).json({ message: "Scan ajouté à la file d'attente." });

    } catch (error) {
        console.error("Erreur lors de l'ajout du scan:", error);
        res.status(500).json({ message: "Erreur lors de l'ajout du scan." });
    }
});


// DELETE /api/sites
app.delete('/api/sites', async (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ message: "Le nom de la configuration est requis." });
    }
    
    try {
        const sites = await readJsonFile(SITES_CONFIG_PATH, []);
        const filteredSites = sites.filter(s => s.name !== name);

        if (sites.length === filteredSites.length) {
            return res.status(404).json({ message: "Configuration non trouvée." });
        }

        await fs.writeFile(SITES_CONFIG_PATH, JSON.stringify(filteredSites, null, 2));
        res.status(200).json({ message: `Configuration '${name}' supprimée.` });
    } catch (err) {
        console.error("Erreur lors de la suppression de la configuration:", err);
        res.status(500).json({ message: "Impossible de supprimer la configuration." });
    }
});


// GET /api/export
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