#!/usr/bin/env node
// sync-jira-time.mjs — Nightly worker that pushes un-synced worksheet session
// time to Jira as worklogs (default: Designing sub-task; fallback: Epic).
//
// What it does:
//   1. Loads unsynced rows from worksheet_session_events in Supabase
//   2. For each course_id, subtracts overlap with calendar-meeting intervals
//      so worksheet time that happened DURING a meeting isn't double-counted
//   3. Adds past-calendar-meeting duration for meetings we haven't synced yet
//   4. Looks up the course's Jira Epic in dashboard_state.course_jira_epics
//      (user overrides) falling back to the built-in COURSE_JIRA_EPICS map
//   5. Fetches the Epic's children, picks the one whose summary matches
//      /designing/i, else uses the Epic itself
//   6. Posts a worklog, marks events as synced_to_jira=true, and records the
//      meeting UIDs in dashboard_state.meeting_synced_uids
//
// Usage:
//   node scripts/sync-jira-time.mjs             # post + mark synced
//   node scripts/sync-jira-time.mjs --dry       # compute + print (no writes)
//   node scripts/sync-jira-time.mjs --min=5     # require >=5 min (default 1)
//
// Requires JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in /Users/epenmar/conductor/.env.
// Logs to stdout; cron should redirect to ~/Library/Logs/sync-jira-time.log.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DATA_FILE = path.join(__dirname, '..', 'dashboard-data.js');

const ENV_FILE = '/Users/epenmar/conductor/.env';
// Must match supabase-config.js in the repo root (single source of truth).
const SUPABASE_URL = 'https://gflnymqjraxonbdtbxma.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_di7j_DR1Ie3GJdOtHb8NlQ_rI5eiP4Y';

const DRY = process.argv.includes('--dry');
const minArg = (process.argv.find(a => a.startsWith('--min=')) || '').split('=')[1];
const MIN_SECONDS = Math.max(60, parseInt(minArg || '1', 10) * 60);

// Course IDs we won't bother syncing time for. Earlier matchers polluted
// session events and dashboard-data with non-academic prefixes (room, rm,
// shs is real but not Elisa's portfolio, etc.). Skip them silently rather
// than logging "no Epic mapped" every nightly run.
const ID_PREFIX_DENYLIST = new Set(['ROOM', 'RM', 'SHS', 'CONF', 'CONFROOM']);
function isCourseIdSyncable(courseId) {
  var letterGroups = String(courseId || '').match(/[a-z]+/gi) || [];
  if (!letterGroups.length) return false;
  // If ANY letter group is in the denylist, skip the whole id.
  return !letterGroups.some(function(lg) { return ID_PREFIX_DENYLIST.has(lg.toUpperCase()); });
}

// Keep this in lockstep with COURSE_JIRA_EPICS in id-dashboard.html.
// Overrides from dashboard_state.course_jira_epics take precedence at runtime.
const BUILT_IN_EPICS = {
  mns522:    'EDL-7828',
  lsc598gen: 'EDL-7829',
  bst515:    'EDL-7825',
  bst605:    'EDL-7802',
  bst606:    'EDL-7797',
  bst609:    'EDL-7803',
  tph501:    'EDL-7824',
  tph550:    'EDL-7805',
  tph557:    'EDL-7804'
};

function loadEnv() {
  const raw = readFileSync(ENV_FILE, 'utf8');
  const out = {};
  raw.split('\n').forEach(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
  return out;
}

const ENV = loadEnv();
const JIRA_BASE  = ENV.JIRA_BASE_URL;
const JIRA_EMAIL = ENV.JIRA_EMAIL;
const JIRA_TOKEN = ENV.JIRA_API_TOKEN;
if (!JIRA_BASE || !JIRA_EMAIL || !JIRA_TOKEN) {
  console.error('[sync-jira-time] Missing JIRA_* env vars in', ENV_FILE);
  process.exit(1);
}
const JIRA_AUTH = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
const JIRA_HEADERS = {
  Authorization: JIRA_AUTH,
  Accept: 'application/json',
  'Content-Type': 'application/json'
};

// ---------- Supabase (raw REST; no SDK dep) ----------
const SB_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
  'Content-Type': 'application/json'
};

async function sbSelect(table, query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: SB_HEADERS });
  if (!r.ok) throw new Error(`Supabase ${table} GET ${r.status}: ${await r.text()}`);
  return r.json();
}

async function sbPatch(table, filterQuery, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filterQuery}`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Supabase ${table} PATCH ${r.status}: ${await r.text()}`);
}

