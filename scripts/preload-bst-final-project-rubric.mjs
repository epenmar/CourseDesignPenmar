// Preload the shared Biostatistics MS "Final Project" rubric + program-assessment
// tags into the BST courses on Becky Scott's list (BST 602/604/605/609).
//
//   - Existing Final Project assignment  → set its Rubric (only if empty) + tags.
//   - No Final Project                   → create a blank Final Project assignment
//                                          (last module) carrying the rubric + tags.
//   - Course has no worksheet yet        → skipped (it's "incoming"); re-run later.
//   - Idempotent: re-running makes no change once a course is already loaded.
//
// Safety: writes a JSON backup of each course's blob to /tmp before any PATCH,
// bumps __modifiedAt.courseActivities so the change wins the cloud merge, and
// NEVER overwrites a different non-empty rubric (warns instead).
//
// Usage:  node scripts/preload-bst-final-project-rubric.mjs --dry   (preview)
//         node scripts/preload-bst-final-project-rubric.mjs         (write)

import { readFileSync, writeFileSync } from 'node:fs';

const SUPABASE_URL = 'https://gflnymqjraxonbdtbxma.supabase.co';
const ENV_FILE = '/Users/epenmar/conductor/.env';

function serviceKey() {
  const txt = readFileSync(ENV_FILE, 'utf8');
  const m = txt.match(/^\s*SUPABASE_SERVICE_ROLE_KEY\s*=\s*(.+)\s*$/m);
  if (!m) throw new Error('SUPABASE_SERVICE_ROLE_KEY not found in ' + ENV_FILE);
  return m[1].trim().replace(/^["']|["']$/g, '');
}
const KEY = serviceKey();

const TAG = (lo, m) => `#NH_GR-NHBSTMS.LO${lo}.M${m}_2261#`;
// Becky Scott's mapping (tags go at the top of the Final Project description).
const BST = {
  bst602: [TAG(1, 1), TAG(3, 1), TAG(3, 2)],
  bst604: [TAG(2, 1)],
  bst605: [TAG(2, 2)],
  bst609: [TAG(1, 2)],
};

// Canonical Final Project rubric in Compose's pipe format: best→worst columns +
// a clean trailing Points column (so it maps correctly on the currently deployed
// Curate), with each band's point range embedded in the cell (so once the
// per-cell-points fix lands, ratings get band-faithful ceilings). Total = 100.
const row = (name, pts, dist, prof, basic, unsat, [dh, ph, bh, uh]) =>
  `${name} | ${dist} (${dh} pts) | ${prof} (${ph} pts) | ${basic} (${bh} pts) | ${unsat} (${uh} pts) | ${pts}`;
const RUBRIC = [
  'Criteria | Distinguished | Proficient | Basic | Unsatisfactory | Points',
  row('Theory and Methods', 40,
    'Fully and eloquently articulates biostatistical concepts and methods. Develops connections among biostatistical concepts and provides full explanations for why procedures are valid, appropriate, and aligned to the research question or problem.',
    'Clearly articulates biostatistical concepts and explains biostatistical procedures without difficulty. Provides partial to strong explanations for why procedures are valid or appropriate.',
    'Explains biostatistical concepts and procedures without major difficulty, but expresses ideas in a rudimentary or incomplete form. Provides limited explanation for why procedures are valid or appropriate.',
    'Displays errors in knowledge of biostatistical concepts and has difficulty explaining biostatistical procedures. Demonstrates limited understanding of why selected methods are appropriate.',
    ['37-40', '29-36', '20-28', '0-19']),
  row('Analysis and Software', 20,
    'Uses analysis and software tools accurately, effectively, and appropriately. Representations are clear and appropriate, with strong explanations of significant elements. Clearly explains connections among software output, statistical representations, methods, results, and conclusions.',
    'Uses appropriate analysis and software tools accurately. Representations are clear and appropriate, with explanations of significant elements. Interprets software output and mentions connections among statistical representations, analysis decisions, and findings.',
    'Uses appropriate analysis and software tools with some accuracy. Representations such as equations, diagrams, graphs, tables, or software output are generally clear and appropriate, but limited connections are made between the analysis, output, and conclusions.',
    'Analysis is inaccurate, incomplete, or not clearly connected to the project purpose. Software use, output, graphs, tables, or other representations are inappropriate, unclear, or not explained.',
    ['19-20', '15-18', '10-14', '0-9']),
  row('Oral Presentation', 20,
    'The presentation has a clearly defined structure with elegant transitions and an effective introduction and conclusion. Speaker communicates clearly, effectively, and in a sophisticated manner.',
    'The presentation has a clearly defined structure with some clear transitions and a logical introduction and conclusion. Speaker communicates clearly and effectively.',
    'The presentation has a recognizable structure with an introduction and conclusion. Speaker generally speaks clearly with few or no major grammatical errors.',
    'The presentation has no clearly defined structure, or the structure is chaotic. Speaker does not speak clearly or demonstrates consistent grammatical errors.',
    ['19-20', '15-18', '10-14', '0-9']),
  row('Written Report and Communication', 20,
    'Communicates clearly, effectively, and professionally. Writing is well-organized, legible, and grammatically correct. Uses sophisticated biostatistical terminology and presents results, interpretations, and conclusions in a polished, coherent manner.',
    'Writing is legible, well-organized, and clear. Uses appropriate biostatistical terminology. Communicates results, interpretations, and conclusions effectively.',
    'Writing is legible and grammatically correct. Uses biostatistical terminology adequately, though minor flaws may be present. Report includes basic results and interpretations but may lack organization or depth.',
    'Writing is illegible, unclear, or not adequately used to record information. Consistently inappropriate use of biostatistical terminology. Results, interpretations, or conclusions are difficult to understand.',
    ['19-20', '15-18', '10-14', '0-9']),
].join('\n');

const FP_RE = /final\s*project/i;
const eqArr = (a, b) => { a = a || []; b = b || []; return a.length === b.length && a.every((x, i) => x === b[i]); };

async function getData(courseId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/worksheets?course_id=eq.${courseId}&select=data`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!r.ok) throw new Error(`GET ${courseId}: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return rows.length ? rows[0].data : null;
}
async function putData(courseId, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/worksheets?course_id=eq.${courseId}`, {
    method: 'PATCH',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ data }),
  });
  if (!r.ok) throw new Error(`PATCH ${courseId}: ${r.status} ${await r.text()}`);
}

function apply(courseId, data) {
  const tags = BST[courseId];
  data.courseActivities = data.courseActivities || {};
  let fp = null, fpMod = null;
  for (const [mod, list] of Object.entries(data.courseActivities)) {
    if (!Array.isArray(list)) continue;
    const hit = list.find((a) => a && FP_RE.test(String(a.name || '')));
    if (hit) { fp = hit; fpMod = mod; break; }
  }
  let changed = false;
  const notes = [];
  if (fp) {
    fp.contentType = fp.contentType || 'assignment';
    fp.templateData = fp.templateData || {};
    fp.templateData.assignment = fp.templateData.assignment || {};
    const cur = String(fp.templateData.assignment.Rubric || '').trim();
    if (!cur) { fp.templateData.assignment.Rubric = RUBRIC; changed = true; notes.push('set rubric'); }
    else if (cur !== RUBRIC) { notes.push('LEFT existing non-empty rubric intact (not overwritten)'); }
    else { notes.push('rubric already current'); }
    if (!eqArr(fp.assessmentTags, tags)) { fp.assessmentTags = tags.slice(); changed = true; notes.push('set tags'); }
    return { changed, action: `existing "${fp.name}" (mod ${fpMod}): ${notes.join('; ')}` };
  }
  // create a blank Final Project in the last numbered module
  const modKeys = Object.keys(data.courseActivities).filter((k) => /^\d+$/.test(k)).map(Number);
  const lastMod = modKeys.length ? String(Math.max(...modKeys)) : '1';
  let maxAct = 0;
  Object.values(data.courseActivities).forEach((list) => Array.isArray(list) && list.forEach((a) => {
    const n = parseInt(String(a.id || '').replace('act-', ''), 10);
    if (!isNaN(n) && n > maxAct) maxAct = n;
  }));
  const act = {
    id: 'act-' + (maxAct + 1),
    name: 'Final Project',
    category: 'Final Project',
    contentType: 'assignment',
    points: '100',
    due: '',
    objectives: [],
    links: [],
    richText: '',
    assessmentTags: tags.slice(),
    templateData: { assignment: {
      Overview: '<p>Program-assessment Final Project. Complete the project and submit per the instructions; you will be graded with the rubric below.</p>',
      Rubric: RUBRIC,
    } },
  };
  (data.courseActivities[lastMod] = data.courseActivities[lastMod] || []).push(act);
  return { changed: true, action: `created blank Final Project (mod ${lastMod}, ${act.id}) with rubric + tags` };
}

const DRY = process.argv.includes('--dry');
(async () => {
  console.log(DRY ? '=== DRY RUN (no writes) ===' : '=== WRITING ===');
  for (const courseId of Object.keys(BST)) {
    let data;
    try { data = await getData(courseId); } catch (e) { console.log(`${courseId}: ERROR ${e.message}`); continue; }
    if (!data) { console.log(`${courseId}: no worksheet yet (incoming) — skipped`); continue; }
    if (!DRY) writeFileSync(`/tmp/bst-preload-backup-${courseId}.json`, JSON.stringify({ course_id: courseId, data }, null, 2));
    const { changed, action } = apply(courseId, data);
    console.log(`${courseId}: ${action}`);
    if (!changed) continue;
    data.__modifiedAt = data.__modifiedAt || {};
    data.__modifiedAt.courseActivities = Date.now();
    if (DRY) { console.log('  → (dry; not saved)'); continue; }
    await putData(courseId, data);
    console.log(`  → saved (backup: /tmp/bst-preload-backup-${courseId}.json)`);
  }
  console.log('Done.');
})();
