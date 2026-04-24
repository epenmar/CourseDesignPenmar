# How worksheet time gets into Jira

Short explainer for an IT collaborator debugging Jira worklog accuracy.

## Pipeline in one sentence

While a faculty member has the course worksheet open in a browser tab,
the page records session-time events into a Supabase table. A nightly
(or on-demand) Node script reads those events, de-duplicates against
calendar meetings, and posts worklogs to the matching Jira Epic's
"Designing" sub-task.

## Components

1. **Browser (`course-worksheet-v2.html`, `~line 10526`)**
   Every open worksheet tab starts a timer. The timer:
   - Pauses on `visibilitychange` (tab hidden).
   - Now also **pauses when the user has been idle >3 min**
     (no mouse, keyboard, wheel, or touch events). This is recent —
     prior worklogs were posted without idle detection so they can
     over-count tab-visible-but-unused time.
   - Flushes every 30 seconds and on `beforeunload`.
   Each flush writes two rows:
   - `worksheet_sessions` — running `total_ms` per `(course_id, identity_name, identity_role)`, used for a dashboard display.
   - `worksheet_session_events` — one row per flush window with `started_at`, `ended_at`, `synced_to_jira`.

2. **Supabase (`public.worksheet_session_events`)**
   This is the authoritative ledger the sync reads from. Each row:
   ```
   id uuid
   course_id text            e.g. "tph501"
   identity_name text        e.g. "Elisa Penmar"
   identity_role text        "id" | "instructor" | "reviewer"
   started_at timestamptz
   ended_at timestamptz
   synced_to_jira bool       flipped to true after worklog post
   ```

3. **Identity fallback**
   Worklogs are only posted for events that have an identity. If the
   user hasn't set a comment identity and didn't arrive via a shared
   `?user=` link, events used to be dropped. Now the worksheet falls
   back to `localStorage.id_profile` (set on the dashboard) and treats
   the session as role `id`. If a course ever shows 0 minutes in Jira
   despite obvious work, check this table for `identity_name` values;
   any `null`/empty rows won't sync.

4. **Sync script (`scripts/sync-jira-time.mjs`)**
   Runs nightly via launchd (`~/Library/LaunchAgents/
   com.elisa.sync-jira-time.plist`) and on-demand when the dashboard's
   "⏱ Sync Jira time" button is clicked (the button hits
   `POST http://127.0.0.1:3456/jira/sync-time` which the local
   `sync-server.js` maps to the same script).

   For each course with unsynced events:
   - Pulls all rows with `synced_to_jira = false`.
   - Subtracts overlap with calendar-meeting intervals
     (from `sync-calendar.js`) so time spent in a meeting isn't
     double-counted once the meeting's own worklog posts.
   - Adds past-calendar-meeting duration for meetings we haven't
     marked synced yet (tracked in `dashboard_state.meeting_synced_uids`).
   - Looks up the Jira Epic from
     `dashboard_state.course_jira_epics` (user override) else the
     built-in `BUILT_IN_EPICS` map in the script.
   - Fetches the Epic's children and picks the one whose summary
     contains "designing" case-insensitively; falls back to the Epic
     itself if none.
   - Posts a worklog with `POST /rest/api/3/issue/{key}/worklog`:
     ```
     timeSpentSeconds: <rounded sum of event durations>
     started: <event.started_at>
     comment: "worksheet session (via sync-jira-time.mjs)"
     ```
   - Flips the processed rows to `synced_to_jira = true` in one
     update batch. Meeting UIDs are appended to
     `dashboard_state.meeting_synced_uids`.

5. **Jira credentials**
   Read from `/Users/epenmar/conductor/.env` at runtime:
   `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`. The base URL is the
   ASU Online Jira Cloud host. These never leave the local machine.

## Known over-counting sources

- **Old events before idle detection** (pre-Apr 24, 2026). A tab left
  open overnight would have logged continuous time. Worklogs already
  posted from those events can be edited/deleted by hand in
  Tempo's Activities tab.

- **Multiple open tabs for the same course**. Each tab flushes its own
  session events. Two tabs over the same hour = two hours logged.

- **Tempo's own "Automate Time Logging"**. If enabled on the same
  Jira user account, Tempo posts worklogs for general Jira activity.
  These are independent of our pipeline and will stack on top of ours.
  Check the author + comment to tell them apart (ours say "worksheet
  session (via sync-jira-time.mjs)").

- **Meeting overlap gaps**. If the calendar event UIDs change between
  syncs, the overlap subtraction can miss one window. Rare, but
  possible with recurring-event series edits.

## Known under-counting sources

- **No identity set on the worksheet browser** (pre-Apr 24, 2026).
  Events with null identity were skipped.
- **sync-server.js not running** when the button is clicked —
  on-demand sync fails silently to the user. Nightly cron still runs.

## Quick debug checklist

1. Open the Jira issue's worklog panel. Filter by comment
   "worksheet session". Those are ours.
2. If the total looks wrong, query Supabase:
   ```sql
   select date_trunc('day', started_at)::date as day,
          count(*), sum(extract(epoch from (ended_at - started_at)))/60 as minutes
     from worksheet_session_events
    where course_id = 'tph501'
    group by 1 order by 1;
   ```
   Compare against known work sessions.
3. If a day has wildly more minutes than expected, look at the
   individual rows — likely a single very-long `ended_at - started_at`
   window from the pre-idle-detection era.
4. If a day is missing, check `identity_name` — null rows won't sync.

## Source files

- Browser timer: `course-worksheet-v2.html` (search `_flushSessionTime`)
- Supabase schema: tables `worksheet_sessions`, `worksheet_session_events`
- Cron script: `scripts/sync-jira-time.mjs`
- On-demand endpoint: `sync-server.js` (`/jira/sync-time`)
- Dashboard button: `id-dashboard.html` (search `syncJiraTimeNow`)
- Launchd plist: `scripts/com.elisa.sync-jira-time.plist`
