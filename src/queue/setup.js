import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis({ maxRetriesPerRequest: null });

// 1. Création de la file d'attente
export const crawlQueue = new Queue('crawl-tasks', { connection });

// Configuration par défaut des jobs
export const defaultJobOptions = {
  attempts: 3, // Réessaie 3 fois si ça plante
  backoff: {
    type: 'exponential',
    delay: 5000, // Attente entre les essais
  },
  removeOnComplete: true, // Nettoie Redis après succès
};