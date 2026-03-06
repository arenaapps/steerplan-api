import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';

export async function conversationsRoutes(app: FastifyInstance) {
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('id, title, created_at, updated_at')
        .eq('user_id', request.userId)
        .order('updated_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return reply.send(data || []);
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to load conversations' });
    }
  });

  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { title?: string };
      const title = body?.title || 'New Chat';

      const { data, error } = await supabase
        .from('conversations')
        .insert({ user_id: request.userId, title })
        .select('id, title, created_at, updated_at')
        .single();

      if (error) throw error;
      return reply.send(data);
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to create conversation' });
    }
  });
}
