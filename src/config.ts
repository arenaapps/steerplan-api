function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  get isDev() { return this.nodeEnv === 'development'; },

  supabase: {
    get url() { return required('SUPABASE_URL'); },
    get serviceRoleKey() { return required('SUPABASE_SERVICE_ROLE_KEY'); },
    get encryptionKey() { return required('SUPABASE_ENCRYPTION_KEY'); },
  },

  clerk: {
    get secretKey() { return required('CLERK_SECRET_KEY'); },
    get publishableKey() { return required('CLERK_PUBLISHABLE_KEY'); },
    get webhookSecret() { return required('CLERK_WEBHOOK_SECRET'); },
  },

  anthropic: {
    get apiKey() { return required('ANTHROPIC_API_KEY'); },
  },

  upstash: {
    get url() { return process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || ''; },
    get token() { return process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || ''; },
    get configured() { return !!(this.url && this.token); },
  },

  redis: {
    get url() { return process.env.REDIS_URL || ''; },
    get configured() { return !!this.url; },
  },

  yapily: {
    get applicationKey() { return required('YAPILY_APPLICATION_KEY'); },
    get applicationSecret() { return required('YAPILY_APPLICATION_SECRET'); },
  },

  plaid: {
    get clientId() { return required('PLAID_CLIENT_ID'); },
    get secret() { return required('PLAID_SECRET'); },
    get env() { return optional('PLAID_ENV', 'sandbox'); },
    get redirectUri() { return process.env.PLAID_REDIRECT_URI || null; },
  },
};
