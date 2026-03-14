/**
 * Runs the embeddings migration via Supabase SQL, then seeds the knowledge base.
 *
 * Usage: npx tsx src/scripts/run-migration-and-seed.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.
 */
import { createClient } from '@supabase/supabase-js';
import { indexKnowledgeBase } from '../lib/knowledge-base.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

const MIGRATION_SQL = `
-- Enable pgvector extension
create extension if not exists vector with schema extensions;

-- Embeddings table for RAG
create table if not exists public.embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  content_type text not null check (content_type in ('transaction', 'income', 'outgoing', 'budget', 'knowledge_base')),
  source_id text not null,
  content text not null,
  embedding vector(1536) not null,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes
create index if not exists idx_embeddings_user_id on public.embeddings (user_id);
create index if not exists idx_embeddings_user_type on public.embeddings (user_id, content_type);
create index if not exists idx_embeddings_source on public.embeddings (user_id, source_id);

-- Unique constraint to enable upsert by user + source
create unique index if not exists idx_embeddings_user_source on public.embeddings (user_id, source_id);

-- Match embeddings RPC function for similarity search
create or replace function public.match_embeddings(
  query_embedding vector(1536),
  match_user_id text,
  match_content_types text[] default null,
  match_limit int default 25,
  match_threshold float default 0.5
)
returns table (
  id uuid,
  user_id text,
  content_type text,
  source_id text,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    e.id,
    e.user_id,
    e.content_type,
    e.source_id,
    e.content,
    e.metadata,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.embeddings e
  where
    (e.user_id = match_user_id or e.user_id = '__global__')
    and (match_content_types is null or e.content_type = any(match_content_types))
    and 1 - (e.embedding <=> query_embedding) > match_threshold
  order by e.embedding <=> query_embedding
  limit match_limit;
end;
$$;

-- RLS policies
alter table public.embeddings enable row level security;

-- Service role has full access (API uses service role key)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'embeddings' AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access" ON public.embeddings FOR ALL USING (true) WITH CHECK (true);
  END IF;
END
$$;
`;

async function main() {
  // Step 1: Run migration
  console.log('Running embeddings migration...');

  // Split into individual statements and run them
  // We need to use the Supabase SQL editor / rpc approach
  const { error: migrationError } = await supabase.rpc('exec_sql', {
    sql: MIGRATION_SQL,
  }).throwOnError().then(() => ({ error: null })).catch((err) => ({ error: err }));

  if (migrationError) {
    // Fallback: try running via the REST SQL endpoint
    console.log('RPC exec_sql not available, trying direct SQL via fetch...');

    const response = await fetch(`${url}/rest/v1/rpc/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });

    // If neither works, the user needs to run the migration in the Supabase dashboard
    console.log('\n⚠️  Could not run migration via RPC.');
    console.log('Please run the migration SQL manually in the Supabase SQL Editor:');
    console.log('  Dashboard → SQL Editor → New query → Paste contents of:');
    console.log('  supabase/migrations/20260314_add_embeddings.sql\n');
    console.log('Once the migration is applied, re-run this script to seed the knowledge base.');
    console.log('Or run: SKIP_MIGRATION=1 npx tsx src/scripts/run-migration-and-seed.ts\n');

    if (!process.env.SKIP_MIGRATION) {
      process.exit(1);
    }
  } else {
    console.log('✓ Migration applied successfully');
  }

  // Step 2: Seed knowledge base
  console.log('\nSeeding knowledge base...');
  await indexKnowledgeBase();
  console.log('✓ Knowledge base seeded successfully');

  process.exit(0);
}

main().catch((err) => {
  console.error('Script failed:', err.message || err);
  process.exit(1);
});
