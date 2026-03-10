import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { plaidClient } from '../../lib/plaid.js';
import { CountryCode, Products, IncomeVerificationSourceType } from 'plaid';
import { config } from '../../config.js';
import { supabase } from '../../lib/supabase.js';
import { encryptPayload, decryptPayload } from '../../lib/encryption.js';

interface PlaidUserRecord {
  plaid_user_id: string;
  user_token: string;
}

/**
 * Get or create a Plaid user for the given Clerk user.
 * Uses legacy user API (plaidNewUserAPIEnabled=false) to get user_token,
 * which is required for income verification.
 */
async function getOrCreatePlaidUser(clerkUserId: string): Promise<PlaidUserRecord> {
  // Check for existing with valid user_token
  const { data: existing } = await supabase
    .from('plaid_user_tokens')
    .select('plaid_user_id, user_token_enc')
    .eq('clerk_user_id', clerkUserId)
    .single();

  if (existing?.plaid_user_id && existing.user_token_enc) {
    const userToken = await decryptPayload<string>(existing.user_token_enc);
    // Validate it looks like a real user_token (user-<env>-<id>)
    if (userToken && userToken.startsWith('user-')) {
      return { plaid_user_id: existing.plaid_user_id, user_token: userToken };
    }
  }

  // Delete stale row if exists (missing or invalid user_token)
  if (existing) {
    await supabase.from('plaid_user_tokens').delete().eq('clerk_user_id', clerkUserId);
  }

  // Create new Plaid user using LEGACY API to get user_token back
  // (income verification requires user_token, new API only returns user_id)
  const response = await plaidClient.userCreate(
    { client_user_id: clerkUserId },
    false, // plaidNewUserAPIEnabled = false → legacy API returns user_token
  );

  const userToken = response.data.user_token;
  if (!userToken) {
    throw new Error(
      'Plaid userCreate did not return user_token. ' +
      'Income verification requires user_token. ' +
      `Got user_id=${response.data.user_id}`
    );
  }

  const userTokenEnc = await encryptPayload(userToken);

  await supabase.from('plaid_user_tokens').upsert({
    clerk_user_id: clerkUserId,
    user_token_enc: userTokenEnc,
    plaid_user_id: response.data.user_id,
  });

  return { plaid_user_id: response.data.user_id, user_token: userToken };
}

export { getOrCreatePlaidUser };

export async function plaidLinkTokenRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = (request.body ?? {}) as { include_income?: boolean };
      const includeIncome = body.include_income === true;
      const redirectUri = config.plaid.redirectUri;

      const products: Products[] = [Products.Transactions];
      let userToken: string | undefined;
      let incomeVerification: Record<string, unknown> | undefined;

      if (includeIncome) {
        products.push(Products.IncomeVerification);
        const plaidUser = await getOrCreatePlaidUser(request.userId);
        userToken = plaidUser.user_token;
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
        ...(userToken ? { user_token: userToken } : {}),
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
