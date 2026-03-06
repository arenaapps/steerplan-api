import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { plaidClient } from '../../lib/plaid.js';
import { supabase } from '../../lib/supabase.js';
import { decryptPayload } from '../../lib/encryption.js';

export async function plaidDisconnectRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;
    const body = request.body as { accountId: string };
    if (!body?.accountId) {
      return reply.code(400).send({ error: 'Missing accountId' });
    }

    const { accountId } = body;

    const { data: plaidAccount } = await supabase
      .from('plaid_accounts')
      .select('account_id, item_id')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (!plaidAccount) {
      return reply.code(404).send({ error: 'Account not found' });
    }

    const { item_id } = plaidAccount;

    const { data: itemAccounts } = await supabase
      .from('plaid_accounts')
      .select('account_id')
      .eq('user_id', userId)
      .eq('item_id', item_id);

    const accountIdsToDelete = (itemAccounts ?? []).map((a) => a.account_id);

    const { data: plaidItem } = await supabase
      .from('plaid_items')
      .select('payload_enc')
      .eq('user_id', userId)
      .eq('item_id', item_id)
      .maybeSingle();

    if (plaidItem?.payload_enc) {
      const payload = await decryptPayload<{ access_token: string }>(plaidItem.payload_enc);
      if (payload?.access_token) {
        try {
          await plaidClient.itemRemove({ access_token: payload.access_token });
        } catch (err: any) {
          request.log.error(err?.response?.data ?? err, 'Plaid itemRemove error');
        }
      }
    }

    for (const aid of accountIdsToDelete) {
      await supabase
        .from('transactions')
        .delete()
        .eq('user_id', userId)
        .eq('accountId', aid);
    }

    if (accountIdsToDelete.length > 0) {
      await supabase
        .from('bank_accounts')
        .delete()
        .eq('user_id', userId)
        .in('id', accountIdsToDelete);
    }

    await supabase
      .from('plaid_accounts')
      .delete()
      .eq('user_id', userId)
      .eq('item_id', item_id);

    await supabase
      .from('plaid_items')
      .delete()
      .eq('user_id', userId)
      .eq('item_id', item_id);

    return reply.send({ ok: true });
  });
}
