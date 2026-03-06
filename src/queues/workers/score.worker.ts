import { Worker, Job } from 'bullmq';
import { getRedisConnection } from '../index.js';

type ScoreJobData = {
  userId: string;
};

async function processScoreJob(job: Job<ScoreJobData>) {
  const { userId } = job.data;

  switch (job.name) {
    case 'recalculate':
      console.log(`[score] Recalculating Wealth Score for user ${userId}`);
      // TODO: Implement WSI recalculation logic
      break;

    default:
      console.log(`[score] Unknown job name: ${job.name}`);
  }
}

export function startScoreWorker() {
  const connection = getRedisConnection();
  if (!connection) {
    console.log('[score] Redis not configured, skipping score worker');
    return null;
  }

  const worker = new Worker('score', processScoreJob, { connection });

  worker.on('completed', (job) => {
    console.log(`[score] Job ${job.id} completed: ${job.name}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[score] Job ${job?.id} failed: ${err.message}`);
  });

  console.log('[score] Worker started');
  return worker;
}