// `dashboard_state.meeting_synced_uids` historical shape was
//   { courseId: [uid1, uid2, ...] }
// Newer shape stores the meeting interval alongside the UID:
//   { courseId: [{ uid, start, end }, ...] }
// The interval form lets us subtract a meeting's wall-clock range from
// future worksheet events even after the meeting has rolled out of the
// current calendar, AND lets us subtract already-synced worksheet event
// time from a freshly-discovered meeting so we don't double-count when
// the calendar lags. Both shapes are read here; writes always emit the
// new shape, so the ledger migrates itself over time.
async function loadSyncedMeetingUids() {
  try {
    const rows = await sbSelect('dashboard_state', 'key=eq.meeting_synced_uids&select=data');
    return (rows[0] && rows[0].data) || {};
  } catch (e) {
    console.warn('[sync-jira-time] Could not read meeting_synced_uids:', e.message);
    return {};
  }
}

// Normalize a ledger entry to {uid, start?, end?}. Legacy entries are
// plain string UIDs and have no interval available.
function syncedEntryToObj(entry) {
  if (typeof entry === 'string') return { uid: entry };
  return entry || {};
}

// Build a Set of every meeting UID known to be already posted to Jira
// for `courseId` — used to skip meetings we've already accounted for.
function syncedUidSetForCourse(syncedUidMap, courseId) {
  const arr = syncedUidMap[courseId] || [];
  return new Set(arr.map(e => syncedEntryToObj(e).uid).filter(Boolean));
}

// Pull [startMs, endMs] intervals out of historical synced ledger entries
// that have them. Older string-only entries contribute no interval — but
// they're still recorded so we don't re-post their UIDs.
function syncedIntervalsForCourse(syncedUidMap, courseId) {
  const arr = syncedUidMap[courseId] || [];
  const out = [];
  for (const e of arr) {
    const obj = syncedEntryToObj(e);
    const s = Number(obj.start), n = Number(obj.end);
    if (s > 0 && n > s) out.push([s, n]);
  }
  return out;
}

// Merge an arbitrary number of [startMs, endMs] interval lists into a
// single sorted + dedupe-merged list. Used to combine current-calendar
// intervals with historical synced-meeting intervals so overlap math
// against worksheet events considers BOTH.
function mergeIntervalLists(...lists) {
  const flat = [];
  for (const list of lists) for (const iv of (list || [])) flat.push([iv[0], iv[1]]);
  flat.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of flat) {
    if (merged.length && iv[0] <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], iv[1]);
    } else {
      merged.push([iv[0], iv[1]]);
    }
  }
  return merged;
}

// Parse a meeting's wall-clock start/end in ms. Prefers dtStartIso /
// dtEndIso; falls back to "date + time + durationMinutes" as buildMeetingIntervals does.
function meetingInterval(m) {
  const durMs = Math.max(0, Number(m.durationMinutes || 0)) * 60000;
  let start = null;
  if (m.dtStartIso) {
    const d = new Date(m.dtStartIso);
    if (!isNaN(d.getTime())) start = d.getTime();
  }
  if (start == null && m.date && m.time) {
    const d = new Date(`${m.date} ${m.time}`);
    if (!isNaN(d.getTime())) start = d.getTime();
  }
  if (start == null) return null;
  const end = m.dtEndIso ? new Date(m.dtEndIso).getTime() : start + durMs;
  if (isNaN(end) || end <= start) return null;
  return [start, end];
}

