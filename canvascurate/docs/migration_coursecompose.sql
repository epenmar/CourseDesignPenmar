-- ============================================================
--   CourseCompose ↔ CanvasCurate handoff bridge
-- ============================================================
-- Run this AFTER docs/migration.sql. It's an additive migration that
-- creates a single new table for receiving handoff bundles from
-- CourseCompose. Lives in a separate file (not appended to the main
-- migration) so future upstream Curate migrations from marsenea's
-- repo don't conflict.
--
-- Apply in Supabase SQL editor:
--   1. Paste contents
--   2. Click Run
--   3. Verify 1 new table + 3 indexes + 4 policies
--
-- All statements are idempotent (if not exists / drop if exists).

create extension if not exists pgcrypto;

create table if not exists coursecompose_handoffs (
  id              uuid primary key default gen_random_uuid(),
  received_at     timestamptz not null default now(),
  received_by     uuid references auth.users(id) on delete set null,
  -- Raw handoff envelope from CourseCompose:
  --   { handoff: { version, bundledAt, bundledBy, bundledByRole, ... },
  --     spec:    { format: 'coursecompose/v1.0', course, modules, ... } }
  bundle          jsonb not null,
  -- Convenience columns derived from the bundle so the UI can filter
  -- and sort without re-parsing JSONB on every query.
  bundle_format   text generated always as (bundle->'spec'->>'format') stored,
  course_code     text generated always as (bundle->'spec'->'course'->>'code') stored,
  course_title    text generated always as (bundle->'spec'->'course'->>'fullTitle') stored,
  generated_by    text generated always as (bundle->'handoff'->>'bundledBy') stored,
  generated_role  text generated always as (bundle->'handoff'->>'bundledByRole') stored,
  -- Build state. Curate flips this as it ingests / processes.
  -- 'superseded' is set automatically by the handoff endpoint when a
  -- newer push arrives for the same course_code while an earlier
  -- handoff is still pending — guarantees at most one pending row
  -- per course at any time, so the inbox never shows duplicates.
  status          text not null default 'pending'
                    check (status in ('pending', 'processing', 'built', 'error', 'archived', 'superseded')),
  processed_at    timestamptz,
  processed_by    uuid references auth.users(id) on delete set null,
  notes           text,
  -- Free-form attribution from the X-CourseCompose-Source request
  -- header so we can tell prod traffic from dev / staging at a glance.
  source          text
);

create index if not exists idx_cc_handoffs_status      on coursecompose_handoffs(status);
create index if not exists idx_cc_handoffs_course      on coursecompose_handoffs(course_code);
create index if not exists idx_cc_handoffs_received_at on coursecompose_handoffs(received_at desc);

alter table coursecompose_handoffs enable row level security;

-- Read: any authenticated Curate user can list incoming handoffs.
-- Multi-tenancy can tighten this later; for now ASU-only single-tenant.
drop policy if exists "authenticated_can_read_cc_handoffs" on coursecompose_handoffs;
create policy "authenticated_can_read_cc_handoffs"
  on coursecompose_handoffs for select
  to authenticated
  using (true);

-- Update: authenticated users can flip status / add notes once they
-- start working through a handoff.
drop policy if exists "authenticated_can_update_cc_handoffs" on coursecompose_handoffs;
create policy "authenticated_can_update_cc_handoffs"
  on coursecompose_handoffs for update
  to authenticated
  using (true)
  with check (true);

-- Insert: the FastAPI handoff endpoint always writes through the
-- service role (which bypasses RLS), so we don't need an anon-insert
-- policy at all. Keep RLS strict on insert so a leaked anon key can't
-- spam this table directly from a browser.
--
-- (Intentionally NO `for insert to anon` policy.)


-- ============================================================
--   FOLLOW-UP: add 'superseded' to the status check constraint
-- ============================================================
-- If you applied the migration BEFORE 'superseded' was added to the
-- enum (early May 2026 onward), this block re-bases the check so the
-- handoff endpoint can mark older pending rows as superseded when a
-- new push arrives for the same course. Idempotent — safe to re-run.
--
-- The drop-then-add pattern is necessary because Postgres doesn't
-- support ALTER CHECK CONSTRAINT in-place. The DROP IF EXISTS guard
-- means re-running on a fresh DB (where this constraint was already
-- baked in with the right list) is a no-op.

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'coursecompose_handoffs'::regclass
       and conname like '%status%check%'
  ) then
    alter table coursecompose_handoffs
      drop constraint if exists coursecompose_handoffs_status_check;
  end if;
end $$;

alter table coursecompose_handoffs
  add constraint coursecompose_handoffs_status_check
  check (status in ('pending', 'processing', 'built', 'error', 'archived', 'superseded'));
