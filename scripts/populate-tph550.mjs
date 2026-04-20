// Populate TPH 550 worksheet: finish MLOs (Modules 6-7) and add activities for all modules.
// Usage: node scripts/populate-tph550.mjs [--dry]
// Backs up current data before pushing.

import { mkdirSync, writeFileSync } from 'node:fs';

const SUPABASE_URL = 'https://gflnymqjraxonbdtbxma.supabase.co';
const KEY = 'sb_publishable_di7j_DR1Ie3GJdOtHb8NlQ_rI5eiP4Y';
const COURSE_ID = 'tph550';
const DRY = process.argv.includes('--dry');

// --- Topic + MLO updates for Modules 6 and 7 (Modules 1-5 already populated) ---
const moduleUpdates = {
  '6': {
    topic: 'Introduction to Machine Learning in Public Health',
    mlos: [
      'Identify key concepts in machine learning for public health.',
      'Apply machine learning concepts to public health scenarios.',
      'Discuss the role of machine learning in public health practice.',
      'Extend machine learning applications to public health data.',
      'Evaluate machine learning model performance.',
      'Discuss ethical considerations in machine learning for public health.',
    ],
  },
  '7': {
    topic: 'Public Health Data Analysis, Evaluation, and Communication',
    mlos: [
      'Apply model evaluation techniques to public health data.',
      'Interpret model performance metrics for public health audiences.',
      'Discuss strategies for improving model performance.',
      'Communicate data science results effectively to diverse audiences.',
      'Apply visualization and narrative techniques for public health reporting.',
      'Discuss ethical considerations in communicating public health data.',
      'Reflect on course learning and apply concepts to public health practice.',
      'Synthesize data science skills for public health decision-making.',
      'Submit final assignment demonstrating integrated learning.',
    ],
  },
};

// --- Activities to add per module, mapped to NEW MLO IDs (module.index, 1-based) ---
// Source: "ORIGINAL Activity/Assignment Overview" remapped to the new 7-module structure.
// Module 5 intentionally omits the orig-Mod-3 duplicates (already covered in Module 2).
const activitiesToAdd = {
  '1': [
    { name: 'Practical Application 1', points: '20', objectives: ['1.1','1.2','1.3'] },
    { name: 'Practical Application 2', points: '20', objectives: ['1.4','1.6'] },
    { name: 'Class Discussion',        points: '5',  objectives: ['1.5'] },
  ],
  '2': [
    { name: 'Module 2 Quiz: Data Storage and Management', points: '', objectives: ['2.1'] },
    { name: 'Class Discussion',          points: '5',  objectives: ['2.2'] },
    { name: 'Practical Application 3',   points: '20', objectives: ['2.3'] },
    { name: 'Module 4 Quiz: Data Science Fundamentals and Privacy', points: '', objectives: ['2.4'] },
    { name: 'Class Discussion',          points: '5',  objectives: ['2.4'] },
    { name: 'Case Study Assignment',     points: '',   objectives: ['2.4'] },
  ],
  '3': [
    { name: 'Quiz',                      points: '',   objectives: ['3.1'] },
    { name: 'Class Discussion',          points: '5',  objectives: ['3.2'] },
    { name: 'Practical Application',     points: '',   objectives: ['3.3'] },
    { name: 'Practical Application 4',   points: '20', objectives: ['3.4','3.5','3.6','3.7'] },
    { name: 'Class Discussion',          points: '5',  objectives: ['3.4','3.5'] },
  ],
  '4': [
    { name: 'Quiz',                      points: '',   objectives: ['4.1'] },
    { name: 'Data Visualization Critic', points: '5',  objectives: ['4.2'] },
    { name: 'Practical Application 5',   points: '20', objectives: ['4.2','4.3'] },
    { name: 'Class Discussion',          points: '5',  objectives: ['4.4'] },
    { name: 'Uncovering Disease Patterns Through Maps and Survivor Stories', points: '', objectives: ['4.5','4.6'] },
    { name: 'Module 8 Quiz: Types of Analysis and Visualizations', points: '', objectives: ['4.4','4.5'] },
  ],
  '5': [
    { name: 'Class Discussion',          points: '5',  objectives: ['5.4','5.5'] },
    { name: 'Practical Application 6',   points: '20', objectives: ['5.5','5.6'] },
    { name: 'Class Discussion',          points: '5',  objectives: ['5.7'] },
    { name: 'Assignment',                points: '',   objectives: ['5.8','5.9'] },
  ],
  '6': [
    { name: 'Class Discussion',          points: '',   objectives: ['6.1','6.2'] },
    { name: 'Practical Application 7',   points: '20', objectives: ['6.2','6.3'] },
    { name: 'Class Discussion',          points: '5',  objectives: ['6.4','6.5','6.6'] },
  ],
  '7': [
    { name: 'Class Discussion',          points: '5',  objectives: ['7.1','7.2'] },
    { name: 'Practical Application 8',   points: '20', objectives: ['7.2','7.3'] },
    { name: 'Class Discussion',          points: '5',  objectives: ['7.4','7.5','7.6'] },
    { name: 'Final Assignment Submission', points: '100', objectives: ['7.7','7.8','7.9'] },
  ],
};

