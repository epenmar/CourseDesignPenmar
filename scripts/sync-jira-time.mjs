#!/usr/bin/env node
// sync-jira-time.mjs — Nightly worker that pushes un-synced worksheet session
// time to Jira as worklogs (default: Designing sub-task; fallback: Epic).
//
// What it does:
//   1. Loads every row from worksheet_sessions in Supabase
//   2. For each course_id, sums (total_ms - jira_synced_ms) across identities
//   3. Looks up the course's Jira Epic in dashboard_state.course_jira_epics
//      (user overrides) falling back to the built-in COURSE_JIRA_EPICS map
//   4. Fetches the Epic's children, picks the one whose summary matches
//      /designing/i, else uses the Epic itself
//   5. Posts a worklog to that target and updates jira_synced_ms = total_ms
//      on every row it swept, so the next run only sees new time
//
// Usage:
//   node scripts/sync-jira-time.mjs             # post + mark synced
//   node scripts/sync-jira-time.mjs --dry       # compute + print (no writes)
//   node scripts/sync-jira-time.mjs --min=5     # require >=5 min (default 1)
//
// Requires JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in /Users/epenmar/conductor/.env.
// Logs to stdout; cron should redirect to ~/Library/Logs/sync-jira-time.log.

import { readFileSync } from 'node:fs';

const ENV_FILE = '/Users/epenmar/conductor/.env';
const SUPABASE_URL = 'https://oepkskqxyuzwaiglltly.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_G_EPvRxbrjl1EWjDbWR7Yg_Z7IKBkFg';

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

  let sessions;
  try {
    sessions = await sbSelect('worksheet_sessions',
      'select=course_id,identity_name,identity_role,total_ms,session_count,last_visit,jira_synced_ms');
  } catch (e) {
    if (/jira_synced_ms/.test(e.message)) {
      // Column hasn't been added yet — fall back so the cron still works.
      console.warn('[sync-jira-time] jira_synced_ms column missing. Run the schema migration. Treating all time as unsynced for this run.');
      sessions = await sbSelect('worksheet_sessions',
        'select=course_id,identity_name,identity_role,total_ms,session_count,last_visit');
      sessions.forEach(s => { s.jira_synced_ms = 0; });
    } else if (/worksheet_sessions/.test(e.message) && /Could not find|does not exist|PGRST205/.test(e.message)) {
      console.warn('[sync-jira-time] worksheet_sessions table not found. Run supabase-schema.sql first. Exiting cleanly.');
      return;
    } else {
      throw e;
    }
  }
  if (!sessions.length) { console.log('[sync-jira-time] No sessions in table.'); return; }

  // Bucket by course and sum unsynced ms
  const buckets = {};
  for (const s of sessions) {
    const delta = Math.max(0, Number(s.total_ms || 0) - Number(s.jira_synced_ms || 0));
    if (!buckets[s.course_id]) buckets[s.course_id] = { rows: [], unsyncedMs: 0 };
    buckets[s.course_id].rows.push(s);
    buckets[s.course_id].unsyncedMs += delta;
  }

  const overrides = await loadEpicOverrides();

  const summary = { posted: 0, skippedNoEpic: 0, skippedBelowMin: 0, failed: 0, minutesLogged: 0 };
  for (const courseId of Object.keys(buckets).sort()) {
    const bucket = buckets[courseId];
    const seconds = Math.floor(bucket.unsyncedMs / 1000);
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
    console.log(`  · ${courseId}: ${mins}m → ${target} (${targetKind})`);

    if (DRY) { summary.minutesLogged += mins; continue; }

    try {
      await postWorklog(target, seconds, `Dashboard worksheet time (${courseId}) — nightly sync`);
      // Mark every session row in this bucket as fully synced
      for (const s of bucket.rows) {
        const total = Number(s.total_ms || 0);
        if (total <= Number(s.jira_synced_ms || 0)) continue;
        const filter =
          `course_id=eq.${encodeURIComponent(s.course_id)}` +
          `&identity_name=eq.${encodeURIComponent(s.identity_name)}` +
          `&identity_role=eq.${encodeURIComponent(s.identity_role)}`;
        await sbPatch('worksheet_sessions', filter, { jira_synced_ms: total });
      }
      summary.posted++;
      summary.minutesLogged += mins;
    } catch (e) {
      summary.failed++;
      console.error(`    ! ${courseId} failed:`, e.message);
    }
  }

  console.log(`[sync-jira-time] Done. posted=${summary.posted} failed=${summary.failed} skipped_no_epic=${summary.skippedNoEpic} skipped_below_min=${summary.skippedBelowMin} total_minutes=${summary.minutesLogged}`);
}

main().catch(e => {
  console.error('[sync-jira-time] Fatal:', e);
  process.exit(1);
});
