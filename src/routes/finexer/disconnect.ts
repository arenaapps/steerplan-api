import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { finexerPost } from '../../lib/finexer.js';
import { supabase } from '../../lib/supabase.js';
import { decryptPayload } from '../../lib/encryption.js';

export async function finexerDisconnectRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;
    const body = request.body as { accountId: string };
    if (!body?.accountId) {
      return reply.code(400).send({ error: 'Missing accountId' });
    }

    const { accountId } = body;

    // Find the account and decrypt to get the consent ID
    const { data: allAccounts } = await supabase
      .from('bank_accounts')
      .select('id, payload_enc')
      .eq('user_id', userId);

    const target = (allAccounts || []).find((a) => a.id === accountId);
    if (!target) {
      return reply.code(404).send({ error: 'Account not found' });
    }

    const targetPayload = await decryptPayload<{ _finexerConsentId?: string }>(target.payload_enc);
    const consentId = targetPayload?._finexerConsentId ?? null;

    if (!consentId) {
      return reply.code(400).send({ error: 'Account is not a Finexer connection' });
    }

    // Find all accounts linked to the same consent
    const accountIdsToDelete: string[] = [];
    for (const acc of allAccounts || []) {
      const payload = await decryptPayload<{ _finexerConsentId?: string }>(acc.payload_enc);
      if (payload?._finexerConsentId === consentId) {
        accountIdsToDelete.push(acc.id);
      }
    }

    // Revoke consent on Finexer
    try {
      await finexerPost(`/consents/${consentId}/revoke`, {});
    } catch (err: any) {
      request.log.error(`Finexer consent revoke error: ${err.message}`);
      // Continue with local cleanup even if revoke fails
    }

    // Delete transactions for all affected accounts
    for (const id of accountIdsToDelete) {
      await supabase
        .from('transactions')
        .delete()
        .eq('user_id', userId)
        .eq('accountId', id);
    }

    // Delete bank accounts
    await supabase
      .from('bank_accounts')
      .delete()
      .eq('user_id', userId)
      .in('id', accountIdsToDelete);

    // Delete consent record
    await supabase
      .from('finexer_consents')
      .delete()
      .eq('user_id', userId)
      .eq('consent_id', consentId);

    return reply.send({ ok: true });
  });
}
