-- Track B — STEP 1 of 2: ADDITIVE, NON-BREAKING.
-- Safe to run at any time, including while the single-user tool is live:
-- it only adds a new table, a function, and nullable columns. It does NOT
-- change any RLS policy or primary key, so the current anon-key read/write
-- flows keep working unchanged.
--
-- Project: gflnymqjraxonbdtbxma  (Compose / dashboard + worksheet)
-- Run in: Supabase SQL editor or `supabase db query --linked`.

-- 1. profiles: replaces the hardcoded defaultProfile. One row per auth user.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  asurite text,
  booking_url text,
  signature text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;
drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

-- 2. is_admin(): used by later RLS policies so the owner can read any ID's data
--    for troubleshooting (Track D admin hub foundation).
create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- 3. Ownership columns — nullable for now; backfilled in step 2.
alter table dashboard_state add column if not exists user_id uuid references auth.users(id);
alter table user_courses   add column if not exists user_id uuid references auth.users(id);
alter table worksheets     add column if not exists owner_id uuid references auth.users(id);
alter table comments       add column if not exists owner_id uuid references auth.users(id);

create index if not exists idx_dashboard_state_user on dashboard_state(user_id);
create index if not exists idx_user_courses_user on user_courses(user_id);
create index if not exists idx_worksheets_owner on worksheets(owner_id);
create index if not exists idx_comments_owner on comments(owner_id);
