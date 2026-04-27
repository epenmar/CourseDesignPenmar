#!/usr/bin/env node
// sync-granola.mjs — Pulls meeting notes directly from Granola's public API and
// writes them into dashboard-data.js in the same shape id-dashboard.html already
// renders. Replaces the Obsidian portion of sync-calendar.js.
//
// Usage:
//   node scripts/sync-granola.mjs              # pull + write
//   node scripts/sync-granola.mjs --dry        # pull + print (no write)
//   node scripts/sync-granola.mjs --lookback=90  # days (default 60)
//
// Requires GRANOLA_API_KEY in /Users/epenmar/conductor/.env (the conductor root env).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DATA_FILE = join(REPO_ROOT, 'dashboard-data.js');
const ENV_FILE  = '/Users/epenmar/conductor/.env';

const DRY = process.argv.includes('--dry');
const lookbackArg = (process.argv.find(a => a.startsWith('--lookback=')) || '').split('=')[1];
const LOOKBACK_DAYS = Math.max(1, parseInt(lookbackArg || '60', 10));

// ===== Course maps (copied from sync-calendar.js; single source when we retire Obsidian) =====
const PROJECT_TO_COURSE = {
  'MNS 521': 'mns521', 'MNS521': 'mns521',
  'MNS 522': 'mns522', 'MNS522': 'mns522',
  'BST 501': 'bst501', 'BST501': 'bst501',
  'BST 605': 'bst605', 'BST605': 'bst605',
  'BST 606': 'bst606', 'BST606': 'bst606',
  'BST 609': 'bst609', 'BST609': 'bst609',
  'BST 693': 'bst693', 'BST693': 'bst693',
  'BST 515': 'bst515', 'BST515': 'bst515', 'BMI 515': 'bst515',
  'LSC 598': 'lsc598', 'LSC598': 'lsc598',
  'TPH 501': 'tph501', 'TPH501': 'tph501',
  'TPH 502': 'tph502', 'TPH502': 'tph502',
  'TPH 550': 'tph550', 'TPH550': 'tph550',
  'TPH 552': 'tph552', 'TPH552': 'tph552',
  'TPH 553': 'tph553', 'TPH553': 'tph553',
  'TPH 554': 'tph554', 'TPH554': 'tph554',
  'TPH 555': 'tph555', 'TPH555': 'tph555',
  'TPH 556': 'tph556', 'TPH556': 'tph556',
  'TPH 557': 'tph557', 'TPH557': 'tph557',
  'TPH 580': 'tph580', 'TPH580': 'tph580',
  'TPH 585': 'tph585', 'TPH585': 'tph585',
  'TPH 591': 'tph591', 'TPH591': 'tph591',
  'TPH 593': 'tph593', 'TPH593': 'tph593',
  'ASB 554': 'asb554', 'ASB554': 'asb554',
  'TPH 504': 'tph504', 'TPH504': 'tph504',
  'POP 644': 'pop644', 'POP644': 'pop644',
};
// Course-code regex fallback for titles lacking a project checkbox.
// Keep the prefix list aligned with sync-calendar.js's ACADEMIC_PREFIXES.
const TITLE_CODE_RE = /\b(MNS|BST|BMI|LSC|STP|TPH|POP|ASB|EXW|KIN|NUR)\s*0?(\d{3})\b/i;