async function saveSyncedMeetingUids(map) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/dashboard_state`, {
      method: 'POST',
      headers: { ...SB_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key: 'meeting_synced_uids', data: map })
    });
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  } catch (e) {
    console.warn('[sync-jira-time] Could not persist meeting_synced_uids:', e.message);
  }
}

function loadCalendarMeetingsByCourse() {
  // dashboard-data.js is `window.SYNCED_DATA = { ... };`
  // Parse it by regex-stripping the wrapper and JSON.parsing the body.
  try {
    const raw = readFileSync(DASHBOARD_DATA_FILE, 'utf8');
    const m = raw.match(/window\.SYNCED_DATA\s*=\s*(\{[\s\S]*\});?\s*$/);
    if (!m) throw new Error('Could not locate SYNCED_DATA assignment');
    const synced = JSON.parse(m[1]);
    const out = {};
    const courses = (synced && synced.courses) || {};
    for (const [courseId, c] of Object.entries(courses)) {
      const meetings = (c.calendarMeetings || []).filter(cm => cm.past === true && typeof cm.durationMinutes === 'number' && cm.durationMinutes > 0);
      if (meetings.length) out[courseId] = meetings;
    }
    return out;
  } catch (e) {
    console.warn('[sync-jira-time] Could not load calendar meetings:', e.message);
    return {};
  }
}

// ---------- Interval overlap math ----------
// Build a merged (sorted, non-overlapping) list of [startMs, endMs] for a
// course's past meetings. Meetings missing dtStartIso fall back to
// date+time parsing + durationMinutes.
function buildMeetingIntervals(meetings) {
  const raw = [];
  for (const m of meetings) {
    const durMs = Math.max(0, Number(m.durationMinutes || 0)) * 60000;
    if (durMs <= 0) continue;
    let start = null;
    if (m.dtStartIso) {
      const d = new Date(m.dtStartIso);
      if (!isNaN(d.getTime())) start = d.getTime();
    }
    // Fallback: parse "YYYY-MM-DD" + "H:MM AM/PM" as local time.
    if (start == null && m.date && m.time) {
      const d = new Date(`${m.date} ${m.time}`);
      if (!isNaN(d.getTime())) start = d.getTime();
    }
    if (start == null) continue;
    const end = m.dtEndIso ? new Date(m.dtEndIso).getTime() : start + durMs;
    if (isNaN(end) || end <= start) continue;
    raw.push([start, end]);
  }
  raw.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of raw) {
    if (merged.length && iv[0] <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], iv[1]);
    } else {
      merged.push([iv[0], iv[1]]);
    }
  }
  return merged;
}

// Portion of [startMs, endMs] that does NOT fall inside any interval in `merged`.
function nonOverlapMs(startMs, endMs, merged) {
  if (endMs <= startMs) return 0;
  if (!merged.length) return endMs - startMs;
  let overlap = 0;
  for (const [a, b] of merged) {
    if (b <= startMs) continue;
    if (a >= endMs) break;
    overlap += Math.min(endMs, b) - Math.max(startMs, a);
  }
  return Math.max(0, (endMs - startMs) - overlap);
}

async function loadEpicOverrides() {
  try {
    const rows = await sbSelect('dashboard_state', 'key=eq.course_jira_epics&select=data');
    return (rows[0] && rows[0].data) || {};
  } catch (e) {
    console.warn('[sync-jira-time] Could not read overrides:', e.message);
    return {};
  }
}

function resolveEpic(courseId, overrides) {
  if (overrides[courseId]) return overrides[courseId];
  if (BUILT_IN_EPICS[courseId]) return BUILT_IN_EPICS[courseId];
  const bare = String(courseId).toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9]/g, '').toLowerCase();
  return BUILT_IN_EPICS[bare] || null;
}

// Build the human-readable course code variants Jira's summary search will
// match against ("POP 644", "POP644"). Course IDs are stored lowercase
// without spaces (e.g. "pop644").
function courseCodeVariants(courseId) {
  const upper = String(courseId).toUpperCase();
  const m = upper.match(/^([A-Z]+)(\d.*)$/);
  if (!m) return [upper];
  return [m[1] + ' ' + m[2], m[1] + m[2]];
}

// Try to discover the Jira Epic for a course by searching for issues whose
// summary contains the course code. Used when neither user overrides nor
// BUILT_IN_EPICS know about the course. Returns the Epic key or null.
async function discoverEpicForCourse(courseId) {
  const variants = courseCodeVariants(courseId);
  // Search across all projects for an Epic whose summary contains a variant.
  // Order by created desc so the most recent Epic wins if multiple exist.
  const escaped = variants.map(v => `"${v}"`).join(' OR ');
  const jql = `issuetype = Epic AND (summary ~ ${escaped}) ORDER BY created DESC`;
  try {
    const r = await fetchWithRetry(`${JIRA_BASE}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: JIRA_HEADERS,
      body: JSON.stringify({ jql: jql, fields: ['summary'], maxResults: 5 })
    });
    if (!r.ok) return null;
    const data = await r.json();
    const issues = (data && data.issues) || [];
    if (!issues.length) return null;
    // Prefer Epics whose summary contains the spaced variant — those are
    // course-development Epics; a generic project Epic with a stray code
    // hit ranks lower.
    const spacedNeedle = variants[0].toUpperCase();
    const spacedHit = issues.find(it => (it.fields && it.fields.summary || '').toUpperCase().includes(spacedNeedle));
    return (spacedHit || issues[0]).key;
  } catch (e) {
    console.warn(`[discover-epic] ${courseId}: ${e.message}`);
    return null;
  }
}

