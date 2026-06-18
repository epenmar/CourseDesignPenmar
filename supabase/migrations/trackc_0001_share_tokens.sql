-- Track C — STEP C1: ADDITIVE. Safe to run anytime (new table only; no behavior
-- change, no RLS change to existing tables). Shared Compose+Curate DB — the
-- coursecompose_ prefix keeps it clearly Compose-owned.
--
-- Course share tokens: the opaque token lives only in the link the ID sends; we
-- store its SHA-256. The redeem-share-token edge function (service role) looks up
-- by hash and mints a course-scoped Supabase JWT. See docs/track-c-share-tokens.md.

create table if not exists coursecompose_share_tokens (
  id          uuid primary key default gen_random_uuid(),
  course_id   text not null,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('instructor','reviewer')),
  token_hash  text not null unique,
  label       text,
  revoked     boolean not null default false,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz,
  unique (course_id, owner_id, role)
);
create index if not exists idx_cc_share_tokens_course on coursecompose_share_tokens(course_id);

alter table coursecompose_share_tokens enable row level security;
-- Owners manage their own tokens from the dashboard (authenticated). The edge
-- function bypasses RLS via the service role for hash lookups during redemption.
drop policy if exists "owner manages tokens" on coursecompose_share_tokens;
create policy "owner manages tokens" on coursecompose_share_tokens for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
