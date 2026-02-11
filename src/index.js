import fs from "fs/promises";
import express from 'express';
import 'dotenv/config';

import { crawlQueue } from './queue/setup.js';
import setupBullBoard from './queue/dashboard.js'; 
import './queue/worker.js';

// --- Configuration ---
const PORT = process.env.PORT || 4000;
const RESULTS_PATH = "./data/results.json";
const SITES_CONFIG_PATH = "./data/sites.json";
const LOGS_PATH = "./data/logs.json";

// --- Helpers ---
// Supprime proprement les commentaires sans casser les chaînes (préserve https://)
const stripJsonCommentsSafe = (input) => {
    let output = '';
    let inString = false;
    let stringChar = null; // '"' ou "'"
    let escaped = false;
    let inSingleLineComment = false;
    let inMultiLineComment = false;

    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        const next = i + 1 < input.length ? input[i + 1] : '';

        if (inSingleLineComment) {
            if (char === '\n') {
                inSingleLineComment = false;
                output += char;
            }
            continue;
        }

        if (inMultiLineComment) {
            if (char === '*' && next === '/') {
                inMultiLineComment = false;
                i++; // skip '/'
            }
            continue;
        }

        if (inString) {
            output += char;
            if (!escaped && char === stringChar) {
                inString = false;
                stringChar = null;
            }
            escaped = !escaped && char === '\\';
            if (escaped && char !== '\\') {
                escaped = false;
            }
            continue;
        }

        // Détection des commentaires uniquement hors chaîne
        if (char === '/' && next === '/') {
            inSingleLineComment = true;
            i++; // skip second '/'
            continue;
        }
        if (char === '/' && next === '*') {
            inMultiLineComment = true;
            i++; // skip '*'
            continue;
        }

        // Entrée dans une chaîne
        if (char === '"' || char === "'") {
            inString = true;
            stringChar = char;
            output += char;
            escaped = false;
            continue;
        }

        output += char;
    }

    return output;
};
const readJsonFile = async (path, defaultData = []) => {
    try {
        const fileContent = await fs.readFile(path, 'utf-8');
        const cleanedContent = stripJsonCommentsSafe(fileContent);
        if (cleanedContent.trim() === '') return defaultData;
        return JSON.parse(cleanedContent);
    } catch (error) {
        // Sauvegarde automatique en cas de JSON corrompu
        if (error instanceof SyntaxError || error.name === 'SyntaxError') {
            try {
                const raw = await fs.readFile(path, 'utf-8').catch(() => null);
                const backupName = `${path}.bak.${Date.now()}.json`;
                if (raw !== null && raw !== undefined) {
                    await fs.writeFile(backupName, raw);
                }
                await fs.writeFile(path, JSON.stringify(defaultData, null, 2));
                console.error(`Fichier JSON corrompu détecté et sauvegardé: ${backupName}. Réinitialisation avec des valeurs par défaut.`);
            } catch (e) {
                console.error(`Échec de la réparation automatique de ${path}:`, e);
            }
            return defaultData;
        }
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

// --- Basic request logger to trace incoming API calls ---
app.use((req, _res, next) => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] ${req.method} ${req.url}`);
    next();
});

// --- BullMQ Dashboard ---
setupBullBoard(app);
// Health check (Redis + app)
import { connection as redisConn } from './queue/setup.js';
app.get('/api/health', async (_req, res) => {
    try {
        const pong = await redisConn.ping();
        res.json({ status: 'ok', redis: pong });
    } catch (e) {
        res.status(500).json({ status: 'error', redis: e?.message || 'unknown' });
    }
});

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

// GET /api/jobs
// - Sans paramètres de recherche: retourne l'état de la file (comportement existant)
// - Avec paramètres (ex: jobTitle, location): retourne les résultats filtrés depuis data/results.json
app.get('/api/jobs', async (req, res) => {
    try {
        const { jobTitle, title, location, host, source, emailOnly, minScore, page = '1', pageSize = '50' } = req.query;
        const isSearch = [jobTitle, title, location, host, source, emailOnly, minScore].some(v => v !== undefined);

        if (isSearch) {
            const results = await readJsonFile(RESULTS_PATH, []);
            const qTitle = (jobTitle ?? title ?? '').toString().trim();
            const qLoc = (location ?? '').toString().trim();
            const qHost = (host ?? '').toString().trim();
            const qSource = (source ?? '').toString().trim();
            const qEmailOnly = String(emailOnly ?? '').toLowerCase() === 'true';
            const qMinScore = Number.isFinite(parseFloat(minScore)) ? parseFloat(minScore) : null;

            const norm = (s) => (s ?? '').toString().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
            const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

            let filtered = results.filter((item) => {
                // Title/Name matching
                if (qTitle) {
                    const titleFields = [item.title, item.nom, item.name, item.organization, item.description];
                    const hay = norm(titleFields.filter(Boolean).join(' \n '));
                    if (!hay.includes(norm(qTitle))) return false;
                }
                // Location matching
                if (qLoc) {
                    const locHay = norm(item.location || '');
                    if (!locHay.includes(norm(qLoc))) return false;
                }
                // Host filter
                if (qHost) {
                    if (hostOf(item.url) !== qHost) return false;
                }
                // Source filter (exact)
                if (qSource) {
                    if ((item.source || '') !== qSource) return false;
                }
                // Email only
                if (qEmailOnly) {
                    const e = String(item.email ?? '').trim().toLowerCase();
                    if (!e || e === 'n/a' || e === 'na' || e === '—' || e === '-') return false;
                }
                // Min score
                if (qMinScore !== null && qMinScore > 0) {
                    if (typeof item.score !== 'number' || item.score < qMinScore) return false;
                }
                return true;
            });

            // Default sort: newest first
            filtered.sort((a,b) => new Date(b.extracted_at || 0) - new Date(a.extracted_at || 0));

            const p = Math.max(1, parseInt(page, 10) || 1);
            const ps = Math.min(500, Math.max(1, parseInt(pageSize, 10) || 50));
            const start = (p - 1) * ps;
            const slice = filtered.slice(start, start + ps);

            return res.json({
                total: filtered.length,
                page: p,
                pageSize: ps,
                count: slice.length,
                results: slice
            });
        }

        // Default: queue stats mode
        const active = await crawlQueue.getActiveCount();
        const waiting = await crawlQueue.getWaitingCount();
        const completed = await crawlQueue.getCompletedCount();
        const failed = await crawlQueue.getFailedCount();

        // Utiliser getJobs(state, start, end) pour BullMQ v5
        const activeJobs = await crawlQueue.getJobs('active', 0, 99);
        const waitingJobs = await crawlQueue.getJobs('waiting', 0, 49);

        res.json({
            active,
            waiting,
            completed,
            failed,
            activeJobs: activeJobs.map(job => ({
                id: job.id,
                name: job.name,
                source: job.data?.source || 'Unknown',
                url: job.data?.url || '',
                depth: job.data?.depth || 0,
                status: 'active'
            })),
            waitingJobs: waitingJobs.map(job => ({
                id: job.id,
                name: job.name,
                source: job.data?.source || 'Unknown',
                url: job.data?.url || '',
                status: 'waiting'
            }))
        });
    } catch (error) {
        console.error("Erreur lors de la récupération des jobs:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// POST /api/scan - Lancer un nouveau scan et/ou sauvegarder une config (AVEC SANITIZATION)
app.post('/api/scan', async (req, res) => {
    const { url, name, schema, saveConfig, maxDepth: reqMaxDepth, childLimit: reqChildLimit } = req.body;

    console.log(`[SCAN] received: name=${name || ''} url=${url || ''} saveConfig=${!!saveConfig}`);

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

    // Validation stricte de l'URL
    try {
        // Utilise l'URL globale (Node.js) pour valider le format
        new URL(sanitizedUrl);
    } catch {
        return res.status(400).json({ message: "URL invalide. Veuillez saisir une URL complète (ex: https://example.com)." });
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
        const safeJobId = `scan-${sanitizedName.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
        // Bounds
        const safeMaxDepth = Math.min(6, Math.max(1, parseInt(reqMaxDepth ?? '3', 10) || 3));
        const safeChildLimit = Math.min(200, Math.max(1, parseInt(reqChildLimit ?? (process.env.CHILD_LIMIT || '20'), 10) || 20));

        await crawlQueue.add('crawl-job', { 
            url: sanitizedUrl, 
            source: sanitizedName, 
            schema: sanitizedSchema || null,
            maxDepth: safeMaxDepth,
            depth: 0,
            childLimit: safeChildLimit,
        }, {
            jobId: safeJobId,
            attempts: 2,
            backoff: 5000,
            removeOnComplete: true
        });

        console.log(`✅ Nouveau scan ajouté pour : ${sanitizedName} (${sanitizedUrl})`);
        res.status(202).json({ message: "Scan ajouté à la file d'attente." });

    } catch (error) {
        console.error("Erreur lors de l'ajout du scan:", error?.message || error);
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

// Global unhandled errors
process.on('unhandledRejection', (reason) => {
    console.error('UnhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('UncaughtException:', err);
});

// --- Préflight: valider/réparer les JSON de données au démarrage ---
(async () => {
    try {
        await Promise.all([
            readJsonFile(SITES_CONFIG_PATH, []),
            readJsonFile(RESULTS_PATH, []),
            readJsonFile(LOGS_PATH, [])
        ]);
    } catch {
        // silencieux: readJsonFile gère déjà la réparation/log
    }
})();