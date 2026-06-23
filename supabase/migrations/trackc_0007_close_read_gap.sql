-- Track C — STEP C7: close the world-readable-worksheet gap + identity-aware
-- course_overrides. Run only with COMPOSE_IDENTITY_LOGIN_ENABLED=true (faculty
-- sign-in live), so unauthenticated visitors are gated before any read.
--
-- Safe because every legitimate worksheet read already establishes a grant first:
--   * signed-in faculty  -> identity grant (course_grants, by email) via cc_grant_role
--   * ?t= link faculty    -> anon-session grant recorded by applyWorksheetToken
--                            (awaited) before the cloud pull
--   * owner / admin / IDs -> owner_id = auth.uid() / cc_is_admin()
-- Revert: supabase/migrations/trackc_0007_REVERT.sql

begin;

-- Drop the blanket "anyone may read any worksheet" policy. SELECT is then governed
-- solely by the existing "ws read" policy (owner / admin / has-grant-for-course).
drop policy if exists "ws anon read unblock" on worksheets;

-- course_overrides (Drive folder / instructor overrides the worksheet reads): the
-- old policy only recognized ANON-session grants. Extend it to also recognize
-- IDENTITY grants (course_grants, matched by the signed-in email) so a clean-link
-- faculty member sees the same overrides a ?t= visitor does.
drop policy if exists "ds overrides read" on dashboard_state;
create policy "ds overrides read" on dashboard_state for select using (
  key = 'course_overrides' and (
    user_id in (select owner_id from coursecompose_share_grants where anon_uid = auth.uid())
    or user_id in (select owner_id from course_grants
                   where not revoked and email = lower(btrim(nullif(auth.jwt()->>'email',''))))
  )
);

commit;
