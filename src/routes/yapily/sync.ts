import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { yapilyGet } from '../../lib/yapily.js';
import { supabase } from '../../lib/supabase.js';
import { decryptPayload, encryptPayload } from '../../lib/encryption.js';
import { addEmbeddingJob } from '../../queues/jobs.js';

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

export async function yapilySyncRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;
    try {
      let body: { consentToken?: string; institutionId?: string } = {};
      try { body = request.body as any; } catch { /* no body */ }

      if (body.consentToken && body.institutionId) {
        const enc = await encryptPayload({
          consentToken: body.consentToken,
          institutionId: body.institutionId,
        });

        let institutionName: string | null = null;
        try {
          const inst = await yapilyGet(`/institutions/${body.institutionId}`);
          institutionName = inst.data?.name || null;
        } catch { /* non-critical */ }

        await supabase
          .from('yapily_consents')
          .delete()
          .eq('user_id', userId)
          .eq('institution_id', body.institutionId);

        await supabase.from('yapily_consents').insert({
          user_id: userId,
          consent_token_enc: enc,
          institution_id: body.institutionId,
          institution_name: institutionName,
        });
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('backfill_months')
        .eq('clerk_user_id', userId)
        .maybeSingle();
      const backfillMonths = profile?.backfill_months ?? 3;
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - backfillMonths);
      const fromDate = threeMonthsAgo.toISOString();

      const { data: consents, error: consentsError } = await supabase
        .from('yapily_consents')
        .select('*')
        .eq('user_id', userId);

      if (consentsError) {
        return reply.code(500).send({ error: consentsError.message });
      }

      await Promise.all(
        (consents || []).map(async (consent) => {
          const payload = await decryptPayload<{ consentToken: string; institutionId: string }>(
            consent.consent_token_enc
          );
          if (!payload?.consentToken) return;
          const { consentToken } = payload;

          let accountsRes: any;
          try {
            accountsRes = await yapilyGet('/accounts', consentToken);
          } catch (err: any) {
            request.log.error(`Yapily accounts error for institution ${consent.institution_id}: ${err.message}`);
            return;
          }

          await Promise.all(
            (accountsRes.data || []).map(async (account: any) => {
              const lastFour =
                account.accountIdentifications?.find((i: any) => i.type === 'ACCOUNT_NUMBER')
                  ?.identification?.slice(-4) ?? null;

              const bankAccountData = {
                id: account.id,
                name:
                  account.nickname ||
                  account.description ||
                  account.accountNames?.[0]?.name ||
                  'Account',
                provider: consent.institution_name || 'Bank',
                lastFour,
                balance: formatMoney(account.balance ?? 0, account.currency || 'GBP'),
                overdraft: '',
                _institutionId: consent.institution_id,
              };

              const enc = await encryptPayload(bankAccountData);
              await supabase
                .from('bank_accounts')
                .upsert({ id: account.id, user_id: userId, payload_enc: enc });

              let txRes: any;
              try {
                txRes = await yapilyGet(
                  `/accounts/${account.id}/transactions?from=${fromDate}&limit=500`,
                  consentToken
                );
              } catch (err: any) {
                request.log.error(`Yapily transactions error for account ${account.id}: ${err.message}`);
                return;
              }

              const { data: existingRows } = await supabase
                .from('transactions')
                .select('id')
                .eq('user_id', userId)
                .eq('accountId', account.id);
              const existingIds = new Set((existingRows || []).map((r: any) => r.id));
              const newTxs = (txRes.data || []).filter((tx: any) => !existingIds.has(tx.id));

              if (newTxs.length === 0) return;

              const txRows = newTxs.map((tx: any) => {
                const rawAmount = tx.amount ?? tx.transactionAmount?.amount ?? 0;
                const amount = Math.abs(rawAmount);
                const direction = rawAmount < 0 ? 'outflow' : 'inflow';
                const currency = (tx.currency || tx.transactionAmount?.currency || 'GBP') as string;

                return {
                  id: tx.id,
                  user_id: userId,
                  date: tx.date,
                  amount,
                  currency,
                  direction,
                  description: String(tx.transactionInformation || tx.reference || ''),
                  merchant:
                    tx.enrichedMerchant?.merchantName ||
                    tx.merchant?.merchantName ||
                    null,
                  category:
                    tx.proprietaryBankTransactionCode?.code ||
                    tx.isoBankTransactionCode?.domainCode?.name ||
                    'Uncategorized',
                  accountId: account.id,
                  isRecurring: false,
                  affectsPlan: false,
                  tags: [] as string[],
                };
              });

              await supabase.from('transactions').insert(txRows);
            })
          );
        })
      );

      // Fire-and-forget: index transactions for RAG
      void addEmbeddingJob('index-transactions', { userId }).catch(() => {});

      return reply.send({ ok: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to sync' });
    }
  });
}
