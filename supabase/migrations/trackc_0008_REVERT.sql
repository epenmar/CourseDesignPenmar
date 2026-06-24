-- Revert Track C C8: restore the looser owner_id-based grant management policy.
begin;
drop policy if exists "cg owner manage" on course_grants;
create policy "cg owner manage" on course_grants for all
  using (owner_id = auth.uid() or cc_is_admin())
  with check (owner_id = auth.uid() or cc_is_admin());
drop function if exists cc_owns_course(text);
commit;
