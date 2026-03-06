import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { plaidClient } from '../../lib/plaid.js';
import { CountryCode, Products } from 'plaid';
import { config } from '../../config.js';

export async function plaidLinkTokenRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const redirectUri = config.plaid.redirectUri;

      const response = await plaidClient.linkTokenCreate({
        user: { client_user_id: request.userId },
        client_name: 'Steerplan',
        products: [Products.Transactions],
        country_codes: [CountryCode.Gb],
        language: 'en',
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
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
