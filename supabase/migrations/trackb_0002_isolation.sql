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
