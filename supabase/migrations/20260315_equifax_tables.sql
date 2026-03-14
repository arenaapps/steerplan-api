-- Equifax integration tables

-- Maps user_id → equifax_customer_id (from OBI createAndEnrich response)
create table if not exists public.equifax_customers (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  equifax_customer_id text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists idx_equifax_customers_user on public.equifax_customers (user_id);
create index if not exists idx_equifax_customers_eq_id on public.equifax_customers (equifax_customer_id);

-- Denormalized scores for quick reads + trends
create table if not exists public.credit_scores (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  fhi_score smallint check (fhi_score between 1 and 9),
  fhi_flags jsonb default '[]',
  income_grade text check (income_grade in ('A', 'B', 'C', 'D', 'E', 'F')),
  disposable_income numeric,
  total_income numeric,
  total_expenditure numeric,
  bureau_score integer,
  source text not null check (source in ('obi', 'gateway')),
  scored_at timestamptz default now()
);

create index if not exists idx_credit_scores_user on public.credit_scores (user_id, scored_at desc);

-- Encrypted full response payloads for detailed views
create table if not exists public.credit_insights (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  insight_type text not null check (insight_type in ('fhi', 'income_verification', 'expenditure', 'credit_report')),
  payload_enc text not null,
  fetched_at timestamptz default now()
);

create index if not exists idx_credit_insights_user on public.credit_insights (user_id, fetched_at desc);
create index if not exists idx_credit_insights_user_type on public.credit_insights (user_id, insight_type);

-- RLS policies (service role has full access)
alter table public.equifax_customers enable row level security;
alter table public.credit_scores enable row level security;
alter table public.credit_insights enable row level security;

create policy "Service role full access" on public.equifax_customers
  for all using (true) with check (true);
create policy "Service role full access" on public.credit_scores
  for all using (true) with check (true);
create policy "Service role full access" on public.credit_insights
  for all using (true) with check (true);
