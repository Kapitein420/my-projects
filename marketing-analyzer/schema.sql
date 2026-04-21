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

-- Single-user MVP: disable RLS like the other apps.
alter table buildings disable row level security;
alter table scores    disable row level security;

-- Optional: index by building for faster latest-score lookups in JS.
create index if not exists idx_scores_building on scores ((data->>'buildingId'));
