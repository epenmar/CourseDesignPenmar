-- Track C — C3 REVERT. Restores wide-open RLS if the isolation cutover breaks
-- the live worksheet. Run this to roll back trackc_0003 instantly.

drop policy if exists "ws read" on worksheets;
drop policy if exists "ws insert" on worksheets;
drop policy if exists "ws update" on worksheets;
drop policy if exists "ws delete" on worksheets;
create policy "open access" on worksheets for all using (true) with check (true);

drop policy if exists "uc owner" on user_courses;
drop policy if exists "uc grant read" on user_courses;
create policy "open access" on user_courses for all using (true) with check (true);

drop policy if exists "cm owner" on comments;
drop policy if exists "cm grant read" on comments;
drop policy if exists "cm grant insert" on comments;
drop policy if exists "cm grant update" on comments;
create policy "open access" on comments for all using (true) with check (true);

drop policy if exists "wsess access" on worksheet_sessions;
create policy "open access" on worksheet_sessions for all using (true) with check (true);

drop policy if exists "wsev access" on worksheet_session_events;
create policy "open access" on worksheet_session_events for all using (true) with check (true);

drop policy if exists "ds owner" on dashboard_state;
drop policy if exists "ds overrides read" on dashboard_state;
create policy "open access" on dashboard_state for all using (true) with check (true);

-- NOTE: this does NOT revert the dashboard_state PK change (user_id,key) or the
-- backfill — those are harmless to keep. Only the policies are restored to open.
