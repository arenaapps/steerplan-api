import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';
import { decryptPayload, encryptPayload } from '../../lib/encryption.js';

export async function obligationsRoutes(app: FastifyInstance) {
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data, error } = await supabase
        .from('obligations')
        .select('payload_enc')
        .eq('user_id', request.userId);
      if (error) throw error;

      const rows = await Promise.all(
        (data || []).map((row) => decryptPayload(row.payload_enc))
      );
      return reply.send(rows.filter(Boolean));
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to load obligations' });
    }
  });

  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const obligations = request.body as Array<{ id?: string }>;
      const rows = await Promise.all(
        (obligations || []).map(async (obligation) => ({
          id: obligation.id,
          user_id: request.userId,
          payload_enc: await encryptPayload(obligation),
        }))
      );

      await supabase.from('obligations').delete().eq('user_id', request.userId);
      if (rows.length > 0) {
        const { error } = await supabase.from('obligations').insert(rows);
        if (error) throw error;
      }

      return reply.send({ ok: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to save obligations' });
    }
  });
}
