import { Worker, Job } from 'bullmq';
import { getRedisConnection } from '../index.js';
import { supabase } from '../../lib/supabase.js';
import { decryptPayload } from '../../lib/encryption.js';
import { upsertEmbeddings, deleteEmbeddings, type EmbeddingRecord } from '../../lib/embeddings.js';

type EmbeddingJobData = {
  userId: string;
};

function formatCurrency(amount: number, currency = 'GBP'): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `£${amount.toFixed(2)}`;
  }
}

async function indexTransactions(userId: string) {
  const { data: transactions, error } = await supabase
    .from('transactions')
    .select('id, date, amount, currency, direction, description, merchant, category')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (error) throw new Error(`Failed to fetch transactions: ${error.message}`);
  if (!transactions || transactions.length === 0) return;

  const records: EmbeddingRecord[] = transactions.map((tx) => {
    const amountStr = formatCurrency(tx.amount, tx.currency);
    const dirLabel = tx.direction === 'inflow' ? 'received' : 'spent';
    const merchant = tx.merchant ? ` at ${tx.merchant}` : '';
    const desc = tx.description ? ` — ${tx.description}` : '';
    const cat = tx.category ? ` (${tx.category})` : '';

    const content = `${tx.date}: ${dirLabel} ${amountStr}${merchant}${desc}${cat}`;

    return {
      userId,
      contentType: 'transaction' as const,
      sourceId: `tx:${tx.id}`,
      content,
      metadata: {
        date: tx.date,
        amount: tx.amount,
        currency: tx.currency,
        direction: tx.direction,
        merchant: tx.merchant,
        category: tx.category,
      },
    };
  });

  await upsertEmbeddings(records);
  console.log(`[embedding] Indexed ${records.length} transactions for user ${userId}`);
}

async function indexIncome(userId: string) {
  const { data, error } = await supabase
    .from('income_sources')
    .select('payload_enc')
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to fetch income: ${error.message}`);
  if (!data || data.length === 0) return;

  const records: EmbeddingRecord[] = [];
  for (const row of data) {
    const item = await decryptPayload<any>(row.payload_enc);
    if (!item) continue;

    const amountStr = item.amount ? formatCurrency(item.amount) : 'unknown amount';
    const freq = item.frequency || 'recurring';
    const content = `Income: ${item.name || item.source || 'Unknown'} — ${amountStr} ${freq}`;

    records.push({
      userId,
      contentType: 'income',
      sourceId: `income:${item.id || records.length}`,
      content,
      metadata: { ...item },
    });
  }

  if (records.length > 0) {
    await upsertEmbeddings(records);
    console.log(`[embedding] Indexed ${records.length} income sources for user ${userId}`);
  }
}

async function indexOutgoings(userId: string) {
  const { data, error } = await supabase
    .from('outgoings_outline')
    .select('payload_enc')
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to fetch outgoings: ${error.message}`);
  if (!data || data.length === 0) return;

  const records: EmbeddingRecord[] = [];
  for (const row of data) {
    const item = await decryptPayload<any>(row.payload_enc);
    if (!item) continue;

    const amountStr = item.amount ? formatCurrency(item.amount) : 'unknown amount';
    const freq = item.frequency || 'monthly';
    const content = `Outgoing: ${item.category || 'Unknown'} — ${amountStr} ${freq}. Items: ${
      (item.items || []).map((i: any) => `${i.name || i.label} ${i.amount ? formatCurrency(i.amount) : ''}`).join(', ') || 'none'
    }`;

    records.push({
      userId,
      contentType: 'outgoing',
      sourceId: `outgoing:${item.category || records.length}`,
      content,
      metadata: { ...item },
    });
  }

  if (records.length > 0) {
    await upsertEmbeddings(records);
    console.log(`[embedding] Indexed ${records.length} outgoings for user ${userId}`);
  }
}

async function indexBudgets(userId: string) {
  const { data, error } = await supabase
    .from('budgets')
    .select('*')
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to fetch budgets: ${error.message}`);
  if (!data || data.length === 0) return;

  const records: EmbeddingRecord[] = data.map((b) => ({
    userId,
    contentType: 'budget' as const,
    sourceId: `budget:${b.id}`,
    content: `Budget: ${b.category} — ${formatCurrency(b.amount)} ${b.period}${b.notes ? `. Notes: ${b.notes}` : ''}`,
    metadata: { id: b.id, category: b.category, amount: b.amount, period: b.period },
  }));

  await upsertEmbeddings(records);
  console.log(`[embedding] Indexed ${records.length} budgets for user ${userId}`);
}

async function processEmbeddingJob(job: Job<EmbeddingJobData>) {
  const { userId } = job.data;

  switch (job.name) {
    case 'index-transactions':
      await indexTransactions(userId);
      break;

    case 'index-income':
      await indexIncome(userId);
      break;

    case 'index-outgoings':
      await indexOutgoings(userId);
      break;

    case 'index-budgets':
      await indexBudgets(userId);
      break;

    case 'index-all':
      await Promise.all([
        indexTransactions(userId),
        indexIncome(userId),
        indexOutgoings(userId),
        indexBudgets(userId),
      ]);
      break;

    case 'delete-user':
      await deleteEmbeddings(userId);
      console.log(`[embedding] Deleted all embeddings for user ${userId}`);
      break;

    default:
      console.log(`[embedding] Unknown job name: ${job.name}`);
  }
}

export function startEmbeddingWorker() {
  const connection = getRedisConnection();
  if (!connection) {
    console.log('[embedding] Redis not configured, skipping embedding worker');
    return null;
  }

  const worker = new Worker('embedding', processEmbeddingJob, {
    connection,
    concurrency: 3,
  });

  worker.on('completed', (job) => {
    console.log(`[embedding] Job ${job.id} completed: ${job.name}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[embedding] Job ${job?.id} failed: ${err.message}`);
  });

  console.log('[embedding] Worker started');
  return worker;
}
