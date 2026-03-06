# Steerplan API

Standalone Fastify API server for Steerplan — migrated from Next.js API routes.

## Stack

- **Runtime:** Node.js 20 + Fastify 5
- **Auth:** Clerk JWT verification (`@clerk/backend`)
- **Database:** Supabase (service role, RPC encryption)
- **AI:** Anthropic Claude (Sonnet for chat, Haiku for categorisation/briefing)
- **Bank Sync:** Yapily (Open Banking) + Plaid
- **Rate Limiting:** Upstash Redis (sliding window)
- **Queues:** BullMQ (email, sync, score workers)
- **Deploy:** Railway (Docker)

## Getting Started

```bash
# Install dependencies
yarn install

# Copy env file and fill in credentials
cp .env.example .env

# Run development server
yarn dev
```

The server starts on `http://localhost:3000`. Health check at `/health`.

## Project Structure

```
src/
├── index.ts                  # Entry point, route registration
├── config.ts                 # Environment variable validation
├── plugins/
│   ├── auth.ts               # Clerk JWT → request.userId
│   ├── cors.ts               # CORS for mobile + web origins
│   ├── rate-limit.ts         # Per-user read/write rate limits
│   └── error-handler.ts      # Centralized error formatting
├── lib/
│   ├── supabase.ts           # Service-role Supabase client
│   ├── encryption.ts         # Supabase RPC encrypt/decrypt
│   ├── anthropic.ts          # Anthropic client singleton
│   ├── system-instruction.ts # CFO Agent system prompt
│   ├── rate-limit.ts         # Upstash limiter definitions
│   ├── yapily.ts             # Yapily REST helpers
│   └── plaid.ts              # Plaid SDK client
├── routes/
│   ├── data/                 # 15 CRUD data routes
│   ├── ai/                   # chat (SSE), categorise, briefing
│   ├── yapily/               # institutions, consent, sync, disconnect
│   ├── plaid/                # link-token, exchange, sync, disconnect
│   ├── webhooks/clerk.ts     # Svix-verified webhook (no auth)
│   ├── profile.ts            # User profile settings
│   └── account.ts            # Account deletion
└── queues/
    ├── index.ts              # Redis connection
    ├── jobs.ts               # Queue definitions + typed helpers
    └── workers/              # email, sync, score workers
```

## API Routes

All routes are prefixed with `/api` to match the mobile app's existing path structure.

| Prefix | Routes | Auth |
|--------|--------|------|
| `/health` | `GET` | No |
| `/api/webhooks/clerk` | `POST` | Svix signature |
| `/api/profile` | `GET` `PATCH` | Clerk JWT |
| `/api/account` | `DELETE` | Clerk JWT |
| `/api/data/*` | CRUD | Clerk JWT |
| `/api/ai/chat` | `POST` (SSE) | Clerk JWT |
| `/api/ai/categorise` | `POST` | Clerk JWT |
| `/api/ai/briefing` | `POST` | Clerk JWT |
| `/api/yapily/*` | Various | Clerk JWT |
| `/api/plaid/*` | Various | Clerk JWT |

## Deployment

### Railway

1. Create a Railway project and connect the repo
2. Add all environment variables from `.env.example`
3. Deploy — Railway auto-detects the Dockerfile
4. Set up custom domain `api.steerplan.com` via CNAME
5. Update Clerk webhook URL to `https://api.steerplan.com/api/webhooks/clerk`

### Environment Variables

See [`.env.example`](.env.example) for the full list of required variables.

## Mobile App Cutover

Update `EXPO_PUBLIC_API_BASE_URL` in the mobile app's `.env` and `eas.json`:

```
EXPO_PUBLIC_API_BASE_URL=https://api.steerplan.com
```

No other mobile app changes needed — all route paths are identical.
