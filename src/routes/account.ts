import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createClerkClient } from '@clerk/backend';
import { supabase } from '../lib/supabase.js';
import { config } from '../config.js';

const clerk = createClerkClient({ secretKey: config.clerk.secretKey });

export async function accountRoutes(app: FastifyInstance) {
  app.delete('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;
    try {
      // Delete all user data (FK-safe order)
      await supabase.from('yapily_consents').delete().eq('user_id', userId);
      await supabase.from('transactions').delete().eq('user_id', userId);
      await supabase.from('bank_accounts').delete().eq('user_id', userId);
      await supabase.from('chat_messages').delete().eq('user_id', userId);
      await supabase.from('conversations').delete().eq('user_id', userId);
      await supabase.from('cash_flow_metrics').delete().eq('user_id', userId);
      await supabase.from('profit_loss_data').delete().eq('user_id', userId);
      await supabase.from('obligations').delete().eq('user_id', userId);
      await supabase.from('income_sources').delete().eq('user_id', userId);
      await supabase.from('outgoings_outline').delete().eq('user_id', userId);
      await supabase.from('projection_timeline').delete().eq('user_id', userId);
      await supabase.from('budgets').delete().eq('user_id', userId);
      await supabase.from('profiles').delete().eq('clerk_user_id', userId);

      // Delete Clerk user account
      await clerk.users.deleteUser(userId);

      return reply.send({ ok: true });
    } catch (error: any) {
      request.log.error(error, 'Account deletion error');
      return reply.code(500).send({ error: error?.message || 'Failed to delete account' });
    }
  });
}
