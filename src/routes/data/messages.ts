import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';

export async function messagesRoutes(app: FastifyInstance) {
  app.get('/:id/messages', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    try {
      // Verify conversation belongs to user
      const { data: conv, error: convErr } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', id)
        .eq('user_id', request.userId)
        .single();

      if (convErr || !conv) {
        return reply.code(404).send({ error: 'Conversation not found' });
      }

      const { data, error } = await supabase
        .from('chat_messages')
        .select('id, role, text, ui_blocks, meta, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return reply.send(data || []);
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to load messages' });
    }
  });

  app.post('/:id/messages', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    try {
      const body = request.body as { role: string; text: string; ui_blocks?: any; meta?: any };
      if (!body.role || !body.text) {
        return reply.code(400).send({ error: 'Missing role or text' });
      }

      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          conversation_id: id,
          user_id: request.userId,
          role: body.role,
          text: body.text,
          ui_blocks: body.ui_blocks || null,
          meta: body.meta || null,
        })
        .select('id, role, text, ui_blocks, meta, created_at')
        .single();

      if (error) throw error;

      // Update conversation's updated_at
      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', request.userId);

      return reply.send(data);
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to save message' });
    }
  });
}
