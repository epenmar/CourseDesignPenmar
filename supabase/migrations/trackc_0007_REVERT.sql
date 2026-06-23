-- Revert Track C C7: re-open worksheet reads to anon and restore the anon-only
-- course_overrides read. Use as the instant rollback if closing the read gap
-- blanks out any legitimate worksheet.

begin;

drop policy if exists "ws anon read unblock" on worksheets;
create policy "ws anon read unblock" on worksheets for select using (true);

drop policy if exists "ds overrides read" on dashboard_state;
create policy "ds overrides read" on dashboard_state for select using (
  key = 'course_overrides' and user_id in (
    select owner_id from coursecompose_share_grants where anon_uid = auth.uid()
  )
);

commit;
