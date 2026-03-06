import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';
import { decryptPayload, encryptPayload } from '../../lib/encryption.js';

export async function timelineRoutes(app: FastifyInstance) {
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data, error } = await supabase
        .from('projection_timeline')
        .select('payload_enc')
        .eq('user_id', request.userId);
      if (error) throw error;

      const rows = await Promise.all(
        (data || []).map((row) => decryptPayload(row.payload_enc))
      );
      return reply.send(rows.filter(Boolean));
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to load timeline' });
    }
  });

  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const timeline = request.body as Array<Record<string, unknown>>;
      const rows = await Promise.all(
        (timeline || []).map(async (item) => ({
          user_id: request.userId,
          payload_enc: await encryptPayload(item),
        }))
      );

      await supabase.from('projection_timeline').delete().eq('user_id', request.userId);
      if (rows.length > 0) {
        const { error } = await supabase.from('projection_timeline').insert(rows);
        if (error) throw error;
      }

      return reply.send({ ok: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to save timeline' });
    }
  });
}
