import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

export const connection = new IORedis({ 
  host: 'localhost', 
  port: 6379,
  maxRetriesPerRequest: null 
});
 
export const crawlQueue = new Queue('job-crawler', { connection });
 
export const defaultJobOptions = {
  attempts: 3, 
  backoff: {
    type: 'exponential',
    delay: 5000,  
  },
  removeOnComplete: true,  
};