function normalize(s) { return (s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

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
const backupPath = `scripts/backups/tph550-${stamp}.json`;
writeFileSync(backupPath, JSON.stringify([{ data }], null, 2));
console.log(`Backup: ${backupPath}`);

data.moduleOverviewData = data.moduleOverviewData || {};
data.courseActivities = data.courseActivities || {};

// Apply MLO/topic updates (only writes Module 6/7; skips if module already has MLOs)
for (const [mod, u] of Object.entries(moduleUpdates)) {
  const existing = data.moduleOverviewData[mod] || { topic: '', mlos: [] };
  if ((existing.mlos || []).length > 0) {
    console.log(`Module ${mod}: already has ${existing.mlos.length} MLOs — skipping.`);
    continue;
  }
  data.moduleOverviewData[mod] = { topic: u.topic, mlos: u.mlos };
  console.log(`Module ${mod}: set topic "${u.topic}" + ${u.mlos.length} MLOs.`);
}

// Find max existing activity id
let maxAct = 0;
Object.values(data.courseActivities).forEach(list => (list || []).forEach(a => {
  const n = parseInt(String(a.id || '').replace('act-', ''), 10);
  if (!isNaN(n) && n > maxAct) maxAct = n;
}));

// Append activities (dedup on module + normalized name + objectives list)
let added = 0, skipped = 0;
for (const [mod, list] of Object.entries(activitiesToAdd)) {
  data.courseActivities[mod] = data.courseActivities[mod] || [];
  const existing = data.courseActivities[mod];
  for (const a of list) {
    const key = normalize(a.name) + '|' + (a.objectives || []).slice().sort().join(',');
    const dup = existing.some(e =>
      normalize(e.name) + '|' + (e.objectives || []).slice().sort().join(',') === key
    );
    if (dup) { skipped++; continue; }
    existing.push({
      id: `act-${++maxAct}`,
      name: a.name,
      points: a.points ?? '',
      due: '',
      objectives: a.objectives || [],
      links: [],
      richText: '',
      contentType: 'blank',
    });
    added++;
  }
}

console.log(`\nActivities: +${added} added, ${skipped} skipped (dedup).`);
const totalActs = Object.values(data.courseActivities).reduce((n, l) => n + l.length, 0);
console.log(`Total activities now: ${totalActs}`);

if (DRY) {
  console.log('\nDRY RUN — no push.');
  for (const [mod, list] of Object.entries(data.courseActivities)) {
    console.log(`  Module ${mod}: ${list.length} activities`);
    list.forEach(a => console.log(`    - ${a.name} [${(a.objectives||[]).join(',')}] ${a.points||''}pt`));
  }
  process.exit(0);
}

await push(data);
console.log('\nTPH 550 update pushed.');
