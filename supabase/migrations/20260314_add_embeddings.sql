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

-- IVFFlat index for similarity search (needs rows to build, so use default lists)
create index if not exists idx_embeddings_vector on public.embeddings
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

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
create policy "Service role full access" on public.embeddings
  for all using (true) with check (true);
