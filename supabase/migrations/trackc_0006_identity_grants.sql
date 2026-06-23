-- Track C — STEP C6: ADDITIVE & SAFE. Identity-based course grants.
--
-- The "single-URL Google login" model: instead of access being tied to an
-- anonymous browser session that redeemed a secret link (coursecompose_share_grants,
-- keyed by anon_uid), access can also be granted to a PERSON by their ASU email.
-- When that person signs in with Google, the gate recognizes them by email.
--
-- This file is a strict SUPERSET of today's behaviour:
--   * New table `course_grants` starts EMPTY → no one gains access on apply.
--   * `cc_grant_role()` gains a second branch that only ever returns a role for a
--     LOGGED-IN user whose verified JWT email matches a non-revoked grant. Anon
--     sessions (email = null) are unaffected, so the live secret-link flow is
--     byte-for-byte unchanged.
-- Reversible: supabase/migrations/trackc_0006_REVERT.sql
--
-- Owner UID: epenmar@asu.edu = 30bb2d7b-000b-440f-87dc-c8d7af826d39

begin;

-- A durable, identity-keyed grant: "<email> may act as <role> on <course>,
-- granted by <owner>." Unlike share_grants (ephemeral anon session rows written
-- by the redeem edge function), these are managed by the owner from the dashboard.
create table if not exists course_grants (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  course_id  text not null,
  owner_id   uuid not null,
  role       text not null check (role in ('instructor','reviewer')),
  granted_by uuid,
  created_at timestamptz not null default now(),
  revoked    boolean not null default false,
  unique (email, course_id, role)
);

-- Normalize email so matching is case-insensitive and trimmed.
create or replace function cc_grants_normalize_email() returns trigger
  language plpgsql as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end;
$$;
drop trigger if exists trg_course_grants_norm_email on course_grants;
create trigger trg_course_grants_norm_email before insert or update on course_grants
  for each row execute function cc_grants_normalize_email();

alter table course_grants enable row level security;

-- Owner/admin manage grants for their own courses (the dashboard runs as the
-- owner's JWT). Grantees may READ their own grant rows (so a signed-in faculty
-- member can list "my courses").
drop policy if exists "cg owner manage" on course_grants;
create policy "cg owner manage" on course_grants for all
  using (owner_id = auth.uid() or cc_is_admin())
  with check (owner_id = auth.uid() or cc_is_admin());
drop policy if exists "cg grantee read" on course_grants;
create policy "cg grantee read" on course_grants for select
  using (email = lower(btrim(coalesce(auth.jwt()->>'email',''))) and not revoked);

-- Extend the access-check to honour identity grants in addition to anon grants.
-- The first branch is the EXISTING query verbatim (anon link sessions); the
-- second adds logged-in-by-email grants. Strict superset.
create or replace function cc_grant_role(p_course_id text) returns text
  language sql stable security definer set search_path = public as $$
  select role from (
    select role
      from coursecompose_share_grants
     where anon_uid = auth.uid() and course_id = p_course_id
    union all
    select role
      from course_grants
     where course_id = p_course_id
       and not revoked
       and email = lower(btrim(nullif(auth.jwt()->>'email','')))
  ) g
  limit 1;
$$;

commit;
