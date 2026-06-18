-- Track B — STEP 2 of 2: BREAKING. DO NOT RUN WHILE ACTIVELY WORKING.
--
-- This backfills ownership onto existing rows and then SWAPS the wide-open RLS
-- policies for per-user policies. After this runs, the dashboard's ID-private
-- tables (dashboard_state, user_courses) can ONLY be read/written by the owning
-- authenticated user (or an admin) — so it MUST be run only after:
--   1. trackb_0001_additive.sql has run,
--   2. Google OAuth is configured in Supabase and tested,
--   3. window.COMPOSE_AUTH_ENABLED has been flipped to true and login works,
--   4. you are NOT mid-session on the live tool (do it during a quiet window).
--
-- Ordering matters: BACKFILL FIRST, then tighten RLS, in one transaction, so
-- there is never a moment where your own data is locked out.
--
-- Replace <ELISA_UID> with the value from:  select id, email from auth.users;

begin;

-- 1. Backfill all existing rows to the owner (Elisa).
update dashboard_state set user_id  = '<ELISA_UID>' where user_id  is null;
update user_courses   set user_id  = '<ELISA_UID>' where user_id  is null;
update worksheets     set owner_id = '<ELISA_UID>' where owner_id is null;
update comments       set owner_id = '<ELISA_UID>' where owner_id is null;

-- 2. dashboard_state PK becomes (user_id, key) so two IDs can hold the same key.
alter table dashboard_state drop constraint if exists dashboard_state_pkey;
alter table dashboard_state add primary key (user_id, key);

-- 3. ID-PRIVATE tables → own-or-admin. These are never touched by anon
--    faculty/reviewers, so requiring auth is safe.
drop policy if exists "open access" on dashboard_state;
create policy "own or admin" on dashboard_state for all
  using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

drop policy if exists "open access" on user_courses;
create policy "own or admin" on user_courses for all
  using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

-- 4. SHARED tables (worksheets, comments, worksheet_sessions[_events]) are
--    INTENTIONALLY left permissive here. Unauthenticated faculty/reviewers open
--    the worksheet via ?user= links and must keep read/write access. They carry
--    owner_id now (for "my courses" filtering + admin scoping); hardening their
--    writes with signed share-tokens is Track C. DO NOT lock these down here or
--    the faculty/reviewer flow breaks.
--
--    NOTE (Track C prerequisite): worksheets are still keyed by course_id alone,
--    so two IDs developing the same code (e.g. TPH550) would collide. Before a
--    second ID builds the same course, migrate worksheets to a surrogate id with
--    unique(owner_id, course_id) and update the ?course=/?user= link format in
--    course-worksheet-v2.html.

commit;
