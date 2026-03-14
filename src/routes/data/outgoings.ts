import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';
import { decryptPayload, encryptPayload } from '../../lib/encryption.js';
import { addEmbeddingJob } from '../../queues/jobs.js';

export async function outgoingsRoutes(app: FastifyInstance) {
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data, error } = await supabase
        .from('outgoings_outline')
        .select('payload_enc')
        .eq('user_id', request.userId);
      if (error) throw error;

      const rows = await Promise.all(
        (data || []).map((row) => decryptPayload<any>(row.payload_enc))
      );
      const outgoings = rows
        .filter(Boolean)
        .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
        .map((row: any) => {
          const { position, ...rest } = row || {};
          return rest;
        });

      return reply.send(outgoings);
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to load outgoings' });
    }
  });

  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const outgoings = request.body as Array<Record<string, unknown>>;
      const rows = await Promise.all(
        (outgoings || []).map(async (item, index) => ({
          user_id: request.userId,
          payload_enc: await encryptPayload({ ...item, position: index }),
        }))
      );

      await supabase.from('outgoings_outline').delete().eq('user_id', request.userId);
      if (rows.length > 0) {
        const { error } = await supabase.from('outgoings_outline').insert(rows);
        if (error) throw error;
      }

      // Fire-and-forget: re-index outgoings for RAG
      void addEmbeddingJob('index-outgoings', { userId: request.userId }).catch(() => {});

      return reply.send({ ok: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to save outgoings' });
    }
  });

  app.delete('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string | undefined>;
    const category = query.category;

    if (!category) {
      await supabase.from('outgoings_outline').delete().eq('user_id', request.userId);
      return reply.send({ ok: true });
    }

    try {
      const { data, error } = await supabase
        .from('outgoings_outline')
        .select('payload_enc')
        .eq('user_id', request.userId);
      if (error) throw error;

      const rows = await Promise.all(
        (data || []).map((row) => decryptPayload<any>(row.payload_enc))
      );
      const filtered = rows.filter(Boolean).filter((row: any) => row.category !== category);

      const payloads = await Promise.all(
        filtered.map((row, index) => encryptPayload({ ...row, position: index }))
      );
      const nextRows = payloads.map((payload_enc) => ({
        user_id: request.userId,
        payload_enc,
      }));

      await supabase.from('outgoings_outline').delete().eq('user_id', request.userId);
      if (nextRows.length > 0) {
        const { error: insertError } = await supabase.from('outgoings_outline').insert(nextRows);
        if (insertError) throw insertError;
      }

      return reply.send({ ok: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to delete outgoing category' });
    }
  });
}
