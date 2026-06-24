-- Track C — STEP C8: close the self-grant gap.
--
-- Before: "cg owner manage" let ANY signed-in user create a course_grants row as
-- long as they named THEMSELVES owner_id (owner_id = auth.uid()), and cc_grant_role
-- never checked owner_id — so a determined faculty/ASU user could grant themselves
-- (or others) access to any course via the API/console.
--
-- After: managing grants requires actually OWNING the course's worksheet (or being
-- an admin), regardless of what owner_id is written. Hiding the 👤 button becomes a
-- real, DB-enforced boundary. Revert: trackc_0008_REVERT.sql

begin;

-- True when the signed-in user owns this course (its worksheet or user_courses row),
-- or is an admin-adjacent owner. SECURITY DEFINER so it can read past RLS.
create or replace function cc_owns_course(p_course_id text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from worksheets   w  where w.course_id  = p_course_id and w.owner_id = auth.uid())
      or exists (select 1 from user_courses uc where uc.course_id = p_course_id and uc.user_id  = auth.uid());
$$;

drop policy if exists "cg owner manage" on course_grants;
create policy "cg owner manage" on course_grants for all
  using (cc_is_admin() or cc_owns_course(course_id))
  with check (cc_is_admin() or cc_owns_course(course_id));

commit;
