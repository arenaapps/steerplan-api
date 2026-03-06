import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';

export async function potsRoutes(app: FastifyInstance) {
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data, error } = await supabase
        .from('pots')
        .select('*')
        .eq('user_id', request.userId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return reply.send(data || []);
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to load pots' });
    }
  });

  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { name: string; target?: number; saved?: number; color?: string; emoji?: string };
      if (!body.name) return reply.code(400).send({ error: 'Missing name' });

      const { data, error } = await supabase
        .from('pots')
        .insert({
          user_id: request.userId,
          name: body.name,
          target: body.target ?? 0,
          saved: body.saved ?? 0,
          color: body.color ?? null,
          emoji: body.emoji ?? null,
        })
        .select('*')
        .single();

      if (error) throw error;
      return reply.send(data);
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to create pot' });
    }
  });

  app.patch('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { id: string; name?: string; target?: number; saved?: number; color?: string; emoji?: string };
      if (!body.id) return reply.code(400).send({ error: 'Missing id' });

      const allowed: Record<string, any> = {};
      if (body.name !== undefined) allowed.name = body.name;
      if (body.target !== undefined) allowed.target = body.target;
      if (body.saved !== undefined) allowed.saved = body.saved;
      if (body.color !== undefined) allowed.color = body.color;
      if (body.emoji !== undefined) allowed.emoji = body.emoji;

      const { data, error } = await supabase
        .from('pots')
        .update(allowed)
        .eq('id', body.id)
        .eq('user_id', request.userId)
        .select('*')
        .single();

      if (error) throw error;
      return reply.send(data);
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to update pot' });
    }
  });

  app.delete('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string | undefined>;
    const id = query.id;
    if (!id) return reply.code(400).send({ error: 'Missing id' });

    try {
      const { error } = await supabase
        .from('pots')
        .delete()
        .eq('id', id)
        .eq('user_id', request.userId);

      if (error) throw error;
      return reply.send({ ok: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to delete pot' });
    }
  });
}
