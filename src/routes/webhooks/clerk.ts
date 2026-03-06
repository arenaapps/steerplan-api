import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Webhook } from 'svix';
import { supabase } from '../../lib/supabase.js';
import { config } from '../../config.js';

export async function clerkWebhookRoutes(app: FastifyInstance) {
  // Need raw body for Svix verification
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      done(null, body);
    }
  );

  app.post('/clerk', async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = config.clerk.webhookSecret;

    const payload = request.body as string;
    const svixId = request.headers['svix-id'] as string;
    const svixTimestamp = request.headers['svix-timestamp'] as string;
    const svixSignature = request.headers['svix-signature'] as string;

    if (!svixId || !svixTimestamp || !svixSignature) {
      return reply.code(400).send({ error: 'Missing svix headers' });
    }

    const wh = new Webhook(secret);
    let evt: any;
    try {
      evt = wh.verify(payload, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      });
    } catch {
      return reply.code(400).send({ error: 'Invalid webhook signature' });
    }

    if (evt?.type === 'user.created') {
      const user = evt.data;
      const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ');
      const email = user.email_addresses?.[0]?.email_address || null;

      const { error } = await supabase
        .from('profiles')
        .upsert({
          clerk_user_id: user.id,
          full_name: fullName || null,
          email,
          finance_literacy: 'intermediate',
          tone: 'friend',
          emoji_level: 'light',
          default_account_context: null,
          backfill_months: 3,
        });

      if (error) {
        return reply.code(500).send({ error: error.message });
      }
    }

    if (evt?.type === 'user.deleted') {
      const deletedUserId = evt.data.id;

      await supabase.from('yapily_consents').delete().eq('user_id', deletedUserId);
      await supabase.from('transactions').delete().eq('user_id', deletedUserId);
      await supabase.from('bank_accounts').delete().eq('user_id', deletedUserId);
      await supabase.from('chat_messages').delete().eq('user_id', deletedUserId);
      await supabase.from('conversations').delete().eq('user_id', deletedUserId);
      await supabase.from('cash_flow_metrics').delete().eq('user_id', deletedUserId);
      await supabase.from('profit_loss_data').delete().eq('user_id', deletedUserId);
      await supabase.from('obligations').delete().eq('user_id', deletedUserId);
      await supabase.from('income_sources').delete().eq('user_id', deletedUserId);
      await supabase.from('outgoings_outline').delete().eq('user_id', deletedUserId);
      await supabase.from('projection_timeline').delete().eq('user_id', deletedUserId);
      await supabase.from('budgets').delete().eq('user_id', deletedUserId);
      await supabase.from('profiles').delete().eq('clerk_user_id', deletedUserId);
    }

    return reply.send({ ok: true });
  });
}
