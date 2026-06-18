-- Track C — STEP C3: BREAKING CUTOVER. ⛔ DO NOT RUN until tested.
-- Replaces the abandoned trackb_0002. Enables true per-user isolation while the
-- anonymous faculty/reviewer flow keeps working via share GRANTS.
--
-- PREREQUISITES before running (in a quiet window):
--   1. trackc_0001 (share_tokens) + trackc_0002 (share_grants) applied — done.
--   2. redeem-share-token edge function deployed; COMPOSE_SHARE_TOKENS_ENABLED=true.
--   3. Anonymous sign-ins enabled in Supabase Auth.
--   4. TESTED: open a worksheet as instructor and as reviewer (via ?t= links) and
--      confirm every read/write they perform is permitted by the policies below.
--      The exact table read/write matrix for the worksheet MUST be verified live
--      (watch network calls) and these policies adjusted before cutover — esp.
--      whether instructors write worksheet content to `worksheets` vs
--      `user_courses`, and the session-tracking tables.
--   5. Audit: no table grants blanket access to any 'authenticated'/'anon' role.
--   6. Backfill owner columns first (below), in the same transaction as the swap.
--
-- Owner UID: epenmar@asu.edu = 30bb2d7b-000b-440f-87dc-c8d7af826d39

begin;

-- Helpers (namespaced; security definer so RLS subqueries can read the lookup tables)
create or replace function cc_is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('system_admin','super_admin') from user_profiles where id = auth.uid()), false);
$$;
create or replace function cc_grant_role(p_course_id text) returns text
  language sql stable security definer set search_path = public as $$
  select role from coursecompose_share_grants where anon_uid = auth.uid() and course_id = p_course_id limit 1;
$$;

-- Backfill existing rows to the owner.
update dashboard_state set user_id  = '30bb2d7b-000b-440f-87dc-c8d7af826d39' where user_id  is null;
update user_courses   set user_id  = '30bb2d7b-000b-440f-87dc-c8d7af826d39' where user_id  is null;
update worksheets     set owner_id = '30bb2d7b-000b-440f-87dc-c8d7af826d39' where owner_id is null;
update comments       set owner_id = '30bb2d7b-000b-440f-87dc-c8d7af826d39' where owner_id is null;

-- dashboard_state PK -> (user_id, key)
alter table dashboard_state drop constraint if exists dashboard_state_pkey;
alter table dashboard_state add primary key (user_id, key);

-- worksheets: owner/admin full; instructor-grant read+write; reviewer-grant read.
drop policy if exists "open access" on worksheets;
create policy "ws read"   on worksheets for select using (owner_id = auth.uid() or cc_is_admin() or cc_grant_role(course_id) is not null);
create policy "ws insert" on worksheets for insert with check (owner_id = auth.uid() or cc_is_admin() or cc_grant_role(course_id) = 'instructor');
create policy "ws update" on worksheets for update using (owner_id = auth.uid() or cc_is_admin() or cc_grant_role(course_id) = 'instructor')
                                          with check (owner_id = auth.uid() or cc_is_admin() or cc_grant_role(course_id) = 'instructor');
create policy "ws delete" on worksheets for delete using (owner_id = auth.uid() or cc_is_admin());

-- user_courses: owner/admin full; any grant may READ (the instructor's fresh-browser load).
drop policy if exists "open access" on user_courses;
create policy "uc owner"      on user_courses for all    using (user_id = auth.uid() or cc_is_admin()) with check (user_id = auth.uid() or cc_is_admin());
create policy "uc grant read" on user_courses for select using (cc_grant_role(course_id) is not null);

-- comments: owner/admin full; any grant may read + post; edits/resolves owner/admin (refine in testing).
drop policy if exists "open access" on comments;
create policy "cm owner"        on comments for all    using (owner_id = auth.uid() or cc_is_admin()) with check (owner_id = auth.uid() or cc_is_admin());
create policy "cm grant read"   on comments for select using (cc_grant_role(course_id) is not null);
create policy "cm grant insert" on comments for insert with check (cc_grant_role(course_id) is not null);

-- worksheet activity tracking: owner-of-course/admin/grant. (No owner_id column —
-- ownership inferred from the course's worksheet row.)
drop policy if exists "open access" on worksheet_sessions;
create policy "wsess access" on worksheet_sessions for all
  using (cc_is_admin() or cc_grant_role(course_id) is not null
         or exists (select 1 from worksheets w where w.course_id = worksheet_sessions.course_id and w.owner_id = auth.uid()))
  with check (cc_is_admin() or cc_grant_role(course_id) is not null
         or exists (select 1 from worksheets w where w.course_id = worksheet_sessions.course_id and w.owner_id = auth.uid()));
drop policy if exists "open access" on worksheet_session_events;
create policy "wsev access" on worksheet_session_events for all
  using (cc_is_admin() or cc_grant_role(course_id) is not null
         or exists (select 1 from worksheets w where w.course_id = worksheet_session_events.course_id and w.owner_id = auth.uid()))
  with check (cc_is_admin() or cc_grant_role(course_id) is not null
         or exists (select 1 from worksheets w where w.course_id = worksheet_session_events.course_id and w.owner_id = auth.uid()));

-- dashboard_state: private keys owner/admin only; course_overrides readable to a
-- grantee of one of this owner's courses (owner_id travels via the grant).
drop policy if exists "open access" on dashboard_state;
create policy "ds owner"          on dashboard_state for all    using (user_id = auth.uid() or cc_is_admin()) with check (user_id = auth.uid() or cc_is_admin());
create policy "ds overrides read" on dashboard_state for select using (
  key = 'course_overrides' and user_id in (select owner_id from coursecompose_share_grants where anon_uid = auth.uid())
);

commit;
