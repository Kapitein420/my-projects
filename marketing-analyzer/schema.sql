-- ────────────────────────────────────────────────────────────────
-- my-projects — Supabase schema for the ENTIRE shared project
--
-- Despite living under marketing-analyzer/, this file governs every
-- table the publishable key ships next to: buildings + scores
-- (marketing-analyzer) AND characters + sessions + maps +
-- monster_templates (dnd-tracker). They share one Supabase project,
-- so RLS must be on for ALL of them — otherwise a leaked publishable
-- key reaches whichever tables are still open.
--
-- Paste into Supabase → SQL Editor → Run. Safe to re-run (idempotent).
-- ────────────────────────────────────────────────────────────────


-- ════════════════════════════════════════════════════════════════
-- 1. Tables
-- ════════════════════════════════════════════════════════════════

-- ── marketing-analyzer ─────────────────────────────────────────
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

-- ── dnd-tracker ────────────────────────────────────────────────
create table if not exists characters (
  id text primary key,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists maps (
  id text primary key,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists monster_templates (
  id text primary key,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- ════════════════════════════════════════════════════════════════
-- 2. Row Level Security
-- ════════════════════════════════════════════════════════════════
-- The publishable key ships to the browser, so RLS is the ONLY
-- thing that stops a random visitor from wiping these tables.
--
-- Two write patterns coexist in this project:
--
--   (a) marketing-analyzer (buildings, scores) — writes come from
--       analyze.mjs running locally with SUPABASE_SERVICE_ROLE_KEY,
--       which bypasses RLS. Browser is read-only. So: public SELECT,
--       no INSERT/UPDATE/DELETE policy for anon (denied by default).
--
--   (b) dnd-tracker (characters, sessions, maps, monster_templates)
--       — the DM writes from the browser, and the player view
--       (?player=MAP_ID on a TV) reads anonymously. So: public
--       SELECT for the player TV, INSERT/UPDATE/DELETE require
--       auth.uid() IS NOT NULL (any signed-in Supabase Auth user).
--
--       Control who can sign in via Supabase Dashboard → Auth →
--       Users (add the DM's email, optionally disable sign-ups in
--       Auth → Providers → Email).
-- ────────────────────────────────────────────────────────────────

alter table buildings         enable row level security;
alter table scores            enable row level security;
alter table characters        enable row level security;
alter table sessions          enable row level security;
alter table maps              enable row level security;
alter table monster_templates enable row level security;

-- Drop any old policies from an earlier run (idempotent).
drop policy if exists "public read buildings"         on buildings;
drop policy if exists "public read scores"            on scores;
drop policy if exists "public read characters"        on characters;
drop policy if exists "public read sessions"          on sessions;
drop policy if exists "public read maps"              on maps;
drop policy if exists "public read monster_templates" on monster_templates;
drop policy if exists "authed write characters"        on characters;
drop policy if exists "authed write sessions"          on sessions;
drop policy if exists "authed write maps"              on maps;
drop policy if exists "authed write monster_templates" on monster_templates;

-- ── Read policies — anyone with the publishable key, no auth ──
create policy "public read buildings"         on buildings         for select using (true);
create policy "public read scores"            on scores            for select using (true);
create policy "public read characters"        on characters        for select using (true);
create policy "public read sessions"          on sessions          for select using (true);
create policy "public read maps"              on maps              for select using (true);
create policy "public read monster_templates" on monster_templates for select using (true);

-- ── Write policies — signed-in Supabase Auth users only ──────
-- buildings + scores have NO write policy → writes denied for anon
-- (service_role bypasses RLS and is used by analyze.mjs).
--
-- The four dnd-tracker tables get one "for all" policy each,
-- covering INSERT + UPDATE + DELETE. Both USING (visibility for
-- update/delete) and WITH CHECK (validation for insert/update)
-- gate on auth.uid() — anon requests have auth.uid() = NULL and
-- fail both clauses.
create policy "authed write characters"        on characters
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authed write sessions"          on sessions
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authed write maps"              on maps
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authed write monster_templates" on monster_templates
  for all using (auth.uid() is not null) with check (auth.uid() is not null);


-- ════════════════════════════════════════════════════════════════
-- 3. Indexes
-- ════════════════════════════════════════════════════════════════
create index if not exists idx_scores_building on scores ((data->>'buildingId'));


-- ════════════════════════════════════════════════════════════════
-- 4. Realtime publication
-- ════════════════════════════════════════════════════════════════
-- The dnd-tracker player view + DM co-sync rely on the
-- supabase_realtime publication including these tables. The Dashboard
-- (Database → Replication) is the canonical place to manage this;
-- this block is a belt-and-braces add for fresh projects.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array['characters', 'sessions', 'maps'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
-- monster_templates does not need realtime (no live sync).
