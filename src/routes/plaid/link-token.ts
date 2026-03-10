import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { plaidClient } from '../../lib/plaid.js';
import { CountryCode, Products, IncomeVerificationSourceType } from 'plaid';
import { config } from '../../config.js';
import { supabase } from '../../lib/supabase.js';
import { encryptPayload, decryptPayload } from '../../lib/encryption.js';

interface PlaidUserRecord {
  plaid_user_id: string;
  user_token: string | null;
}

/**
 * Get or create a Plaid user for the given Clerk user.
 * Returns both user_id and user_token (income verification requires user_token).
 */
async function getOrCreatePlaidUser(clerkUserId: string): Promise<PlaidUserRecord> {
  // Check for existing
  const { data: existing } = await supabase
    .from('plaid_user_tokens')
    .select('plaid_user_id, user_token_enc')
    .eq('clerk_user_id', clerkUserId)
    .single();

  if (existing?.plaid_user_id) {
    let userToken: string | null = null;
    if (existing.user_token_enc) {
      userToken = await decryptPayload<string>(existing.user_token_enc) ?? null;
    }
    // If we have a stored user but no user_token, try re-creating to get one
    if (!userToken) {
      try {
        const response = await plaidClient.userCreate({ client_user_id: clerkUserId });
        userToken = response.data.user_token ?? null;
        if (userToken) {
          const userTokenEnc = await encryptPayload(userToken);
          await supabase.from('plaid_user_tokens').update({
            user_token_enc: userTokenEnc,
            plaid_user_id: response.data.user_id,
          }).eq('clerk_user_id', clerkUserId);
          return { plaid_user_id: response.data.user_id, user_token: userToken };
        }
      } catch {
        // userCreate may fail if user already exists — continue with what we have
      }
    }
    return { plaid_user_id: existing.plaid_user_id, user_token: userToken };
  }

  // Create new Plaid user
  const response = await plaidClient.userCreate({
    client_user_id: clerkUserId,
  });

  const plaidUserId = response.data.user_id;
  const userToken = response.data.user_token ?? null;
  const userTokenEnc = userToken ? await encryptPayload(userToken) : '';

  await supabase.from('plaid_user_tokens').upsert({
    clerk_user_id: clerkUserId,
    user_token_enc: userTokenEnc,
    plaid_user_id: plaidUserId,
  });

  return { plaid_user_id: plaidUserId, user_token: userToken };
}

export { getOrCreatePlaidUser };

export async function plaidLinkTokenRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = (request.body ?? {}) as { include_income?: boolean };
      const includeIncome = body.include_income === true;
      const redirectUri = config.plaid.redirectUri;

      const products: Products[] = [Products.Transactions];
      let incomeVerification: Record<string, unknown> | undefined;
      let userIdField: Record<string, string> = {};

      if (includeIncome) {
        products.push(Products.IncomeVerification);
        const plaidUser = await getOrCreatePlaidUser(request.userId);
        incomeVerification = {
          income_source_types: [IncomeVerificationSourceType.Bank],
          bank_income: { days_requested: 365 },
        };
        // Income verification requires user_token; fall back to user_id if unavailable
        if (plaidUser.user_token) {
          userIdField = { user_token: plaidUser.user_token };
        } else {
          userIdField = { user_id: plaidUser.plaid_user_id };
        }
      }

      const response = await plaidClient.linkTokenCreate({
        user: { client_user_id: request.userId },
        client_name: 'Steerplan',
        products,
        country_codes: [CountryCode.Gb],
        language: 'en',
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
        ...userIdField,
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
