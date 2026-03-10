import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createClerkClient } from '@clerk/backend';
import { finexerPost } from '../../lib/finexer.js';
import { config } from '../../config.js';
import { supabase } from '../../lib/supabase.js';

const clerk = createClerkClient({ secretKey: config.clerk.secretKey });

export async function finexerConsentRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;
    try {
      const body = request.body as { providerId?: string };

      // Get or create Finexer customer for this Clerk user
      const { data: existing } = await supabase
        .from('finexer_customers')
        .select('finexer_customer_id')
        .eq('clerk_user_id', userId)
        .maybeSingle();

      let customerId = existing?.finexer_customer_id;

      if (!customerId) {
        const user = await clerk.users.getUser(userId);
        const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'User';
        const email = user.emailAddresses?.[0]?.emailAddress || '';

        const customerResult = await finexerPost('/customers', { name, email });
        customerId = customerResult.data?.id ?? customerResult.id;

        if (!customerId) {
          return reply.code(500).send({ error: 'Failed to create Finexer customer' });
        }

        await supabase.from('finexer_customers').insert({
          clerk_user_id: userId,
          finexer_customer_id: customerId,
        });
      }

      // Create consent
      const retroDate = new Date();
      retroDate.setFullYear(retroDate.getFullYear() - 1);

      const consentBody: Record<string, string> = {
        customer: customerId,
        'scopes[]': 'accounts,balance,transactions',
        return_url: config.finexer.returnUrl,
        retro_date: retroDate.toISOString().slice(0, 10),
      };

      if (body?.providerId) {
        consentBody.provider = body.providerId;
      }

      const consentResult = await finexerPost('/consents', consentBody);
      const consentId = consentResult.data?.id ?? consentResult.id;
      const consentUrl = consentResult.data?.redirect?.consent_url
        ?? consentResult.redirect?.consent_url;

      if (!consentId || !consentUrl) {
        request.log.error({ consentResult }, 'Missing consent data from Finexer');
        return reply.code(500).send({ error: 'No consent URL from Finexer' });
      }

      // Store consent record
      await supabase.from('finexer_consents').insert({
        user_id: userId,
        consent_id: consentId,
        provider_id: body?.providerId ?? null,
        provider_name: null,
      });

      return reply.send({ consentId, consentUrl });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to create consent' });
    }
  });
}
