import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { config } from '../config.js';

const env = config.plaid.env as keyof typeof PlaidEnvironments;

const plaidConfig = new Configuration({
  basePath: PlaidEnvironments[env] ?? PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': config.plaid.clientId,
      'PLAID-SECRET': config.plaid.secret,
    },
  },
});

export const plaidClient = new PlaidApi(plaidConfig);
