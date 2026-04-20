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

async function loadSyncedMeetingUids() {
  try {
    const rows = await sbSelect('dashboard_state', 'key=eq.meeting_synced_uids&select=data');
    return (rows[0] && rows[0].data) || {};
  } catch (e) {
    console.warn('[sync-jira-time] Could not read meeting_synced_uids:', e.message);
    return {};
  }
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

// ---------- Jira ----------
async function findDesigningChild(epicKey) {
  const r = await fetch(`${JIRA_BASE}/rest/api/3/search/jql`, {
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
  const r = await fetch(`${JIRA_BASE}/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog`, {
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

  // Load unsynced worksheet events.
  let events = [];
  try {
    events = await sbSelect('worksheet_session_events',
      'select=id,course_id,identity_name,identity_role,started_at,ended_at&synced_to_jira=eq.false&order=started_at.asc');
  } catch (e) {
    if (/PGRST205|Could not find|does not exist/.test(e.message)) {
      console.warn('[sync-jira-time] worksheet_session_events table not found — run the schema migration. Continuing with meeting time only.');
      events = [];
    } else {
      throw e;
    }
  }
  if (!events.length) console.log('[sync-jira-time] No unsynced worksheet events; processing calendar meetings only.');

  // Load calendar meetings and already-synced meeting UIDs.
  const calendarByCourse = loadCalendarMeetingsByCourse();
  const syncedUidMap = await loadSyncedMeetingUids();

  // Build per-course buckets with overlap-corrected worksheet time + new meeting time.
  const buckets = {};
  const courseIds = new Set([
    ...Object.keys(calendarByCourse),
    ...events.map(e => e.course_id)
  ]);
  for (const courseId of courseIds) {
    const meetings = calendarByCourse[courseId] || [];
    const intervals = buildMeetingIntervals(meetings);
    const courseEvents = events.filter(e => e.course_id === courseId);
    let worksheetMs = 0;
    const eventIds = [];
    for (const ev of courseEvents) {
      const s = new Date(ev.started_at).getTime();
      const e = new Date(ev.ended_at).getTime();
      if (isNaN(s) || isNaN(e) || e <= s) continue;
      worksheetMs += nonOverlapMs(s, e, intervals);
      eventIds.push(ev.id);
    }
    const already = new Set(syncedUidMap[courseId] || []);
    let meetingMs = 0;
    const newMeetingUids = [];
    for (const m of meetings) {
      if (!m.uid || already.has(m.uid)) continue;
      meetingMs += m.durationMinutes * 60000;
      newMeetingUids.push(m.uid);
    }
    if (worksheetMs > 0 || meetingMs > 0 || eventIds.length) {
      buckets[courseId] = { worksheetMs, meetingMs, eventIds, newMeetingUids };
    }
  }

  const overrides = await loadEpicOverrides();

  const summary = { posted: 0, skippedNoEpic: 0, skippedBelowMin: 0, failed: 0, minutesLogged: 0, meetingMinutes: 0 };
  let anyMeetingUidsNewlySynced = false;
  for (const courseId of Object.keys(buckets).sort()) {
    const bucket = buckets[courseId];
    const totalMs = bucket.worksheetMs + bucket.meetingMs;
    const seconds = Math.floor(totalMs / 1000);
    if (seconds < MIN_SECONDS) {
      summary.skippedBelowMin++;
      console.log(`  · ${courseId}: ${seconds}s unsynced — below threshold, skipping`);
      continue;
    }
    const epic = resolveEpic(courseId, overrides);
    if (!epic) {
      summary.skippedNoEpic++;
      console.log(`  · ${courseId}: ${Math.round(seconds/60)}m unsynced — no Jira Epic mapped, skipping`);
      continue;
    }

    let target = await findDesigningChild(epic);
    let targetKind = target ? 'Designing' : 'Epic';
    if (!target) target = epic;

    const mins = Math.round(seconds / 60);
    const worksheetMins = Math.round(bucket.worksheetMs / 60000);
    const meetingMins = Math.round(bucket.meetingMs / 60000);
    const meetingNote = meetingMins > 0 ? ` (worksheet ${worksheetMins}m + meetings ${meetingMins}m across ${bucket.newMeetingUids.length})` : '';
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
      if (bucket.newMeetingUids.length) {
        const prev = syncedUidMap[courseId] || [];
        syncedUidMap[courseId] = Array.from(new Set([...prev, ...bucket.newMeetingUids]));
        anyMeetingUidsNewlySynced = true;
      }
      summary.posted++;
      summary.minutesLogged += mins;
      summary.meetingMinutes += meetingMins;
    } catch (e) {
      summary.failed++;
      console.error(`    ! ${courseId} failed:`, e.message);
    }
  }

  if (anyMeetingUidsNewlySynced) {
    await saveSyncedMeetingUids(syncedUidMap);
  }

  console.log(`[sync-jira-time] Done. posted=${summary.posted} failed=${summary.failed} skipped_no_epic=${summary.skippedNoEpic} skipped_below_min=${summary.skippedBelowMin} total_minutes=${summary.minutesLogged} (meetings=${summary.meetingMinutes})`);
}

main().catch(e => {
  console.error('[sync-jira-time] Fatal:', e);
  process.exit(1);
});
