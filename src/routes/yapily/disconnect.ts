import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';
import { decryptPayload } from '../../lib/encryption.js';

export async function yapilyDisconnectRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;
    const body = request.body as { accountId: string };
    if (!body?.accountId) {
      return reply.code(400).send({ error: 'Missing accountId' });
    }

    const { accountId } = body;

    const { data: allAccounts } = await supabase
      .from('bank_accounts')
      .select('id, payload_enc')
      .eq('user_id', userId);

    const target = (allAccounts || []).find((a) => a.id === accountId);
    if (!target) {
      return reply.code(404).send({ error: 'Account not found' });
    }

    const targetPayload = await decryptPayload<{ _institutionId?: string }>(target.payload_enc);
    const institutionId = targetPayload?._institutionId ?? null;

    const accountIdsToDelete: string[] = [accountId];

    if (institutionId) {
      for (const acc of allAccounts || []) {
        if (acc.id === accountId) continue;
        const payload = await decryptPayload<{ _institutionId?: string }>(acc.payload_enc);
        if (payload?._institutionId === institutionId) {
          accountIdsToDelete.push(acc.id);
        }
      }
    }

    for (const id of accountIdsToDelete) {
      await supabase
        .from('transactions')
        .delete()
        .eq('user_id', userId)
        .eq('accountId', id);
    }

    await supabase
      .from('bank_accounts')
      .delete()
      .eq('user_id', userId)
      .in('id', accountIdsToDelete);

    if (institutionId) {
      await supabase
        .from('yapily_consents')
        .delete()
        .eq('user_id', userId)
        .eq('institution_id', institutionId);
    }

    return reply.send({ ok: true });
  });
}
