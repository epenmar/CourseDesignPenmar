-- Track C — STEP C2: ADDITIVE. Safe to run anytime (new table only).
--
-- Maps a redeemed anonymous Supabase session to the course it may access. The
-- redeem-share-token edge function (service role) inserts rows here; RLS on the
-- data tables (C3) authorizes an anon session by joining this grant. Replaces the
-- abandoned custom-JWT approach (project uses ES256 asymmetric signing).

create table if not exists coursecompose_share_grants (
  anon_uid   uuid not null,
  course_id  text not null,
  owner_id   uuid not null,
  role       text not null check (role in ('instructor','reviewer')),
  created_at timestamptz not null default now(),
  primary key (anon_uid, course_id)
);

alter table coursecompose_share_grants enable row level security;
-- A session may read its own grants (RLS subqueries on the data tables rely on
-- this). Writes happen only via the edge function's service-role client.
drop policy if exists "read own grants" on coursecompose_share_grants;
create policy "read own grants" on coursecompose_share_grants for select
  using (anon_uid = auth.uid());
