import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { plaidClient } from '../../lib/plaid.js';
import { CountryCode, Products, IncomeVerificationSourceType } from 'plaid';
import { config } from '../../config.js';
import { getOrCreatePlaidUser } from './link-token.js';

export async function plaidIncomeLinkTokenRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const redirectUri = config.plaid.redirectUri;
      const plaidUser = await getOrCreatePlaidUser(request.userId);

      const response = await plaidClient.linkTokenCreate({
        user: { client_user_id: request.userId },
        client_name: 'Steerplan',
        products: [Products.IncomeVerification],
        country_codes: [CountryCode.Gb],
        language: 'en',
        user_token: plaidUser.user_token,
        income_verification: {
          income_source_types: [IncomeVerificationSourceType.Bank],
          bank_income: { days_requested: 365 },
        },
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
      });

      return reply.send({ link_token: response.data.link_token });
    } catch (error: any) {
      const plaidError = error?.response?.data;
      request.log.error(plaidError ?? error, 'Plaid income-link-token error');
      return reply.code(500).send({
        error: plaidError?.error_message ?? error?.message ?? 'Failed to create income link token',
      });
    }
  });
}
