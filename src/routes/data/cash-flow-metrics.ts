import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';
import { decryptPayload, encryptPayload } from '../../lib/encryption.js';

export async function cashFlowMetricsRoutes(app: FastifyInstance) {
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data, error } = await supabase
        .from('cash_flow_metrics')
        .select('payload_enc')
        .eq('user_id', request.userId);
      if (error) throw error;

      const rows = await Promise.all(
        (data || []).map((row) => decryptPayload(row.payload_enc))
      );
      return reply.send(rows.filter(Boolean));
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to load metrics' });
    }
  });

  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const metrics = request.body as unknown[];
      const payloads = await Promise.all(
        (metrics || []).map((row) => encryptPayload(row))
      );
      const rows = payloads.map((payload_enc) => ({ user_id: request.userId, payload_enc }));

      await supabase.from('cash_flow_metrics').delete().eq('user_id', request.userId);
      if (rows.length > 0) {
        const { error } = await supabase.from('cash_flow_metrics').insert(rows);
        if (error) throw error;
      }

      return reply.send({ ok: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to save metrics' });
    }
  });
}
