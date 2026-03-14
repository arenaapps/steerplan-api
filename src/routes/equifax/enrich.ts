import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';
import { decryptPayload } from '../../lib/encryption.js';
import { createAndEnrich, transformYapilyToEquifax } from '../../lib/equifax-obi.js';
import { addEquifaxJob } from '../../queues/jobs.js';
import { createClerkClient } from '@clerk/backend';
import { config } from '../../config.js';

export async function equifaxEnrichRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;

    try {
      // Check if already enriched
      const { data: existing } = await supabase
        .from('equifax_customers')
        .select('equifax_customer_id')
        .eq('user_id', userId)
        .maybeSingle();

      // Fetch user's bank accounts (decrypted)
      const { data: bankAccounts } = await supabase
        .from('bank_accounts')
        .select('id, payload_enc')
        .eq('user_id', userId);

      if (!bankAccounts?.length) {
        return reply.code(400).send({ error: 'No bank accounts connected' });
      }

      // Decrypt bank account data
      const accounts: any[] = [];
      for (const ba of bankAccounts) {
        const payload = await decryptPayload<any>(ba.payload_enc);
        if (payload) {
          accounts.push({ ...payload, id: ba.id });
        }
      }

      // Fetch transactions
      const { data: transactions } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(1000);

      // Get user info from Clerk
      const clerk = createClerkClient({ secretKey: config.clerk.secretKey });
      const user = await clerk.users.getUser(userId);
      const customerName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User';
      const customerEmail = user.emailAddresses?.[0]?.emailAddress || '';

      // Transform to Equifax format
      const equifaxData = transformYapilyToEquifax(accounts, transactions || []);

      // Create and enrich
      const customerId = await createAndEnrich({
        customerName,
        customerEmail,
        accounts: equifaxData.accounts,
        transactions: equifaxData.transactions,
      });

      // Store mapping
      if (existing) {
        await supabase
          .from('equifax_customers')
          .update({ equifax_customer_id: customerId, updated_at: new Date().toISOString() })
          .eq('user_id', userId);
      } else {
        await supabase.from('equifax_customers').insert({
          user_id: userId,
          equifax_customer_id: customerId,
        });
      }

      // Queue job to fetch insights
      void addEquifaxJob('fetch-insights', { userId }).catch(() => {});

      return reply.send({ ok: true, customerId });
    } catch (error: any) {
      request.log.error(`Equifax enrich failed: ${error.message}`);
      return reply.code(500).send({ error: error?.message || 'Enrichment failed' });
    }
  });
}
