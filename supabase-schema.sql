-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/gflnymqjraxonbdtbxma/sql/new

-- Full worksheet data (activities, materials, modules, objectives, etc.)
-- Stored as a JSON blob per course — mirrors the localStorage `worksheet_<courseId>` bucket.
create table if not exists worksheets (
  course_id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Dashboard-level course state (inactive flag + note, starred, custom overrides)
create table if not exists dashboard_state (
  key text primary key,            -- e.g. 'inactive_courses', 'course_overrides', 'course_reviewers'
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Drop the earlier (wrong) comments table if it was created with placeholder columns.
-- Safe to run — we haven't written any comments to it yet.
drop table if exists comments cascade;

-- Comments posted on any field or section of a course worksheet.
-- Column names must match what the existing comments code uses.
create table comments (
  id uuid primary key default gen_random_uuid(),
  course_id text not null,
  section_id text,
  parent_id uuid references comments(id) on delete cascade,
  author_name text not null,
  author_role text not null,
  content text not null,
  highlight_text text,
  highlight_anchor jsonb,
  resolved boolean default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_comments_course on comments(course_id);
create index if not exists idx_comments_section on comments(section_id);
create index if not exists idx_comments_parent on comments(parent_id);

-- User-created courses (ones added from the dashboard, not hardcoded)
create table if not exists user_courses (
  course_id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Keep updated_at fresh automatically
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists worksheets_touch on worksheets;
create trigger worksheets_touch before update on worksheets
  for each row execute function touch_updated_at();

drop trigger if exists dashboard_state_touch on dashboard_state;
create trigger dashboard_state_touch before update on dashboard_state
  for each row execute function touch_updated_at();

drop trigger if exists user_courses_touch on user_courses;
create trigger user_courses_touch before update on user_courses
  for each row execute function touch_updated_at();

-- Row Level Security
-- For now: open read/write with the publishable (anon) key.
-- Once Supabase Auth is added (Phase 2), these policies will be scoped per user.
alter table worksheets enable row level security;
alter table dashboard_state enable row level security;
alter table comments enable row level security;
alter table user_courses enable row level security;

drop policy if exists "open access" on worksheets;
create policy "open access" on worksheets for all using (true) with check (true);

drop policy if exists "open access" on dashboard_state;
create policy "open access" on dashboard_state for all using (true) with check (true);

drop policy if exists "open access" on comments;
create policy "open access" on comments for all using (true) with check (true);

drop policy if exists "open access" on user_courses;
create policy "open access" on user_courses for all using (true) with check (true);
