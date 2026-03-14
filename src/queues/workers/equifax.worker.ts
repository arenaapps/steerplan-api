import { Worker, Job } from 'bullmq';
import { getRedisConnection } from '../index.js';
import { supabase } from '../../lib/supabase.js';
import { encryptPayload, decryptPayload } from '../../lib/encryption.js';
import {
  createAndEnrich,
  getFinancialHealthIndex,
  getIncomeVerification,
  getCustomerCalculations,
  transformYapilyToEquifax,
} from '../../lib/equifax-obi.js';
import { createClerkClient } from '@clerk/backend';
import { config } from '../../config.js';

type EquifaxJobData = {
  userId: string;
  months?: number;
};

async function processEquifaxJob(job: Job<EquifaxJobData>) {
  const { userId, months = 3 } = job.data;

  switch (job.name) {
    case 'enrich': {
      console.log(`[equifax] Enriching user ${userId}`);

      // Fetch bank accounts
      const { data: bankAccounts } = await supabase
        .from('bank_accounts')
        .select('id, payload_enc')
        .eq('user_id', userId);

      if (!bankAccounts?.length) {
        console.log(`[equifax] No bank accounts for user ${userId}, skipping`);
        return;
      }

      const accounts: any[] = [];
      for (const ba of bankAccounts) {
        const payload = await decryptPayload<any>(ba.payload_enc);
        if (payload) accounts.push({ ...payload, id: ba.id });
      }

      const { data: transactions } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(1000);

      const clerk = createClerkClient({ secretKey: config.clerk.secretKey });
      const user = await clerk.users.getUser(userId);
      const customerName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User';
      const customerEmail = user.emailAddresses?.[0]?.emailAddress || '';

      const equifaxData = transformYapilyToEquifax(accounts, transactions || []);

      const customerId = await createAndEnrich({
        customerName,
        customerEmail,
        accounts: equifaxData.accounts,
        transactions: equifaxData.transactions,
      });

      // Upsert customer mapping
      const { data: existing } = await supabase
        .from('equifax_customers')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('equifax_customers')
          .update({ equifax_customer_id: customerId, updated_at: new Date().toISOString() })
          .eq('user_id', userId);
      } else {
        await supabase.from('equifax_customers').insert({
          user_id: userId,
          equifax_customer_id: customerId,
        });
      }

      console.log(`[equifax] Enriched user ${userId}, customerId: ${customerId}`);
      break;
    }

    case 'fetch-insights': {
      console.log(`[equifax] Fetching insights for user ${userId}`);

      const { data: customer } = await supabase
        .from('equifax_customers')
        .select('equifax_customer_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (!customer) {
        console.log(`[equifax] No equifax customer for user ${userId}, skipping`);
        return;
      }

      const custId = customer.equifax_customer_id;

      // Fetch FHI, income verification, and calculations in parallel
      const [fhi, incomeVer, calculations] = await Promise.all([
        getFinancialHealthIndex(custId, months).catch((e) => {
          console.error(`[equifax] FHI failed: ${e.message}`);
          return null;
        }),
        getIncomeVerification(custId, months).catch((e) => {
          console.error(`[equifax] Income verification failed: ${e.message}`);
          return null;
        }),
        getCustomerCalculations(custId).catch((e) => {
          console.error(`[equifax] Calculations failed: ${e.message}`);
          return null;
        }),
      ]);

      // Store score row
      await supabase.from('credit_scores').insert({
        user_id: userId,
        fhi_score: fhi?.fhiScore ?? null,
        fhi_flags: fhi?.flags ?? [],
        income_grade: incomeVer?.grade ?? null,
        disposable_income: calculations?.disposableIncome ?? null,
        total_income: calculations?.totalIncome ?? null,
        total_expenditure: calculations?.totalExpenditure ?? null,
        source: 'obi',
      });

      // Store encrypted detailed payloads
      const insightRows: { user_id: string; insight_type: string; payload_enc: string }[] = [];

      if (fhi) {
        insightRows.push({
          user_id: userId,
          insight_type: 'fhi',
          payload_enc: await encryptPayload(fhi),
        });
      }
      if (incomeVer) {
        insightRows.push({
          user_id: userId,
          insight_type: 'income_verification',
          payload_enc: await encryptPayload(incomeVer),
        });
      }
      if (calculations) {
        insightRows.push({
          user_id: userId,
          insight_type: 'expenditure',
          payload_enc: await encryptPayload(calculations),
        });
      }

      if (insightRows.length > 0) {
        await supabase.from('credit_insights').insert(insightRows);
      }

      console.log(`[equifax] Insights stored for user ${userId}`);
      break;
    }

    default:
      console.log(`[equifax] Unknown job name: ${job.name}`);
  }
}

export function startEquifaxWorker() {
  const connection = getRedisConnection();
  if (!connection) {
    console.log('[equifax] Redis not configured, skipping equifax worker');
    return null;
  }

  const worker = new Worker('equifax', processEquifaxJob, { connection });

  worker.on('completed', (job) => {
    console.log(`[equifax] Job ${job.id} completed: ${job.name}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[equifax] Job ${job?.id} failed: ${err.message}`);
  });

  console.log('[equifax] Worker started');
  return worker;
}
