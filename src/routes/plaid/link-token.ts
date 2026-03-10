import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { plaidClient } from '../../lib/plaid.js';
import { CountryCode, Products, IncomeVerificationSourceType } from 'plaid';
import { config } from '../../config.js';
import { supabase } from '../../lib/supabase.js';
import { encryptPayload, decryptPayload } from '../../lib/encryption.js';

/**
 * Get or create a Plaid user_id for the given Clerk user.
 * Post-Dec 2025 integrations use `user_id` (not `user_token`).
 */
async function getOrCreatePlaidUserId(clerkUserId: string): Promise<string> {
  // Check for existing
  const { data: existing } = await supabase
    .from('plaid_user_tokens')
    .select('plaid_user_id')
    .eq('clerk_user_id', clerkUserId)
    .single();

  if (existing?.plaid_user_id) {
    return existing.plaid_user_id;
  }

  // Create new Plaid user
  const response = await plaidClient.userCreate({
    client_user_id: clerkUserId,
  });

  const plaidUserId = response.data.user_id;

  // Also store user_token if returned (legacy integrations)
  const userToken = response.data.user_token;
  const userTokenEnc = userToken ? await encryptPayload(userToken) : null;

  await supabase.from('plaid_user_tokens').upsert({
    clerk_user_id: clerkUserId,
    user_token_enc: userTokenEnc ?? '',
    plaid_user_id: plaidUserId,
  });

  return plaidUserId;
}

export { getOrCreatePlaidUserId };

export async function plaidLinkTokenRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = (request.body ?? {}) as { include_income?: boolean };
      const includeIncome = body.include_income === true;
      const redirectUri = config.plaid.redirectUri;

      const products: Products[] = [Products.Transactions];
      let plaidUserId: string | undefined;
      let incomeVerification: Record<string, unknown> | undefined;

      if (includeIncome) {
        products.push(Products.IncomeVerification);
        plaidUserId = await getOrCreatePlaidUserId(request.userId);
        incomeVerification = {
          income_source_types: [IncomeVerificationSourceType.Bank],
          bank_income: { days_requested: 365 },
        };
      }

      const response = await plaidClient.linkTokenCreate({
        user: { client_user_id: request.userId },
        client_name: 'Steerplan',
        products,
        country_codes: [CountryCode.Gb],
        language: 'en',
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
        ...(plaidUserId ? { user_id: plaidUserId } : {}),
        ...(incomeVerification ? { income_verification: incomeVerification } : {}),
      });

      return reply.send({ link_token: response.data.link_token });
    } catch (error: any) {
      const plaidError = error?.response?.data;
      request.log.error(plaidError ?? error, 'Plaid link-token error');
      return reply.code(500).send({
        error: plaidError?.error_message ?? error?.message ?? 'Failed to create link token',
      });
    }
  });
}
