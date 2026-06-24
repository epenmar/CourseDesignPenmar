-- Grant-holders (faculty/reviewers) could UPDATE *any* comment on a course they
-- have a grant for — not just their own. The `cm grant update` policy was
-- `cc_grant_role(course_id) IS NOT NULL` with no owner_id check, so a faculty
-- member could silently edit or resolve the ID's comments (or each other's).
-- The worksheet UI only shows Edit/Resolve on a user's own comments, so this was
-- never intended; it's a comment-integrity hole.
--
-- Tighten it to own-only. Editing/resolving your OWN comment stays allowed (this
-- policy AND `cm owner` both cover owner_id = auth.uid()). Moderating others'
-- comments remains available to the course owner (`cm course manage`) and admins
-- (`cm owner` via cc_is_admin()). No UI flow loses a capability.

drop policy if exists "cm grant update" on public.comments;
create policy "cm grant update" on public.comments
  for update
  using ( cc_grant_role(course_id) IS NOT NULL AND owner_id = auth.uid() )
  with check ( cc_grant_role(course_id) IS NOT NULL AND owner_id = auth.uid() );
