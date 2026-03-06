import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabase.js';

const DEFAULTS = {
  finance_literacy: 'intermediate',
  tone: 'friend',
  emoji_level: 'light',
  default_account_context: null,
  backfill_months: 3,
};

export async function profileRoutes(app: FastifyInstance) {
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('clerk_user_id', request.userId)
      .maybeSingle();

    if (error) return reply.code(500).send({ error: error.message });

    if (data) return reply.send(data);

    const { data: created, error: insertError } = await supabase
      .from('profiles')
      .insert({ clerk_user_id: request.userId, ...DEFAULTS })
      .select('*')
      .maybeSingle();

    if (insertError) return reply.code(500).send({ error: insertError.message });
    return reply.send(created);
  });

  app.patch('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Partial<typeof DEFAULTS> & {
      finance_literacy?: 'noob' | 'intermediate' | 'advanced';
      is_pro?: boolean;
    };

    const updates: Record<string, unknown> = {
      finance_literacy: body.finance_literacy,
      tone: body.tone,
      emoji_level: body.emoji_level,
      default_account_context: body.default_account_context,
      backfill_months: body.backfill_months,
    };
    if (body.is_pro !== undefined) updates.is_pro = body.is_pro;

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('clerk_user_id', request.userId)
      .select('*')
      .maybeSingle();

    if (error) return reply.code(500).send({ error: error.message });
    return reply.send(data);
  });
}
