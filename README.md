# Steerplan API

Standalone Fastify API server for Steerplan — migrated from Next.js API routes.

## Stack

- **Runtime:** Node.js 20 + Fastify 5
- **Auth:** Clerk JWT verification (`@clerk/backend`)
- **Database:** Supabase (service role, RPC encryption)
- **AI:** Anthropic Claude (Sonnet for chat, Haiku for categorisation/briefing)
- **RAG:** OpenAI embeddings (`text-embedding-3-small`) + Supabase pgvector
- **Bank Sync:** Yapily (Open Banking) + Plaid
- **Rate Limiting:** Upstash Redis (sliding window)
- **Queues:** BullMQ (email, sync, score, embedding workers)
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
│   ├── openai.ts             # OpenAI client (embeddings, TTS, Whisper)
│   ├── embeddings.ts         # Vector embedding CRUD + similarity search
│   ├── rag.ts                # RAG context retrieval for chat
│   ├── knowledge-base.ts     # UK financial knowledge base loader
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
├── queues/
│   ├── index.ts              # Redis connection
│   ├── jobs.ts               # Queue definitions + typed helpers
│   └── workers/              # email, sync, score, embedding workers
├── data/
│   └── knowledge/            # UK financial reference markdown files
└── scripts/
    └── seed-knowledge-base.ts          # Index knowledge base into embeddings
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

## RAG (Retrieval-Augmented Generation)

The chat pipeline uses vector search to give Claude access to the user's full financial history — not just the last 20 transactions sent by the mobile app.

### How It Works

1. **Indexing** — When financial data is written (bank sync, CSV upload, income/outgoing/budget save), a BullMQ job embeds the data using OpenAI `text-embedding-3-small` and stores the 1536-dim vectors in Supabase pgvector.
2. **Retrieval** — Before each chat message is sent to Claude, the user's message is embedded and the top 25 most similar personal records + top 5 knowledge base matches are retrieved.
3. **Injection** — Retrieved context is injected into the system instruction under `{{RAG_CONTEXT}}`, supplementing the existing `{{DASHBOARD_STATE}}`.
4. **Tool** — Claude also has a `search_financial_data` tool it can call mid-conversation for follow-up vector searches.

### Content Types

| Type | Source | Indexed When |
|------|--------|-------------|
| `transaction` | Bank transactions | Yapily/Plaid sync, CSV upload, manual upsert |
| `income` | Income sources | POST `/api/data/income-sources` |
| `outgoing` | Outgoing categories | POST `/api/data/outgoings` |
| `budget` | Spending budgets | POST `/api/data/budgets` |
| `knowledge_base` | Static markdown files | Seed script (global, not per-user) |

### Knowledge Base

Static UK financial reference content in `src/data/knowledge/`:

- `uk-tax-bands.md` — Income tax bands, NI rates, self-assessment deadlines
- `isa-rules.md` — ISA types, annual allowance, LISA bonus rules
- `pension-rules.md` — Annual allowance, tax relief, state pension, auto-enrolment
- `emergency-fund.md` — Targets by situation, where to keep it, building strategies
- `debt-strategy.md` — Avalanche vs snowball, warning signs, free help resources

To add new knowledge, create a `.md` file in `src/data/knowledge/` and re-run the seed:

```bash
SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx OPENAI_API_KEY=xxx npx tsx src/scripts/seed-knowledge-base.ts
```

### Database

The `embeddings` table is created via `supabase/migrations/20260314_add_embeddings.sql`:

- `match_embeddings` RPC function for cosine similarity search
- IVFFlat index for fast vector lookups
- Unique constraint on `(user_id, source_id)` for upserts
- RLS enabled with service role full access

### Embedding Worker

BullMQ worker (`src/queues/workers/embedding.worker.ts`) with job types:

| Job | Description |
|-----|-------------|
| `index-transactions` | Embed all user transactions |
| `index-income` | Embed user income sources |
| `index-outgoings` | Embed user outgoing categories |
| `index-budgets` | Embed user budgets |
| `index-all` | Run all of the above in parallel |
| `delete-user` | GDPR cleanup — delete all user embeddings |

Jobs are deduplicated by `jobId` (`{jobName}:{userId}`) with a 2s delay to batch rapid writes.

---

## Mobile App Cutover

Update `EXPO_PUBLIC_API_BASE_URL` in the mobile app's `.env` and `eas.json`:

```
EXPO_PUBLIC_API_BASE_URL=https://api.steerplan.com
```

No other mobile app changes needed — all route paths are identical.
