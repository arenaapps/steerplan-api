import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { plaidClient } from '../../lib/plaid.js';
import { supabase } from '../../lib/supabase.js';
import { encryptPayload } from '../../lib/encryption.js';

export async function plaidExchangeRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      public_token: string;
      institution?: { name?: string; institution_id?: string };
    };
    if (!body?.public_token) {
      return reply.code(400).send({ error: 'Missing public_token' });
    }

    try {
      const exchangeResponse = await plaidClient.itemPublicTokenExchange({
        public_token: body.public_token,
      });

      const { access_token, item_id } = exchangeResponse.data;
      const payloadEnc = await encryptPayload({ access_token });

      const { error: upsertError } = await supabase
        .from('plaid_items')
        .upsert(
          {
            item_id,
            user_id: request.userId,
            payload_enc: payloadEnc,
            cursor: null,
            institution_name: body.institution?.name ?? null,
            institution_id: body.institution?.institution_id ?? null,
          },
          { onConflict: 'item_id' }
        );

      if (upsertError) {
        request.log.error(upsertError, 'Plaid exchange: failed to store plaid_item');
        return reply.code(500).send({ error: upsertError.message });
      }

      return reply.send({ item_id });
    } catch (error: any) {
      request.log.error(error?.response?.data ?? error, 'Plaid exchange error');
      return reply.code(500).send({ error: error?.message ?? 'Failed to exchange token' });
    }
  });
}
