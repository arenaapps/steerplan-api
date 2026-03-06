import { Worker, Job } from 'bullmq';
import { getRedisConnection } from '../index.js';

type EmailJobData = {
  userId: string;
  email?: string;
};

async function processEmailJob(job: Job<EmailJobData>) {
  const { userId, email } = job.data;

  switch (job.name) {
    case 'welcome':
      console.log(`[email] Sending welcome email to ${email || userId}`);
      // TODO: Integrate email provider (Resend, SendGrid, etc.)
      break;

    case 'sync-complete':
      console.log(`[email] Sending sync-complete notification to ${userId}`);
      break;

    case 'weekly-summary':
      console.log(`[email] Sending weekly summary to ${userId}`);
      break;

    default:
      console.log(`[email] Unknown job name: ${job.name}`);
  }
}

export function startEmailWorker() {
  const connection = getRedisConnection();
  if (!connection) {
    console.log('[email] Redis not configured, skipping email worker');
    return null;
  }

  const worker = new Worker('email', processEmailJob, { connection });

  worker.on('completed', (job) => {
    console.log(`[email] Job ${job.id} completed: ${job.name}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[email] Job ${job?.id} failed: ${err.message}`);
  });

  console.log('[email] Worker started');
  return worker;
}
