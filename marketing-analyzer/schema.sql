-- DILS Marketing Analyzer — Supabase schema
-- Paste into Supabase → SQL Editor → Run.
-- Uses the same jsonb pattern as the dnd-tracker tables.

create table if not exists buildings (
  id text primary key,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists scores (
  id text primary key,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────
-- Row Level Security
-- The anon key ships to the browser, so RLS is the ONLY thing
-- that stops a random visitor from wiping these tables.
-- Pattern: public SELECT, all writes go through the service_role
-- key which bypasses RLS (used by analyze.mjs / Vercel API routes
-- where SUPABASE_SERVICE_ROLE_KEY lives in env vars only).
-- ────────────────────────────────────────────────────────────────
alter table buildings enable row level security;
alter table scores    enable row level security;

-- Drop any old permissive policies from an earlier run (idempotent).
drop policy if exists "public read buildings" on buildings;
drop policy if exists "public read scores"    on scores;

-- Anon key can read, nothing else. INSERT/UPDATE/DELETE have no
-- policy => denied for anon. Service role bypasses all policies.
create policy "public read buildings" on buildings
  for select using (true);

create policy "public read scores" on scores
  for select using (true);

-- Optional: index by building for faster latest-score lookups in JS.
create index if not exists idx_scores_building on scores ((data->>'buildingId'));