async function persistDiscoveredEpics(overrides) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/dashboard_state`, {
      method: 'POST',
      headers: { ...SB_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key: 'course_jira_epics', data: overrides })
    });
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  } catch (e) {
    console.warn('[sync-jira-time] Could not persist discovered Epics:', e.message);
  }
}

// ---------- Jira ----------
// Wrap fetch with a small retry budget so a transient TLS reset (Atlassian
// occasionally closes the connection mid-flight) doesn't abort the whole
// nightly run. Only retries on network-level errors, not on HTTP errors.
async function fetchWithRetry(url, opts, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      lastErr = e;
      const transient = e && /ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up/i.test(
        (e.message || '') + ' ' + ((e.cause && e.cause.message) || '')
      );
      if (!transient || i === attempts - 1) throw e;
      const backoffMs = 500 * (i + 1);
      console.warn(`[sync-jira-time] fetch failed (${e.message}) — retrying in ${backoffMs}ms`);
      await new Promise(res => setTimeout(res, backoffMs));
    }
  }
  throw lastErr;
}

async function findDesigningChild(epicKey) {
  const r = await fetchWithRetry(`${JIRA_BASE}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: JIRA_HEADERS,
    body: JSON.stringify({
      jql: `parent = ${epicKey}`,
      fields: ['summary'],
      maxResults: 50
    })
  });
  if (!r.ok) return null;
  const data = await r.json();
  const kids = (data && data.issues) || [];
  const designing = kids.find(i => /\bdesigning\b/i.test((i.fields && i.fields.summary) || ''));
  return designing ? designing.key : null;
}

async function postWorklog(issueKey, seconds, comment) {
  const body = {
    timeSpentSeconds: seconds,
    comment: {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }]
    }
  };
  const r = await fetchWithRetry(`${JIRA_BASE}/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog`, {
    method: 'POST',
    headers: JIRA_HEADERS,
    body: JSON.stringify(body)
  });
  if (r.status !== 201) {
    const txt = await r.text();
    throw new Error(`Jira worklog ${issueKey} ${r.status}: ${txt.slice(0, 300)}`);
  }
  return r.json();
}

