// Seed eloMloAlignment for MNS 521 worksheet in Supabase.
// Usage: node scripts/align-mns521-elos.mjs [--dry]
// A backup of the current data blob is written to scripts/backups/ first.

import { mkdirSync, writeFileSync } from 'node:fs';

const SUPABASE_URL = 'https://gflnymqjraxonbdtbxma.supabase.co';
const KEY = 'sb_publishable_di7j_DR1Ie3GJdOtHb8NlQ_rI5eiP4Y';
const COURSE_ID = 'mns521';
const DRY = process.argv.includes('--dry');

// ELO index (0-based) -> list of MLO IDs ("<moduleNum>.<mloIndex1-based>")
const alignment = {
  // ELO 1: Differentiate deterministic vs probabilistic AI; explain uncertainty
  "0": ["1.1","1.5","2.4","2.5","2.6","4.3"],
  // ELO 2: Formulate real-world problems as search/CSP/logic
  "1": ["1.2","1.3","1.4","2.1","2.2","2.3","2.4"],
  // ELO 3: Describe core ML approaches
  "2": ["3.1","3.2","3.3","3.4","3.5","3.6","7.3"],
  // ELO 4: Analyze/design architectures for perception, NLP, robotics
  "3": ["4.1","4.2","4.4","4.5","6.1","6.3","6.4","7.1","7.2","7.4"],
  // ELO 5: Evaluate fairness/ethics/societal impacts
  "4": ["3.6","4.5","5.1","5.2","5.3","5.4","5.5","5.6","7.3","7.5"],
  // ELO 6: Communicate AI designs to technical and non-technical audiences
  "5": ["6.2","6.3","6.4","6.5","7.2","7.4","7.6"],
};

async function fetchWorksheet() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/worksheets?course_id=eq.${COURSE_ID}&select=*`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
  );
  if (!r.ok) throw new Error('GET failed: ' + r.status + ' ' + await r.text());
  const rows = await r.json();
  if (!rows.length) throw new Error('worksheet not found for ' + COURSE_ID);
  return rows[0];
}

async function push(data) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/worksheets?course_id=eq.${COURSE_ID}`,
    {
      method: 'PATCH',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ data }),
    }
  );
  if (!r.ok) throw new Error('PATCH failed: ' + r.status + ' ' + await r.text());
}

const ws = await fetchWorksheet();
const data = ws.data || {};

mkdirSync('scripts/backups', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupPath = `scripts/backups/mns521-align-${stamp}.json`;
writeFileSync(backupPath, JSON.stringify([{ data }], null, 2));
console.log(`Backup: ${backupPath}`);

const before = data.eloMloAlignment || {};
const beforeCount = Object.values(before).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
const afterCount = Object.values(alignment).reduce((n, l) => n + l.length, 0);
console.log(`eloMloAlignment: ${Object.keys(before).length} ELO keys / ${beforeCount} mappings` +
            ` -> ${Object.keys(alignment).length} ELO keys / ${afterCount} mappings`);

data.eloMloAlignment = alignment;

if (DRY) {
  console.log('DRY RUN — no push. New alignment:');
  console.log(JSON.stringify(alignment, null, 2));
  process.exit(0);
}

await push(data);
console.log('Alignment updated.');
