-- ============================================================================
-- ⛔ DO NOT RUN — SUPERSEDED by supabase/migrations/trackc_0003_isolation.sql
-- (grant-based, compatible with the project's ES256 asymmetric JWTs). 2026-06-18.
-- This naive owner-only RLS BREAKS the anonymous faculty/reviewer worksheet flow:
-- course-worksheet-v2.html reads, WITHOUT a login, by course_id/key:
--   * user_courses   (line ~3851 — the instructor's incognito course load)
--   * dashboard_state key='course_overrides' (line ~3879)
-- Locking these to user_id = auth.uid() would make those reads return nothing for
-- unauthenticated faculty/reviewers, so they couldn't open their course.
--
-- Correct approach (to be designed): split READ vs WRITE — keep the specific
-- shared reads (a course's user_courses row; the course_overrides key) readable,
-- but make WRITES owner-only; and/or move the worksheet's cross-user reads behind
-- a signed share-token edge function (Track C). Also note course_overrides becomes
-- per-user (PK user_id,key), so the worksheet's `.eq('key','course_overrides')
-- .maybeSingle()` must learn to fetch the OWNER's row, not "the" row.
-- Until that's built, isolation stays OFF and RLS remains open. The rest of Track B
-- (login + identity + Canvas Plan gating) is live and safe without this.
-- ============================================================================

-- Track B — STEP 2 of 2: BREAKING. DO NOT RUN WHILE ACTIVELY WORKING.
--
-- Shared Compose+Curate DB. This backfills ownership onto existing Compose rows
-- and swaps the wide-open RLS on the ID-PRIVATE tables (dashboard_state,
-- user_courses) for per-user policies. Admin override reuses Curate's role enum.
--
-- Run only after: trackb_0001 has run; Google login is configured + tested;
-- COMPOSE_AUTH_ENABLED is true and login works; and you are NOT mid-session.
-- BACKFILL FIRST, then tighten RLS, in one transaction.
--
-- Owner UID is known: epenmar@asu.edu = 30bb2d7b-000b-440f-87dc-c8d7af826d39
-- (confirm with: select id, email, role from user_profiles where email='epenmar@asu.edu';)

begin;

-- 1. Backfill existing rows to the owner.
update dashboard_state set user_id  = '30bb2d7b-000b-440f-87dc-c8d7af826d39' where user_id  is null;
update user_courses   set user_id  = '30bb2d7b-000b-440f-87dc-c8d7af826d39' where user_id  is null;
update worksheets     set owner_id = '30bb2d7b-000b-440f-87dc-c8d7af826d39' where owner_id is null;
update comments       set owner_id = '30bb2d7b-000b-440f-87dc-c8d7af826d39' where owner_id is null;

-- 2. dashboard_state PK becomes (user_id, key) so two IDs can hold the same key.
alter table dashboard_state drop constraint if exists dashboard_state_pkey;
alter table dashboard_state add primary key (user_id, key);

-- 3. ID-PRIVATE tables -> own-or-admin. Admin = a Curate system/super admin.
--    (Your role is currently 'id', so you reach your data as OWNER; elevate your
--    role to super_admin later if you want cross-user troubleshooting — Track D.)
drop policy if exists "open access" on dashboard_state;
create policy "own or admin" on dashboard_state for all
  using (user_id = auth.uid()
         or exists (select 1 from user_profiles up where up.id = auth.uid() and up.role in ('system_admin','super_admin')))
  with check (user_id = auth.uid()
         or exists (select 1 from user_profiles up where up.id = auth.uid() and up.role in ('system_admin','super_admin')));

drop policy if exists "open access" on user_courses;
create policy "own or admin" on user_courses for all
  using (user_id = auth.uid()
         or exists (select 1 from user_profiles up where up.id = auth.uid() and up.role in ('system_admin','super_admin')))
  with check (user_id = auth.uid()
         or exists (select 1 from user_profiles up where up.id = auth.uid() and up.role in ('system_admin','super_admin')));

-- 4. SHARED tables (worksheets, comments, worksheet_sessions[_events]) are
--    INTENTIONALLY left permissive: unauthenticated faculty/reviewers open the
--    worksheet via ?user= links and must keep read/write access. They carry
--    owner_id now (for "my courses" filtering); hardening their writes with
--    signed share-tokens is Track C. Do NOT lock these down here.
--
--    Track C prerequisite: worksheets are still keyed by course_id alone, so two
--    IDs developing the same code (e.g. TPH550) would collide. Move worksheets to
--    a surrogate id with unique(owner_id, course_id) and update the ?course=/?user=
--    link format before a second ID builds the same course.

commit;
