import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';

export async function merchantRulesRoutes(app: FastifyInstance) {
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data, error } = await supabase
        .from('merchant_category_rules')
        .select('id, merchant, category, created_at')
        .eq('user_id', request.userId);
      if (error) throw error;

      return reply.send(data || []);
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to load merchant rules' });
    }
  });

  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { merchant, category } = request.body as { merchant: string; category: string };
      if (!merchant || !category) {
        return reply.code(400).send({ error: 'merchant and category are required' });
      }

      const { error } = await supabase
        .from('merchant_category_rules')
        .upsert(
          { user_id: request.userId, merchant: merchant.toLowerCase(), category },
          { onConflict: 'user_id,merchant' }
        );
      if (error) throw error;

      return reply.send({ ok: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to save merchant rule' });
    }
  });
}
