import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';
import { decryptPayload, encryptPayload } from '../../lib/encryption.js';

export async function profitLossRoutes(app: FastifyInstance) {
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data, error } = await supabase
        .from('profit_loss_data')
        .select('payload_enc')
        .eq('user_id', request.userId);
      if (error) throw error;

      const rows = await Promise.all(
        (data || []).map((row) => decryptPayload(row.payload_enc))
      );
      return reply.send(rows.filter(Boolean));
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to load profit loss data' });
    }
  });

  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const rowsInput = request.body as Array<Record<string, unknown>>;
      const rows = await Promise.all(
        (rowsInput || []).map(async (item) => ({
          user_id: request.userId,
          payload_enc: await encryptPayload(item),
        }))
      );

      await supabase.from('profit_loss_data').delete().eq('user_id', request.userId);
      if (rows.length > 0) {
        const { error } = await supabase.from('profit_loss_data').insert(rows);
        if (error) throw error;
      }

      return reply.send({ ok: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to save profit loss data' });
    }
  });
}
