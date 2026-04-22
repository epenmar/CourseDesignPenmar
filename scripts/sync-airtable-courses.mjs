#!/usr/bin/env node
// sync-airtable-courses.mjs — Nightly worker that mirrors Elisa's Course
// Developments from the ASU Online Airtable base into the dashboard.
//
// What it does:
//   1. Reads the list of Course Developments linked to Elisa's Stakeholder
//      record (`recq21R3WHqhbqHAt`) via `Course Developments 2`.
//   2. Fetches those records (Course, Course Title, Faculty Developer,
//      Session Launch, Completion %).
//   3. For each record, decides one of three outcomes:
//        a. already-known (recordId present in dashboard) → skip
//        b. matching course-code on dashboard but no recordId yet → link-only
//           (writes `course_airtable_urls[key]` so comments work). Never
//           overwrites any other course data.
//        c. no matching course code → auto-imports: appends to
//           `dashboard_state.airtable_auto_imports` with seen=false so the
//           dashboard banner alerts on next load.
//
// Writes to Supabase `dashboard_state` table keys:
//   - `airtable_auto_imports` — { recordId: {code, title, instructor, email, session, pct, importedAt, seen} }
//   - `course_airtable_urls`  — { courseKey: airtableUrl } (shared w/ dashboard)
//
// Usage:
//   node scripts/sync-airtable-courses.mjs          # real run
//   node scripts/sync-airtable-courses.mjs --dry    # log only, no writes
//
// Requires AIRTABLE_PAT in /Users/epenmar/conductor/.env.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DATA_FILE = path.join(__dirname, '..', 'dashboard-data.js');
const USER_COURSES_KEY = 'user_courses'; // Supabase-mirrored user-added courses

const ENV_FILE = '/Users/epenmar/conductor/.env';
// Must match supabase-config.js
const SUPABASE_URL = 'https://gflnymqjraxonbdtbxma.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_di7j_DR1Ie3GJdOtHb8NlQ_rI5eiP4Y';

const AIRTABLE_BASE = 'appRrjeSGPrfXPSuu';
const STAKEHOLDERS_TABLE = 'tblrrgIPU8UsVGcUg';
const DEVELOPMENTS_TABLE = 'tblhu9fDKBqoG9HQ3';
const MY_STAKEHOLDER_ID = 'recq21R3WHqhbqHAt';

const DRY = process.argv.includes('--dry');

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
const PAT = ENV.AIRTABLE_PAT;
if (!PAT) {
  console.error('[sync-airtable] Missing AIRTABLE_PAT in', ENV_FILE);
  process.exit(1);
}
const AT_HEADERS = { Authorization: 'Bearer ' + PAT };

const SB_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
  'Content-Type': 'application/json'
};

// ---------- Airtable ----------
async function fetchStakeholderCourseIds() {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${STAKEHOLDERS_TABLE}/${MY_STAKEHOLDER_ID}`;
  const r = await fetch(url, { headers: AT_HEADERS });
  if (!r.ok) throw new Error(`Stakeholder fetch ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return (j.fields && j.fields['Course Developments 2']) || [];
}

async function fetchCourseDevelopments(devIds) {
  if (devIds.length === 0) return [];
  const fields = ['Course', 'Course Title', 'Faculty Developer Name', 'Faculty Developer Email', 'Course Completion Percentage', 'Session Launch (Start Date)', 'Created'];
  const fieldQs = fields.map(f => 'fields%5B%5D=' + encodeURIComponent(f)).join('&');
  const out = [];
  for (let i = 0; i < devIds.length; i += 25) {
    const chunk = devIds.slice(i, i + 25);
    const formula = 'OR(' + chunk.map(rid => `RECORD_ID()%3D%22${rid}%22`).join('%2C') + ')';
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${DEVELOPMENTS_TABLE}?filterByFormula=${formula}&${fieldQs}`;
    const r = await fetch(url, { headers: AT_HEADERS });
    if (!r.ok) throw new Error(`Course fetch ${r.status}: ${await r.text()}`);
    const j = await r.json();
    (j.records || []).forEach(rec => out.push(rec));
  }
  return out.map(r => {
    const f = r.fields || {};
    const sess = f['Session Launch (Start Date)'] || [];
    return {
      recordId: r.id,
      code: f['Course'] || '',
      title: f['Course Title'] || '',
      instructor: f['Faculty Developer Name'] || '',
      email: f['Faculty Developer Email'] || '',
      pct: Math.round((f['Course Completion Percentage'] || 0) * 100),
      session: sess[0] || ''
    };
  });
}

// ---------- Supabase ----------
async function sbRead(key) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/dashboard_state?key=eq.${key}&select=data`, { headers: SB_HEADERS });
  if (!r.ok) throw new Error(`Supabase read ${key} ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  return (rows[0] && rows[0].data) || null;
}

async function sbWrite(key, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/dashboard_state`, {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, data })
  });
  if (!r.ok) throw new Error(`Supabase write ${key} ${r.status}: ${await r.text()}`);
}

