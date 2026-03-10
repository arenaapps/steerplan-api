import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { plaidClient } from '../../lib/plaid.js';
import { CountryCode, Products, IncomeVerificationSourceType } from 'plaid';
import { config } from '../../config.js';
import { supabase } from '../../lib/supabase.js';
import { encryptPayload, decryptPayload } from '../../lib/encryption.js';

async function getOrCreateUserToken(userId: string): Promise<string> {
  // Check for existing user_token
  const { data: existing } = await supabase
    .from('plaid_user_tokens')
    .select('user_token_enc')
    .eq('clerk_user_id', userId)
    .single();

  if (existing?.user_token_enc) {
    const decrypted = await decryptPayload<string>(existing.user_token_enc);
    if (decrypted) return decrypted;
  }

  // Create new user_token
  const response = await plaidClient.userCreate({
    client_user_id: userId,
  });

  const userToken = response.data.user_token;
  const userTokenEnc = await encryptPayload(userToken);

  await supabase.from('plaid_user_tokens').upsert({
    clerk_user_id: userId,
    user_token_enc: userTokenEnc,
    plaid_user_id: response.data.user_id,
  });

  return userToken;
}

export { getOrCreateUserToken };

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
        userToken = await getOrCreateUserToken(request.userId);
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
