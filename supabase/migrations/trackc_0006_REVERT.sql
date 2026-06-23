-- Revert Track C C6 (identity grants). Restores cc_grant_role to the anon-only
-- lookup and drops the identity grant table. Safe: removes only C6 objects.

begin;

create or replace function cc_grant_role(p_course_id text) returns text
  language sql stable security definer set search_path = public as $$
  select role from coursecompose_share_grants where anon_uid = auth.uid() and course_id = p_course_id limit 1;
$$;

drop trigger if exists trg_course_grants_norm_email on course_grants;
drop function if exists cc_grants_normalize_email();
drop table if exists course_grants;

commit;
