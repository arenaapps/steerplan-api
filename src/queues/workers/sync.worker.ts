import { Worker, Job } from 'bullmq';
import { getRedisConnection } from '../index.js';

type SyncJobData = {
  userId: string;
  consentId?: string;
  itemId?: string;
};

async function processSyncJob(job: Job<SyncJobData>) {
  const { userId } = job.data;

  switch (job.name) {
    case 'yapily-sync':
      console.log(`[sync] Background Yapily sync for user ${userId}`);
      // TODO: Import and call yapily sync logic
      break;

    case 'plaid-sync':
      console.log(`[sync] Background Plaid sync for user ${userId}`);
      // TODO: Import and call plaid sync logic
      break;

    default:
      console.log(`[sync] Unknown job name: ${job.name}`);
  }
}

export function startSyncWorker() {
  const connection = getRedisConnection();
  if (!connection) {
    console.log('[sync] Redis not configured, skipping sync worker');
    return null;
  }

  const worker = new Worker('sync', processSyncJob, { connection });

  worker.on('completed', (job) => {
    console.log(`[sync] Job ${job.id} completed: ${job.name}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[sync] Job ${job?.id} failed: ${err.message}`);
  });

  console.log('[sync] Worker started');
  return worker;
}