// ---------- Dashboard state snapshots ----------
// Read the built-in course IDs from dashboard-data.js so we know which codes
// already exist on the dashboard (even without localStorage/Supabase).
function loadBuiltInCourses() {
  try {
    const raw = readFileSync(DASHBOARD_DATA_FILE, 'utf8');
    const m = raw.match(/window\.SYNCED_DATA\s*=\s*(\{[\s\S]*\});?\s*$/);
    if (!m) return {};
    const synced = JSON.parse(m[1]);
    return synced.courses || {};
  } catch (e) {
    console.warn('[sync-airtable] Could not load dashboard-data.js:', e.message);
    return {};
  }
}

function extractRecordIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/\brec[A-Za-z0-9]{14,}\b/);
  return m ? m[0] : null;
}

function codeToKey(code) {
  return (code || '').toLowerCase().replace(/\s+/g, '');
}

// ---------- Main ----------
async function main() {
  console.log(`[sync-airtable] ${new Date().toISOString()} start${DRY ? ' (DRY RUN)' : ''}`);

  // 1. Fetch Airtable records
  const devIds = await fetchStakeholderCourseIds();
  console.log(`[sync-airtable] Stakeholder has ${devIds.length} linked Course Developments`);
  const candidates = await fetchCourseDevelopments(devIds);
  console.log(`[sync-airtable] Fetched ${candidates.length} Airtable course records`);

  // 2. Gather current dashboard state
  const builtIn = loadBuiltInCourses();
  const userCourses = (await sbRead(USER_COURSES_KEY)) || {};
  const airtableUrlMap = (await sbRead('course_airtable_urls')) || {};
  const autoImports = (await sbRead('airtable_auto_imports')) || {};

  // Build set of known record IDs (already linked to a dashboard course)
  const knownRecordIds = new Set();
  // From airtable URL map (both built-in and user courses)
  Object.values(airtableUrlMap).forEach(url => {
    const rid = extractRecordIdFromUrl(url);
    if (rid) knownRecordIds.add(rid);
  });
  // From user_courses.airtableRecordId
  Object.values(userCourses).forEach(c => {
    if (c && c.airtableRecordId) knownRecordIds.add(c.airtableRecordId);
  });
  // From auto-imports that have already been dashboard-added (user acknowledged)
  Object.entries(autoImports).forEach(([rid, info]) => {
    if (info && info.addedToDashboard) knownRecordIds.add(rid);
  });

  // Build set of known course codes (all dashboard courses)
  const knownCodeKeys = new Set();
  Object.keys(builtIn).forEach(k => knownCodeKeys.add(k));
  Object.keys(userCourses).forEach(k => knownCodeKeys.add(k));

  // 3. Classify candidates
  const linkOnly = [];       // code matches, no recordId yet → stamp URL only
  const newAutoImports = []; // no code match → queue for dashboard banner
  const skipped = [];

  for (const c of candidates) {
    if (knownRecordIds.has(c.recordId)) { skipped.push(c); continue; }
    const key = codeToKey(c.code);
    if (key && knownCodeKeys.has(key)) { linkOnly.push({ key, cand: c }); continue; }
    if (autoImports[c.recordId]) { skipped.push(c); continue; } // already queued, awaiting dashboard-side add
    newAutoImports.push(c);
  }

  console.log(`[sync-airtable] already-known: ${skipped.length}  link-only: ${linkOnly.length}  new: ${newAutoImports.length}`);

  // 4. Apply link-only changes to course_airtable_urls (safe — never touches course data)
  const urlMapChanged = linkOnly.length > 0;
  for (const { key, cand } of linkOnly) {
    const url = `https://airtable.com/${AIRTABLE_BASE}/${DEVELOPMENTS_TABLE}/${cand.recordId}`;
    if (!airtableUrlMap[key]) {
      airtableUrlMap[key] = url;
      console.log(`  link  ${key.padEnd(14)} ← ${cand.recordId}  (${cand.code})`);
    }
  }

  // 5. Queue new auto-imports (seen=false triggers dashboard banner)
  const autoImportsChanged = newAutoImports.length > 0;
  const nowIso = new Date().toISOString();
  for (const c of newAutoImports) {
    autoImports[c.recordId] = {
      recordId: c.recordId,
      code: c.code,
      title: c.title,
      instructor: c.instructor,
      email: c.email,
      pct: c.pct,
      session: c.session,
      importedAt: nowIso,
      seen: false,
      addedToDashboard: false
    };
    console.log(`  new   ${c.code.padEnd(10)} ${c.title.slice(0, 50)}`);
  }

  // 6. Write back
  if (DRY) {
    console.log(`[sync-airtable] DRY RUN — no writes. Would update course_airtable_urls: ${urlMapChanged}, airtable_auto_imports: ${autoImportsChanged}`);
  } else {
    if (urlMapChanged) {
      await sbWrite('course_airtable_urls', airtableUrlMap);
      console.log(`[sync-airtable] wrote course_airtable_urls (${Object.keys(airtableUrlMap).length} entries)`);
    }
    if (autoImportsChanged) {
      await sbWrite('airtable_auto_imports', autoImports);
      console.log(`[sync-airtable] wrote airtable_auto_imports (${Object.keys(autoImports).length} entries)`);
    }
    if (!urlMapChanged && !autoImportsChanged) {
      console.log('[sync-airtable] no changes to write');
    }
  }

  console.log(`[sync-airtable] ${new Date().toISOString()} done`);
}

main().catch(err => {
  console.error('[sync-airtable] FATAL:', err.stack || err.message || err);
  process.exit(1);
});
