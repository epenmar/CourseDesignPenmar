-- Track C — C3 prerequisite: ownership-stamping triggers. APPLIED LIVE 2026-06-18.
-- ADDITIVE/SAFE: each trigger fills the owner column from the authenticated
-- session (auth.uid()) only when it's null, so app save code needs no changes to
-- populate ownership. On updates of existing rows the owner is preserved (so an
-- instructor saving a course via a grant does NOT overwrite the real owner_id).
-- Service-role / unauthenticated writes leave it null (auth.uid() is null) — fine.

create or replace function cc_stamp_user_id() returns trigger language plpgsql as $$
begin if new.user_id is null then new.user_id := auth.uid(); end if; return new; end $$;
create or replace function cc_stamp_owner_id() returns trigger language plpgsql as $$
begin if new.owner_id is null then new.owner_id := auth.uid(); end if; return new; end $$;

drop trigger if exists ds_stamp on dashboard_state;
create trigger ds_stamp before insert or update on dashboard_state for each row execute function cc_stamp_user_id();
drop trigger if exists uc_stamp on user_courses;
create trigger uc_stamp before insert or update on user_courses for each row execute function cc_stamp_user_id();
drop trigger if exists ws_stamp on worksheets;
create trigger ws_stamp before insert or update on worksheets for each row execute function cc_stamp_owner_id();
drop trigger if exists cm_stamp on comments;
create trigger cm_stamp before insert or update on comments for each row execute function cc_stamp_owner_id();
