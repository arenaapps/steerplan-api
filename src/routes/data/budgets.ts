import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';

export async function budgetsRoutes(app: FastifyInstance) {
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data, error } = await supabase
        .from('budgets')
        .select('*')
        .eq('user_id', request.userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return reply.send(data || []);
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to load budgets' });
    }
  });

  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { category: string; amount: number; period?: string; notes?: string };
      const period = (body.period || 'monthly').toLowerCase();
      if (period !== 'weekly' && period !== 'monthly') {
        return reply.code(400).send({ error: 'period must be weekly or monthly' });
      }

      const { data, error } = await supabase
        .from('budgets')
        .insert({
          user_id: request.userId,
          category: body.category,
          amount: body.amount,
          period,
          notes: body.notes || null,
        })
        .select('*')
        .single();

      if (error) throw error;
      return reply.send(data);
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to create budget' });
    }
  });

  app.delete('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string | undefined>;
    const id = query.id;
    if (!id) return reply.code(400).send({ error: 'Missing id' });

    try {
      const { error } = await supabase
        .from('budgets')
        .delete()
        .eq('id', id)
        .eq('user_id', request.userId);

      if (error) throw error;
      return reply.send({ ok: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to delete budget' });
    }
  });
}
