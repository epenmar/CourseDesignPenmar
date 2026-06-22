-- Build-time tracking: design vs build phase on the worksheet time ledger.
-- Applied to Supabase project gflnymqjraxonbdtbxma on 2026-06-22.
--
-- Context: CourseCompose logs "design" time (faculty worksheet) and Curate now
-- logs "build" time (course editor) into the SAME worksheet_session_events
-- table. A `phase` column distinguishes them; the nightly sync-jira-time.mjs
-- routes design->"Designing" child and build->"Building" child of the course
-- Epic. The dashboard reports both via the course_phase_totals view.

-- 1. Phase column on the shared event ledger (defaults to 'design' so every
--    pre-existing Compose row and the existing pipeline are unaffected).
alter table public.worksheet_session_events
  add column if not exists phase text not null default 'design';

create index if not exists idx_wse_unsynced_course_phase
  on public.worksheet_session_events (course_id, phase)
  where synced_to_jira = false;

-- 2. Per-course design/build totals for the ID dashboard. A plain (non
--    security_invoker) view owned by postgres bypasses the per-course RLS on
--    worksheet_session_events, so the dashboard's publishable key can read
--    aggregate minutes across every course without row-level grants. Only
--    identity_role='id' (the designer's own effort) is counted — the same
--    scope the Jira sync posts.
create or replace view public.course_phase_totals as
select
  course_id,
  phase,
  (sum(extract(epoch from (ended_at - started_at))) * 1000)::bigint as total_ms,
  count(*)::bigint as event_count,
  max(ended_at) as last_event_at
from public.worksheet_session_events
where identity_role = 'id'
  and ended_at > started_at
group by course_id, phase;

grant select on public.course_phase_totals to anon, authenticated;
