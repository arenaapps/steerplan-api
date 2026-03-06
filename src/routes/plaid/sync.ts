import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { plaidClient } from '../../lib/plaid.js';
import { supabase } from '../../lib/supabase.js';
import { decryptPayload, encryptPayload } from '../../lib/encryption.js';

export async function plaidSyncRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('backfill_months')
        .eq('clerk_user_id', userId)
        .maybeSingle();
      const backfillMonths = profile?.backfill_months ?? 3;
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - backfillMonths);

      const { data: items, error: itemsError } = await supabase
        .from('plaid_items')
        .select('*')
        .eq('user_id', userId);

      if (itemsError) {
        return reply.code(500).send({ error: itemsError.message });
      }

      await Promise.all(
        (items || []).map(async (item) => {
          const payload = await decryptPayload<{ access_token: string }>(item.payload_enc);
          if (!payload?.access_token) return;
          const { access_token } = payload;

          let accountsRes: any;
          try {
            accountsRes = await plaidClient.accountsGet({ access_token });
          } catch (err: any) {
            request.log.error(err?.response?.data ?? err, `Plaid accountsGet error for item ${item.item_id}`);
            return;
          }

          const accounts = accountsRes.data.accounts ?? [];
          await Promise.all(
            accounts.map(async (account: any) => {
              await supabase
                .from('plaid_accounts')
                .upsert(
                  { account_id: account.account_id, item_id: item.item_id, user_id: userId },
                  { onConflict: 'account_id' }
                );

              const bankAccountData = {
                id: account.account_id,
                name: account.name || account.official_name || 'Account',
                provider: item.institution_name || 'Bank',
                lastFour: account.mask ?? null,
                balance:
                  account.balances?.current != null
                    ? `£${account.balances.current.toFixed(2)}`
                    : '',
                overdraft: '',
                _plaidItemId: item.item_id,
              };

              const bankEnc = await encryptPayload(bankAccountData);
              await supabase
                .from('bank_accounts')
                .upsert({ id: account.account_id, user_id: userId, payload_enc: bankEnc });
            })
          );

          // Sync transactions with cursor
          let cursor: string | null = item.cursor ?? null;
          let hasMore = true;
          const added: any[] = [];
          const removed: string[] = [];

          while (hasMore) {
            let txRes: any;
            try {
              txRes = await plaidClient.transactionsSync({
                access_token,
                ...(cursor ? { cursor } : {}),
              });
            } catch (err: any) {
              const plaidErr = err?.response?.data;
              request.log.error(plaidErr ?? err, `Plaid transactionsSync error for item ${item.item_id}`);
              if (plaidErr?.error_code !== 'PRODUCT_NOT_READY') {
                throw new Error(plaidErr?.error_message ?? err?.message ?? 'transactionsSync failed');
              }
              break;
            }

            added.push(...(txRes.data.added ?? []));
            removed.push(...(txRes.data.removed?.map((r: any) => r.transaction_id) ?? []));
            cursor = txRes.data.next_cursor;
            hasMore = txRes.data.has_more ?? false;
          }

          if (removed.length > 0) {
            await supabase
              .from('transactions')
              .delete()
              .eq('user_id', userId)
              .in('id', removed);
          }

          const newTxRows = added
            .filter((tx: any) => {
              if (!tx.date) return false;
              return new Date(tx.date) >= cutoff;
            })
            .map((tx: any) => {
              const rawAmount = tx.amount ?? 0;
              const amount = Math.abs(rawAmount);
              const direction = rawAmount > 0 ? 'outflow' : 'inflow';

              return {
                id: tx.transaction_id,
                user_id: userId,
                date: tx.date,
                amount,
                currency: (tx.iso_currency_code ?? 'GBP') as string,
                direction,
                description: tx.name ?? tx.merchant_name ?? '',
                merchant: tx.merchant_name ?? null,
                category:
                  tx.personal_finance_category?.primary ?? tx.category?.[0] ?? 'Uncategorized',
                accountId: tx.account_id,
                isRecurring: false,
                affectsPlan: false,
                tags: [] as string[],
              };
            });

          if (newTxRows.length > 0) {
            await supabase
              .from('transactions')
              .upsert(newTxRows, { onConflict: 'id' });
          }

          await supabase
            .from('plaid_items')
            .update({ cursor })
            .eq('item_id', item.item_id);
        })
      );

      return reply.send({ ok: true });
    } catch (error: any) {
      request.log.error(error, 'Plaid sync error');
      return reply.code(500).send({ error: error?.message ?? 'Failed to sync' });
    }
  });
}
