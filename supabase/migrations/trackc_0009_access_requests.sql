-- Track C — STEP C9: access requests. A signed-in person who hits the worksheet
-- "you don't have access" page can request access; the request surfaces on the
-- course owner's dashboard, where they approve (→ creates a grant) or dismiss.
-- Additive & safe. Revert: trackc_0009_REVERT.sql

begin;

create table if not exists access_requests (
  id         uuid primary key default gen_random_uuid(),
  course_id  text not null,
  email      text not null,
  name       text,
  status     text not null default 'pending' check (status in ('pending','approved','denied')),
  created_at timestamptz not null default now(),
  unique (course_id, email)
);

-- Normalize email (case-insensitive match with grants/JWT).
create or replace function ar_normalize_email() returns trigger language plpgsql as $$
begin new.email := lower(btrim(new.email)); return new; end; $$;
drop trigger if exists trg_access_requests_norm on access_requests;
create trigger trg_access_requests_norm before insert or update on access_requests
  for each row execute function ar_normalize_email();

alter table access_requests enable row level security;

-- The requester manages their OWN request (insert/see/re-request), matched by their
-- verified JWT email. They can't create grants, so this can't escalate access.
drop policy if exists "ar requester" on access_requests;
create policy "ar requester" on access_requests for all
  using (email = lower(btrim(coalesce(auth.jwt()->>'email',''))))
  with check (email = lower(btrim(coalesce(auth.jwt()->>'email',''))));

-- The course owner (or admin) sees + resolves requests for courses they own.
drop policy if exists "ar owner" on access_requests;
create policy "ar owner" on access_requests for all
  using (cc_is_admin() or cc_owns_course(course_id))
  with check (cc_is_admin() or cc_owns_course(course_id));

commit;
