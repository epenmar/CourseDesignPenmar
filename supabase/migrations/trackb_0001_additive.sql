-- Track B — STEP 1 of 2: ADDITIVE, NON-BREAKING. Safe to run anytime, even live.
--
-- NOTE: Compose and Curate SHARE one Supabase project (gflnymqjraxonbdtbxma).
-- Identity is already unified via the existing `user_profiles` table (role enum:
-- id | system_admin | super_admin) and the handle_new_user trigger that creates
-- a row on first sign-in. So this migration does NOT create a profiles table or
-- an is_admin function — it only adds nullable ownership columns to the Compose
-- tables. Nothing here changes how the live tool (or Curate) behaves today.

alter table dashboard_state add column if not exists user_id  uuid references auth.users(id);
alter table user_courses   add column if not exists user_id  uuid references auth.users(id);
alter table worksheets     add column if not exists owner_id uuid references auth.users(id);
alter table comments       add column if not exists owner_id uuid references auth.users(id);

create index if not exists idx_dashboard_state_user on dashboard_state(user_id);
create index if not exists idx_user_courses_user    on user_courses(user_id);
create index if not exists idx_worksheets_owner     on worksheets(owner_id);
create index if not exists idx_comments_owner       on comments(owner_id);
