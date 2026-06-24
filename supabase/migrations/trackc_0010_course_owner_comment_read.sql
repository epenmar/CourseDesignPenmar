-- Course owners couldn't see collaborators' comments.
--
-- The comments SELECT policies were:
--   cm owner      ALL    USING (owner_id = auth.uid() OR cc_is_admin())
--   cm grant read SELECT USING (cc_grant_role(course_id) IS NOT NULL)
--
-- "cm owner" keys on the COMMENT ROW's owner_id, so a course owner reading their
-- own worksheet only sees the comments THEY authored — a faculty member's replies
-- (owner_id = faculty uid) are RLS-hidden from the ID. (Real case: BST 605 — the
-- ID saw her 9 root comments but none of Habte's 13 replies, and reply-count
-- badges came back empty because the underlying rows weren't readable.)
--
-- Fix: a course owner (worksheets.owner_id / user_courses.user_id = auth.uid(),
-- via cc_owns_course) may READ every comment on a course they own, and UPDATE
-- them (so the ID can resolve / soft-delete faculty + reviewer comments). These
-- are additive; the existing row-owner + grant policies are untouched.

drop policy if exists "cm course read" on public.comments;
create policy "cm course read" on public.comments
  for select
  using ( public.cc_owns_course(course_id) );

drop policy if exists "cm course manage" on public.comments;
create policy "cm course manage" on public.comments
  for update
  using ( public.cc_owns_course(course_id) )
  with check ( public.cc_owns_course(course_id) );
