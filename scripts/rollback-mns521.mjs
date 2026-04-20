// Rollback the MNS 521 worksheet in Supabase to a backup snapshot.
// Usage: node scripts/rollback-mns521.mjs <backup-file.json>
// Backup files live in scripts/backups/ and contain the raw REST response:
//   [{ "data": { ...worksheet... } }]

import { readFileSync } from 'node:fs';

const SUPABASE_URL = 'https://gflnymqjraxonbdtbxma.supabase.co';
const KEY = 'sb_publishable_di7j_DR1Ie3GJdOtHb8NlQ_rI5eiP4Y';
const COURSE_ID = 'mns521';

const backupPath = process.argv[2];
if (!backupPath) {
  console.error('Usage: node scripts/rollback-mns521.mjs <backup-file.json>');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(backupPath, 'utf8'));
const data = Array.isArray(raw) ? raw[0].data : (raw.data || raw);
if (!data || typeof data !== 'object') {
  console.error('Backup file does not contain a valid worksheet payload.');
  process.exit(1);
}

const actCount = Object.values(data.courseActivities || {}).reduce((a,l)=>a+l.length,0);
const matCount = Object.values(data.courseMaterials || {}).reduce((a,l)=>a+l.length,0);
console.log(`Restoring from ${backupPath}`);
console.log(`  activities: ${actCount}, materials: ${matCount}`);

const r = await fetch(`${SUPABASE_URL}/rest/v1/worksheets?course_id=eq.${COURSE_ID}`, {
  method: 'PATCH',
  headers: {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  },
  body: JSON.stringify({ data }),
});
if (!r.ok) {
  console.error('Rollback failed:', r.status, await r.text());
  process.exit(1);
}
console.log('Rollback complete.');
