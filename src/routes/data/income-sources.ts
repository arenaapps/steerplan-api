import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';
import { decryptPayload, encryptPayload } from '../../lib/encryption.js';
import { addEmbeddingJob } from '../../queues/jobs.js';

export async function incomeSourcesRoutes(app: FastifyInstance) {
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data, error } = await supabase
        .from('income_sources')
        .select('payload_enc')
        .eq('user_id', request.userId);
      if (error) throw error;

      const rows = await Promise.all(
        (data || []).map((row) => decryptPayload(row.payload_enc))
      );
      return reply.send(rows.filter(Boolean));
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to load income' });
    }
  });

  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const income = request.body as Array<{ id?: string }>;
      const rows = await Promise.all(
        (income || []).map(async (item) => ({
          id: item.id,
          user_id: request.userId,
          payload_enc: await encryptPayload(item),
        }))
      );

      await supabase.from('income_sources').delete().eq('user_id', request.userId);
      if (rows.length > 0) {
        const { error } = await supabase.from('income_sources').insert(rows);
        if (error) throw error;
      }

      // Fire-and-forget: re-index income for RAG
      void addEmbeddingJob('index-income', { userId: request.userId }).catch(() => {});

      return reply.send({ ok: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to save income' });
    }
  });

  app.delete('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string | undefined>;
    const id = query.id;
    if (!id) return reply.code(400).send({ error: 'Missing id' });

    const { error } = await supabase
      .from('income_sources')
      .delete()
      .eq('user_id', request.userId)
      .eq('id', id);

    if (error) return reply.code(500).send({ error: error.message });
    return reply.send({ ok: true });
  });
}
