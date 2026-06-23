#!/usr/bin/env node
// Off-database backup of every CourseCompose worksheet (all course data,
// including every Google Drive file link). Runs on a schedule via launchd and
// writes a timestamped JSON snapshot to ~/course-worksheet-backups, keeping the
// most recent 30. Independent of Supabase's own backups, so it survives a
// database-side problem. Uses the service-role key (bypasses RLS) from the
// shared .env — no Supabase CLI / keychain needed, so it works under cron.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ENV_PATH = "/Users/epenmar/conductor/.env";
const env = {};
for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error(`[backup-worksheets] missing SUPABASE_URL / SERVICE_ROLE_KEY in ${ENV_PATH}`);
  process.exit(1);
}

const dir = path.join(os.homedir(), "course-worksheet-backups");
fs.mkdirSync(dir, { recursive: true });

// Page through worksheets (Range header) so the PostgREST ~1000-row cap can
// never silently truncate the backup.
const PAGE = 1000;
let offset = 0;
const rows = [];
for (;;) {
  const res = await fetch(
    `${URL}/rest/v1/worksheets?select=course_id,owner_id,updated_at,data&order=course_id`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Range-Unit": "items", Range: `${offset}-${offset + PAGE - 1}` } },
  );
  if (!res.ok) {
    console.error(`[backup-worksheets] fetch failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const chunk = await res.json();
  rows.push(...chunk);
  if (chunk.length < PAGE) break;
  offset += PAGE;
}

// Count the linked-file references so the log is a quick health signal.
let fileLinks = 0;
for (const r of rows) {
  const d = r.data || {};
  for (const coll of ["courseActivities", "courseMaterials"]) {
    for (const items of Object.values(d[coll] || {})) {
      for (const it of items || []) fileLinks += (it.attachedFiles || []).length;
    }
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = path.join(dir, `all-worksheets_${stamp}.json`);
fs.writeFileSync(out, JSON.stringify({ backed_up_at: new Date().toISOString(), count: rows.length, file_links: fileLinks, rows }));
console.log(`[backup-worksheets] ${new Date().toISOString()} — ${rows.length} worksheets, ${fileLinks} file links → ${out}`);

// Retain the 30 most recent snapshots.
const files = fs.readdirSync(dir).filter((f) => /^all-worksheets_.*\.json$/.test(f)).sort();
for (const f of files.slice(0, Math.max(0, files.length - 30))) {
  try { fs.unlinkSync(path.join(dir, f)); } catch {}
}