// ===== ENV =====
function loadApiKey() {
  if (!existsSync(ENV_FILE)) throw new Error(`Env file not found: ${ENV_FILE}`);
  const raw = readFileSync(ENV_FILE, 'utf8');
  const m = raw.match(/^\s*GRANOLA_API_KEY\s*=\s*"?([^"\s#]+)"?/m);
  if (!m) throw new Error('GRANOLA_API_KEY not set in ' + ENV_FILE);
  return m[1];
}
const API_KEY = loadApiKey();
const API = 'https://public-api.granola.ai/v1';

// ===== HTTP =====
async function gx(path) {
  const r = await fetch(API + path, {
    headers: { Authorization: 'Bearer ' + API_KEY, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

// ===== PARSER =====
// Granola summaries follow a template starting with an "Obsidian Tags" block:
//   Project (check one): [x] MNS 521
//   People (check all present): [x] Dariush Navabi
//   Follow-up Meeting Scheduled For: April 27, 2026 at 1:30 PM - ...
//   Regular AI Notes: ... (rest is the actual content, H3 sections)
// Below Regular AI Notes we look for sections that commonly carry action items
// and decisions. Transcript URL is appended at the bottom of summary_markdown.

function findCheckedItems(block) {
  // Matches "[x] Label", trims trailing bracket-brackets from neighboring lines
  const out = [];
  const re = /\[x\]\s+([^\n\[]+?)(?=\s*\[|$|\n)/gi;
  let m;
  while ((m = re.exec(block))) {
    const label = m[1].trim().replace(/[\s,:;]+$/, '');
    if (label && label.length < 80) out.push(label);
  }
  return out;
}

function splitSections(md) {
  // Return an object of { headingLower: bodyText } for H3 sections.
  const out = {};
  const re = /^###\s+([^\n]+?)\s*\n([\s\S]*?)(?=^###\s|^##\s|\n---\s*\n|$(?![\r\n]))/gm;
  let m;
  while ((m = re.exec(md))) {
    const heading = m[1].trim().toLowerCase();
    out[heading] = m[2].trim();
  }
  return out;
}

function bulletsOf(body) {
  // Flatten list items. A short top-level item (≤3 words, no terminal punctuation)
  // is treated as an "owner" label and its indented children are prefixed with it:
  //   - Darush
  //     - Add point distribution → "Darush: Add point distribution"
  // Any top-level item that looks like a real sentence stands on its own.
  if (!body) return [];
  const out = [];
  let owner = null;
  for (const raw of body.split('\n')) {
    if (!raw.trim()) continue;
    const top = raw.match(/^[-*]\s+(.+)$/);
    const sub = raw.match(/^\s{2,}[-*]\s+(.+)$/);
    if (top) {
      const txt = top[1].trim();
      const words = txt.split(/\s+/).length;
      if (words <= 3 && !/[.!?]$/.test(txt) && !/^\*\*/.test(txt)) {
        owner = txt.replace(/[:\-]\s*$/, '');
      } else {
        owner = null;
        out.push(txt);
      }
    } else if (sub) {
      const txt = sub[1].trim();
      out.push(owner ? `${owner}: ${txt}` : txt);
    }
  }
  return out;
}

function firstSentences(text, n = 4) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  const parts = clean.split(/(?<=[.!?])\s+/);
  // Previously capped at 2 sentences / 320 chars, which frequently yielded
  // a single truncated bullet in the dashboard sidebar. Widen to ~4 sentences
  // and 1200 chars so real meeting summaries survive the sync intact.
  return parts.slice(0, n).join(' ').slice(0, 1200);
}

function parseFollowUp(headerBlock) {
  // Look for "Follow-up Meeting Scheduled For:" block
  const m = headerBlock.match(/Follow-up Meeting Scheduled For\s*:?\s*\n?\s*([^\n]+)/i);
  if (!m) return null;
  const line = m[1].trim();
  if (/^\[.*\]$/.test(line) || !line) return null;
  // Try to parse a date like "April 27, 2026 at 1:30 PM - Module 1 materials review"
  const dateRe = /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?/i;
  const d = line.match(dateRe);
  if (!d) return { label: line };
  const timeM = line.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
  // Infer the year if the source string lacks one. Default to current year;
  // if that puts the date >90d in the past, bump to next year (the note is
  // pointing at a future event). Replaces a hardcoded ', 2026' that would
  // have produced wrong dates after that calendar year.
  let yearTag = '';
  if (!d[0].match(/\b20\d{2}\b/)) {
    let y = new Date().getFullYear();
    const trial = new Date(d[0] + ', ' + y);
    if (!isNaN(trial.getTime()) && (Date.now() - trial.getTime()) / 86400000 > 90) y += 1;
    yearTag = ', ' + y;
  }
  const parsed = new Date(d[0] + yearTag + (timeM ? ' ' + timeM[1] : ''));
  if (isNaN(parsed.getTime())) return { label: line };
  const date = fmtYmd(parsed);
  const labelAfter = line.split(/\s+[-–—]\s+/).slice(1).join(' - ').trim();
  return {
    date,
    time: timeM ? timeM[1] : null,
    label: labelAfter || 'Follow-up meeting',
  };
}

function parseTranscriptUrl(md) {
  // Bottom of summary_markdown: "Chat with meeting transcript: [https://notes.granola.ai/t/<uuid>]"
  const m = md.match(/https:\/\/notes\.granola\.ai\/t\/[a-f0-9-]+/i);
  return m ? m[0] : null;
}

function courseFromProjectsOrTitle(projects, title) {
  for (const p of projects) {
    const id = PROJECT_TO_COURSE[p] || PROJECT_TO_COURSE[p.replace(/\s+/g, '')];
    if (id) return id;
  }
  const m = String(title || '').match(TITLE_CODE_RE);
  if (m) {
    const key = `${m[1].toUpperCase()} ${m[2]}`;
    return PROJECT_TO_COURSE[key] || null;
  }
  return null;
}

function pickSection(sections, names) {
  for (const n of names) {
    const key = Object.keys(sections).find(k => k === n.toLowerCase() || k.startsWith(n.toLowerCase()));
    if (key) return sections[key];
  }
  return '';
}

function parseNote(detail) {
  const md = detail.summary_markdown || detail.summary_text || '';
  if (!md) return null;

  // Split header (before "Regular AI Notes:") from body. Some templates prefix
  // the heading with a hash ("### #Regular AI Notes:"), which we tolerate.
  const headerEnd = md.search(/###\s*#?\s*Regular AI Notes\s*:?/i);
  const header = headerEnd >= 0 ? md.slice(0, headerEnd) : md;
  const body   = headerEnd >= 0 ? md.slice(headerEnd) : md;

  // Extract project + people checkboxes from header
  const projectBlock = (header.match(/Project[^\n]*\n([\s\S]*?)(?=People|$)/i) || [])[1] || '';
  const peopleBlock  = (header.match(/People[^\n]*\n([\s\S]*?)(?=Follow-up|Regular AI|$)/i) || [])[1] || '';
  const projects = findCheckedItems(projectBlock);
  const peopleChecked = findCheckedItems(peopleBlock);

  const sections = splitSections(body);

  const decisions = bulletsOf(pickSection(sections, ['decisions', 'key decisions', 'decisions made']));
  const actionRaw = bulletsOf(pickSection(sections, ['action items', 'next steps', 'follow-up actions', 'follow-ups']));
  // Pull "tid bits to remember about the faculty member" from whichever
  // section best fits — Granola notes name them inconsistently, so try a
  // bunch of aliases.
  const relationshipBuilding = bulletsOf(pickSection(sections, [
    'relationship building', 'relationship', 'rapport', 'personal',
    'context', 'background', 'small talk', 'tidbits', 'about the faculty'
  ]));
  // Tag each action item by who it's for so the dashboard can show only
  // "things Elisa has to do" up top and "what the faculty owes" in the
  // meeting card. Recognized ID-side prefixes: "Elisa:", "Elisa Penmar:",
  // "ID:", or just no prefix (defaults to ID — typical for unattributed
  // bullets that the ID would track on the faculty's behalf).
  const ID_PREFIXES = /^(elisa(?:\s+penmar)?|penmar|id|me|i)\b\s*[:\-]/i;
  const FACULTY_PREFIX = /^([a-z][\w .'-]{0,40}?)\s*[:\-]\s+/i;
  const actionItems = actionRaw.map(t => {
    const done = /\bdone\b/i.test(t) || /^\[x\]/i.test(t);
    const text = t.replace(/^\[[ x]\]\s*/i, '').trim();
    // Strip leading markdown bold/italic so "**Faculty member**: …"
    // classifies on the inner text.
    const naked = text.replace(/^[*_]+/, '').replace(/^[*_]+:/, ':');
    let who = 'id';
    if (ID_PREFIXES.test(naked)) who = 'id';
    else if (/^(faculty|instructor)\b/i.test(naked)) who = 'faculty';
    else if (FACULTY_PREFIX.test(naked)) who = 'faculty';
    return { text, done, who };
  });

  // Summary: first 2 sentences of the highest-signal section. If there's no
  // dedicated Summary/Overview section, fall back to (a) any free text between
  // "Regular AI Notes:" and the first H3, then (b) the first H3's body.
  let summarySource = pickSection(sections, ['executive summary', 'overview', 'summary']);
  if (!summarySource) {
    const firstPara = body.replace(/###\s*Regular AI Notes\s*:?/i, '')
      .split(/\n###\s/)[0]
      .split('\n')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('#') && !/^[-*]\s/.test(s))
      .join(' ');
    summarySource = firstPara;
  }
  if (!summarySource) {
    // Use the first H3 section with real content, converting its bullets into prose.
    // Skip template headings ("regular ai notes", "obsidian tags") and empty sections.
    const skip = /^#?\s*(regular ai notes|obsidian tags)/i;
    const firstKey = Object.keys(sections).find(k => !skip.test(k) && sections[k].trim());
    if (firstKey) {
      // Keep up to 4 bullets so the sidebar shows the real meat of the
      // meeting instead of a single truncated sentence.
      const sentences = bulletsOf(sections[firstKey])
        .slice(0, 4)
        .map(t => t.replace(/\*\*/g, '').replace(/\s+/g, ' '))
        .join('. ');
      summarySource = sentences;
    }
  }
  const summary = firstSentences(summarySource, 4);

  return {
    id: detail.id,
    title: detail.title,
    date: (detail.created_at || '').slice(0, 10),
    updatedAt: detail.updated_at,
    webUrl: detail.web_url || null,
    transcriptUrl: parseTranscriptUrl(md),
    projects,
    people: peopleChecked,
    followUp: parseFollowUp(header),
    summary,
    decisions,
    actionItems,
    relationshipBuilding,
  };
}

// ===== HELPERS =====
function fmtYmd(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function fmtDisplay(ymd) {
  if (!ymd) return '';
  const d = new Date(ymd + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function relativeDays(ymd, now) {
  const d = new Date(ymd + 'T00:00:00');
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 0) return `In ${-diff} days`;
  return `${diff} days ago`;
}

// ===== MAIN =====
async function main() {
  const now = new Date();
  const todayStr = fmtYmd(now);
  const cutoff   = fmtYmd(new Date(now.getTime() - LOOKBACK_DAYS * 86400000));
  console.log(`[granola] lookback ≥ ${cutoff} (${LOOKBACK_DAYS}d)`);

  // 1. Paginate list
  const all = [];
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    const qs = `?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await gx('/notes' + qs);
    for (const n of (res.notes || [])) {
      if ((n.created_at || '').slice(0, 10) < cutoff) { cursor = ''; break; }
      all.push(n);
    }
    if (!res.hasMore || !res.cursor) break;
    // Stop if last note on page is already past cutoff
    const lastDate = (res.notes.at(-1)?.created_at || '').slice(0, 10);
    if (lastDate && lastDate < cutoff) break;
    cursor = res.cursor;
  }
  console.log(`[granola] fetched ${all.length} note summaries`);

  // 2. Fetch details + parse (respect rate limit: 5/sec sustained)
  const courseNotes = {}; // courseId → parsed notes, newest first
  const unmatched = [];
  let fetched = 0;
  for (const stub of all) {
    if (fetched > 0 && fetched % 5 === 0) await new Promise(r => setTimeout(r, 1100));
    let detail;
    try { detail = await gx('/notes/' + stub.id); }
    catch (e) { console.warn(`  skip ${stub.id}: ${e.message.slice(0, 80)}`); continue; }
    fetched++;
    const parsed = parseNote(detail);
    if (!parsed) continue;
    const courseId = courseFromProjectsOrTitle(parsed.projects, parsed.title);
    if (!courseId) {
      unmatched.push({ title: parsed.title, projects: parsed.projects });
      continue;
    }
    parsed.courseId = courseId;
    (courseNotes[courseId] ||= []).push(parsed);
  }
  // Sort each course's notes newest first
  for (const id of Object.keys(courseNotes)) {
    courseNotes[id].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  console.log(`\n[granola] matched ${Object.values(courseNotes).reduce((n, a) => n + a.length, 0)} notes across ${Object.keys(courseNotes).length} courses`);
  for (const [cid, notes] of Object.entries(courseNotes)) {
    console.log(`  ${cid}: ${notes.length}  (latest: ${notes[0].date} — ${notes[0].title.slice(0, 60)})`);
  }
  if (unmatched.length) {
    console.log(`\n[granola] ${unmatched.length} notes had no course match (title + projects):`);
    for (const u of unmatched.slice(0, 20)) console.log(`  - ${u.title.slice(0, 70)} | projects=${JSON.stringify(u.projects)}`);
    if (unmatched.length > 20) console.log(`  ... +${unmatched.length - 20} more`);
  }

  // 3. Load existing dashboard-data.js and merge
  let existing;
  try {
    const raw = readFileSync(DATA_FILE, 'utf8');
    const jsonStr = raw.replace(/^[^{]*/, '').replace(/;\s*$/, '');
    existing = JSON.parse(jsonStr);
  } catch (e) {
    console.error(`[granola] could not parse ${DATA_FILE}: ${e.message}`);
    existing = { syncedAt: null, source: 'granola', courses: {}, upcomingDeadlines: [] };
  }

  for (const [courseId, notes] of Object.entries(courseNotes)) {
    existing.courses[courseId] ||= {};
    const course = existing.courses[courseId];

    // meetings[] (rendered by id-dashboard.html)
    course.meetings = notes.map(n => ({
      date: fmtDisplay(n.date),
      title: n.title,
      people: n.people.length ? n.people : ['Elisa Penmar'],
      summary: n.summary,
      decisions: n.decisions,
      relationshipBuilding: n.relationshipBuilding || [],
      actionItems: n.actionItems,
      granola: n.webUrl,
      transcriptUrl: n.transcriptUrl,
      source: 'Granola',
    }));

    // Aggregate action items, newest first, dedup by text prefix
    const seen = new Set();
    const aggregated = [];
    for (const n of notes) {
      for (const ai of n.actionItems) {
        const key = ai.text.slice(0, 50).toLowerCase();
        if (!seen.has(key)) { seen.add(key); aggregated.push(ai); }
      }
    }
    const pending = aggregated.filter(a => !a.done);
    course.actionItems = {
      total: aggregated.length,
      done: aggregated.length - pending.length,
      pending: pending.map(a => a.text),
    };

    // Last active, short notes blurb
    const latest = notes[0];
    course.lastActiveDate = latest.date;
    course.lastActive = relativeDays(latest.date, now);
    course.notes = {
      author: 'Elisa Penmar',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      text: latest.summary || (pending[0]?.text ?? '').slice(0, 300),
      source: 'granola',
    };

    // Clear stale nextMeeting, prefer parsed follow-up
    if (course.nextMeeting && course.nextMeeting.date && course.nextMeeting.date < todayStr) {
      course.nextMeeting = null;
    }
    if (latest.followUp && latest.followUp.date && latest.followUp.date >= todayStr) {
      if (!course.nextMeeting || course.nextMeeting.date > latest.followUp.date) {
        course.nextMeeting = latest.followUp;
      }
    }
  }

  existing.syncedAt      = now.toISOString();
  existing.notesSyncedAt = now.toISOString();
  existing.source        = existing.source?.replace(/obsidian/i, 'granola') || 'granola';

  const out = [
    '// Auto-generated by sync-granola.mjs (Granola public API)',
    `// Last synced: ${now.toISOString()}`,
    `window.SYNCED_DATA = ${JSON.stringify(existing, null, 2)};`,
    '',
  ].join('\n');

  if (DRY) {
    console.log('\n[granola] DRY RUN — not writing. First 400 chars of output:');
    console.log(out.slice(0, 400) + '\n...');
    return;
  }
  writeFileSync(DATA_FILE, out);
  console.log(`\n[granola] wrote ${DATA_FILE}`);
}

main().catch(e => { console.error('[granola] ERROR:', e.message); process.exit(1); });