// ---------- Main ----------
async function main() {
  const started = new Date().toISOString();
  console.log(`[sync-jira-time] Starting run at ${started} (dry=${DRY}, minSeconds=${MIN_SECONDS})`);

  // Load unsynced worksheet events — ROLE-FILTERED.
  //
  // We only post time from identity_role = 'id' (the instructional
  // designer). Faculty + reviewer sessions used to flow into Jira too
  // because the script grouped by course_id alone, which silently
  // inflated every course's Designing worklog by every visitor's
  // session time. The dashboard sidebar still shows everyone's time
  // (it reads worksheet_sessions, not events) so faculty visibility
  // isn't lost — only the Jira ledger is now ID-scoped.
  let events = [];
  try {
    events = await sbSelect('worksheet_session_events',
      'select=id,course_id,identity_name,identity_role,started_at,ended_at&synced_to_jira=eq.false&identity_role=eq.id&order=started_at.asc');
  } catch (e) {
    if (/PGRST205|Could not find|does not exist/.test(e.message)) {
      console.warn('[sync-jira-time] worksheet_session_events table not found — run the schema migration. Continuing with meeting time only.');
      events = [];
    } else {
      throw e;
    }
  }
  if (!events.length) console.log('[sync-jira-time] No unsynced worksheet events; processing calendar meetings only.');

  // Pull ALREADY-SYNCED ID-role events too — used for overlap subtraction
  // against new meetings. If a worksheet event covering 2-3pm got posted
  // last night, and a 2-3pm meeting lands in the calendar today, that
  // meeting's standalone post should subtract the already-paid portion
  // so the same hour isn't billed twice. We only need course_id + start
  // + end; size is bounded (~couple thousand rows per course over months).
  let historicalSyncedEvents = [];
  try {
    historicalSyncedEvents = await sbSelect('worksheet_session_events',
      'select=course_id,started_at,ended_at&synced_to_jira=eq.true&identity_role=eq.id&order=started_at.asc');
  } catch (e) {
    if (!/PGRST205|Could not find|does not exist/.test(e.message)) {
      console.warn('[sync-jira-time] Could not load historical synced events:', e.message);
    }
  }
  // Pre-bucket by course so the loop below is O(1) per course.
  const historicalEventIntervalsByCourse = {};
  for (const ev of historicalSyncedEvents) {
    const s = new Date(ev.started_at).getTime();
    const e = new Date(ev.ended_at).getTime();
    if (isNaN(s) || isNaN(e) || e <= s) continue;
    (historicalEventIntervalsByCourse[ev.course_id] = historicalEventIntervalsByCourse[ev.course_id] || []).push([s, e]);
  }
  for (const cid of Object.keys(historicalEventIntervalsByCourse)) {
    historicalEventIntervalsByCourse[cid] = mergeIntervalLists(historicalEventIntervalsByCourse[cid]);
  }

  // Load calendar meetings and already-synced meeting UIDs.
  const calendarByCourse = loadCalendarMeetingsByCourse();
  const syncedUidMap = await loadSyncedMeetingUids();

  // Build per-course buckets with BIDIRECTIONAL overlap-corrected time.
  //
  //   - Worksheet events subtract overlap with BOTH current-calendar
  //     meetings AND historical synced-meeting intervals from the ledger.
  //     This catches the case where a meeting was synced standalone on
  //     a prior run and a worksheet event spanning that meeting arrives
  //     late (e.g. user closes their tab, beforeunload flush lands a
  //     row dated yesterday).
  //
  //   - Meetings being posted standalone (UID not yet in ledger) subtract
  //     overlap with ALREADY-SYNCED worksheet event intervals from their
  //     duration. This catches the mirror case: a meeting wasn't in the
  //     calendar at the time worksheet events covering its window got
  //     synced, so that window already counted toward worksheet time —
  //     posting the meeting at full duration would double-count.
  const buckets = {};
  const courseIds = new Set([
    ...Object.keys(calendarByCourse),
    ...events.map(e => e.course_id)
  ]);
  for (const courseId of courseIds) {
    const meetings = calendarByCourse[courseId] || [];
    const currentIntervals = buildMeetingIntervals(meetings);
    const historicalMeetingIntervals = syncedIntervalsForCourse(syncedUidMap, courseId);
    const allMeetingIntervals = mergeIntervalLists(currentIntervals, historicalMeetingIntervals);
    const historicalEventIntervals = historicalEventIntervalsByCourse[courseId] || [];

    // 1. Worksheet events: subtract overlap with the FULL meeting interval
    //    set (current + historical).
    const courseEvents = events.filter(e => e.course_id === courseId);
    let worksheetMs = 0;
    const eventIds = [];
    const newEventIntervals = []; // [[start, end], …] of THIS run's events
    for (const ev of courseEvents) {
      const s = new Date(ev.started_at).getTime();
      const e = new Date(ev.ended_at).getTime();
      if (isNaN(s) || isNaN(e) || e <= s) continue;
      worksheetMs += nonOverlapMs(s, e, allMeetingIntervals);
      eventIds.push(ev.id);
      newEventIntervals.push([s, e]);
    }
    // For meeting-side overlap subtraction we want EVERY ID-role event
    // interval that's been posted, which is historical + this run's
    // about-to-be-posted ones.
    const eventIntervalsForSubtract = mergeIntervalLists(historicalEventIntervals, newEventIntervals);

    // 2. Meetings: skip UIDs already in the ledger; for new UIDs, post
    //    only the portion NOT overlapping any already-counted event window.
    const alreadyUids = syncedUidSetForCourse(syncedUidMap, courseId);
    let meetingMs = 0;
    const newMeetingEntries = []; // [{uid, start, end, postedMs}]
    for (const m of meetings) {
      if (!m.uid || alreadyUids.has(m.uid)) continue;
      const iv = meetingInterval(m);
      if (!iv) continue;
      const [mStart, mEnd] = iv;
      const postedMs = nonOverlapMs(mStart, mEnd, eventIntervalsForSubtract);
      meetingMs += postedMs;
      newMeetingEntries.push({ uid: m.uid, start: mStart, end: mEnd, postedMs: postedMs });
    }
    if (worksheetMs > 0 || meetingMs > 0 || eventIds.length || newMeetingEntries.length) {
      buckets[courseId] = { worksheetMs, meetingMs, eventIds, newMeetingEntries };
    }
  }

  const overrides = await loadEpicOverrides();
  let overridesDirty = false;

  const summary = { posted: 0, skippedNoEpic: 0, skippedBelowMin: 0, failed: 0, minutesLogged: 0, meetingMinutes: 0 };
  let anyMeetingUidsNewlySynced = false;
  for (const courseId of Object.keys(buckets).sort()) {
    try {
    const bucket = buckets[courseId];
    if (!isCourseIdSyncable(courseId)) {
      // Silently skip non-portfolio / room-pattern IDs that older matchers
      // left behind. Don't log noise — they'll keep showing up forever
      // until the underlying session_events get cleaned up.
      continue;
    }
    const totalMs = bucket.worksheetMs + bucket.meetingMs;
    const seconds = Math.floor(totalMs / 1000);
    if (seconds < MIN_SECONDS) {
      summary.skippedBelowMin++;
      console.log(`  · ${courseId}: ${seconds}s unsynced — below threshold, skipping`);
      continue;
    }
    let epic = resolveEpic(courseId, overrides);
    if (!epic) {
      // Auto-discover by searching Jira for an Epic whose summary contains
      // the course code. Persists the result so future runs hit the
      // overrides cache instead of re-querying.
      const discovered = await discoverEpicForCourse(courseId);
      if (discovered) {
        overrides[courseId] = discovered;
        overridesDirty = true;
        epic = discovered;
        console.log(`  · ${courseId}: auto-discovered Epic ${discovered}`);
      }
    }
    if (!epic) {
      summary.skippedNoEpic++;
      console.log(`  · ${courseId}: ${Math.round(seconds/60)}m unsynced — no Jira Epic found, skipping`);
      continue;
    }

    let target = await findDesigningChild(epic);
    let targetKind = target ? 'Designing' : 'Epic';
    if (!target) target = epic;

    const mins = Math.round(seconds / 60);
    const worksheetMins = Math.round(bucket.worksheetMs / 60000);
    const meetingMins = Math.round(bucket.meetingMs / 60000);
    const meetingNote = meetingMins > 0 ? ` (worksheet ${worksheetMins}m + meetings ${meetingMins}m across ${bucket.newMeetingEntries.length})` : '';
    console.log(`  · ${courseId}: ${mins}m${meetingNote} → ${target} (${targetKind})`);

    if (DRY) {
      summary.minutesLogged += mins;
      summary.meetingMinutes += meetingMins;
      continue;
    }

    try {
      await postWorklog(target, seconds, `Dashboard time (${courseId}) — nightly sync${meetingNote}`);
      // Mark every worksheet event in this bucket as synced
      if (bucket.eventIds.length) {
        const filter = 'id=in.(' + bucket.eventIds.join(',') + ')';
        await sbPatch('worksheet_session_events', filter, { synced_to_jira: true });
      }
      // Persist each new meeting with its [start, end] interval so future
      // runs can subtract overlap. Existing string-only entries get
      // migrated to objects on the fly, converging the ledger to the new
      // shape without a separate migration step.
      if (bucket.newMeetingEntries.length) {
        const prev = (syncedUidMap[courseId] || []).map(syncedEntryToObj);
        const additions = bucket.newMeetingEntries.map(e => ({ uid: e.uid, start: e.start, end: e.end }));
        const seenUids = new Set();
        syncedUidMap[courseId] = [...prev, ...additions].filter(e => {
          if (!e.uid || seenUids.has(e.uid)) return false;
          seenUids.add(e.uid);
          return true;
        });
        anyMeetingUidsNewlySynced = true;
      }
      summary.posted++;
      summary.minutesLogged += mins;
      summary.meetingMinutes += meetingMins;
    } catch (e) {
      summary.failed++;
      console.error(`    ! ${courseId} failed:`, e.message);
    }
    } catch (perCourseErr) {
      // Catches anything that escaped the inner postWorklog try/catch —
      // e.g. discoverEpicForCourse or findDesigningChild throwing. We log
      // and move to the next course so a transient hiccup on one course
      // doesn't take down the entire nightly run.
      summary.failed++;
      console.error(`    ! ${courseId} aborted:`, (perCourseErr && perCourseErr.message) || perCourseErr);
    }
  }

  if (anyMeetingUidsNewlySynced) {
    await saveSyncedMeetingUids(syncedUidMap);
  }
  if (overridesDirty && !DRY) {
    await persistDiscoveredEpics(overrides);
  }

  console.log(`[sync-jira-time] Done. posted=${summary.posted} failed=${summary.failed} skipped_no_epic=${summary.skippedNoEpic} skipped_below_min=${summary.skippedBelowMin} total_minutes=${summary.minutesLogged} (meetings=${summary.meetingMinutes})`);
}

main().catch(e => {
  console.error('[sync-jira-time] Fatal:', e);
  process.exit(1);
});
