import { Queue } from 'bullmq';
import { getRedisConnection } from './index.js';

const connection = getRedisConnection();

function createQueue(name: string): Queue | null {
  if (!connection) return null;
  return new Queue(name, { connection });
}

export const emailQueue = createQueue('email');
export const syncQueue = createQueue('sync');
export const scoreQueue = createQueue('score');

// ── Typed add helpers ──

export async function addEmailJob(
  name: 'welcome' | 'sync-complete' | 'weekly-summary',
  data: { userId: string; email?: string }
) {
  await emailQueue?.add(name, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });
}

export async function addSyncJob(
  name: 'yapily-sync' | 'plaid-sync',
  data: { userId: string; consentId?: string; itemId?: string }
) {
  await syncQueue?.add(name, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
}

export async function addScoreJob(
  name: 'recalculate',
  data: { userId: string },
  opts?: { delay?: number }
) {
  await scoreQueue?.add(name, data, {
    delay: opts?.delay ?? 5000,
    attempts: 2,
    backoff: { type: 'exponential', delay: 1000 },
  });
}

// ── Embedding queue ──

export const embeddingQueue = createQueue('embedding');

export async function addEmbeddingJob(
  name: 'index-transactions' | 'index-income' | 'index-outgoings' | 'index-budgets' | 'index-all' | 'delete-user',
  data: { userId: string },
  opts?: { delay?: number }
) {
  const jobId = `${name}:${data.userId}`;
  await embeddingQueue?.add(name, data, {
    jobId,
    delay: opts?.delay ?? 2000,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: 5,
  });
}
