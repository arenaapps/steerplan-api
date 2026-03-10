import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { finexerGet, finexerPost } from '../../lib/finexer.js';
import { supabase } from '../../lib/supabase.js';
import { encryptPayload } from '../../lib/encryption.js';

const formatMoney = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency || 'GBP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `£${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function finexerSyncRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;
    try {
      const body = request.body as { consentId: string };
      if (!body?.consentId) {
        return reply.code(400).send({ error: 'Missing consentId' });
      }

      const { consentId } = body;

      // Verify consent is authorized
      const consentData = await finexerGet(`/consents/${consentId}`);
      const consentStatus = consentData.data?.status ?? consentData.status;
      if (consentStatus !== 'authorized') {
        return reply.code(400).send({ error: `Consent not authorized (status: ${consentStatus})` });
      }

      // Update consent record with provider info
      const providerInfo = consentData.data?.provider ?? consentData.provider;
      if (providerInfo) {
        await supabase
          .from('finexer_consents')
          .update({
            provider_id: providerInfo.id ?? null,
            provider_name: providerInfo.name ?? null,
          })
          .eq('consent_id', consentId);
      }

      const providerName = providerInfo?.name ?? 'Bank';

      // Fetch bank accounts linked to this consent
      const accountsResult = await finexerGet('/bank_accounts', { consent: consentId });
      const accounts = accountsResult.data ?? accountsResult ?? [];

      let totalAccounts = 0;
      let totalTransactions = 0;

      // Get backfill months from profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('backfill_months')
        .eq('clerk_user_id', userId)
        .maybeSingle();
      const backfillMonths = profile?.backfill_months ?? 3;
      const fromDate = new Date();
      fromDate.setMonth(fromDate.getMonth() - backfillMonths);

      for (const account of accounts) {
        const accountId = account.id;

        // Trigger sync
        try {
          await finexerPost(`/bank_accounts/${accountId}/sync`, []);

          // Brief wait for sync to process
          await sleep(2000);
        } catch (err: any) {
          request.log.error(`Finexer sync trigger error for account ${accountId}: ${err.message}`);
        }

        // Build and encrypt account data
        const lastFour = account.identification?.account_number?.slice(-4) ?? null;
        const balance = account.balance ?? 0;
        const currency = account.currency || 'GBP';

        const bankAccountData = {
          id: accountId,
          name: account.nickname || account.holder_name || 'Account',
          provider: providerName,
          lastFour,
          balance: formatMoney(balance, currency),
          overdraft: '',
          _finexerConsentId: consentId,
        };

        const enc = await encryptPayload(bankAccountData);
        await supabase
          .from('bank_accounts')
          .upsert({ id: accountId, user_id: userId, payload_enc: enc });

        totalAccounts++;

        // Fetch transactions
        let transactions: any[] = [];
        try {
          const txResult = await finexerGet(`/bank_accounts/${accountId}/transactions`);
          transactions = txResult.data ?? txResult ?? [];
        } catch (err: any) {
          request.log.error(`Finexer transactions error for account ${accountId}: ${err.message}`);
          continue;
        }

        // Filter by date
        transactions = transactions.filter((tx: any) => {
          const txDate = new Date(tx.timestamp);
          return txDate >= fromDate;
        });

        // Deduplicate
        const { data: existingRows } = await supabase
          .from('transactions')
          .select('id')
          .eq('user_id', userId)
          .eq('accountId', accountId);
        const existingIds = new Set((existingRows || []).map((r: any) => r.id));

        const newTxs = transactions.filter((tx: any) => !existingIds.has(tx.id));
        if (newTxs.length === 0) continue;

        const txRows = newTxs.map((tx: any) => {
          const rawAmount = tx.amount ?? 0;
          const amount = Math.abs(rawAmount);
          const direction = tx.type === 'credit' ? 'inflow' : 'outflow';
          const currency = (tx.currency || 'GBP') as string;

          return {
            id: tx.id,
            user_id: userId,
            date: tx.timestamp,
            amount,
            currency,
            direction,
            description: String(tx.description || tx.reference || ''),
            merchant: tx.merchant || null,
            category: tx.category || 'Uncategorized',
            accountId,
            isRecurring: false,
            affectsPlan: false,
            tags: [] as string[],
          };
        });

        await supabase.from('transactions').insert(txRows);
        totalTransactions += txRows.length;
      }

      return reply.send({ ok: true, accountCount: totalAccounts, transactionCount: totalTransactions });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to sync' });
    }
  });
}
