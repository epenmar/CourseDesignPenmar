#!/usr/bin/env node
// sync-calendar.js — Syncs two data sources into dashboard-data.js:
//   1. Outlook calendar (ICS feed) → upcoming meetings per course
//   2. Obsidian vault meeting notes → action items, decisions, summaries
// Runs standalone (no API keys needed) on a 30-min cron schedule.

const https = require('https');
const fs = require('fs');
const path = require('path');

// ===== CONFIG =====
const ICAL_URL = 'https://outlook.office365.com/owa/calendar/cea5ad6a70a64d58a3160c11440affa7@asu.edu/a8fd62a416214be2bae864744a3887eb10780238153772206130/calendar.ics';
const OBSIDIAN_MEETINGS = path.join(
  process.env.HOME,
  'ASU Dropbox/Elisa Penmar/Mac/Documents/Obsidian Vault/Meetings'
);
const DATA_FILE = path.join(__dirname, 'dashboard-data.js');
const LOOKAHEAD_DAYS = 30;
const LOOKBACK_DAYS = 60; // how far back to scan Obsidian notes

// ===== COURSE KEYWORD MAP =====
const COURSE_KEYWORDS = {
  mns521:        ['MNS 521', 'MNS521', 'Dariush'],
  mns522:        ['MNS 522', 'MNS522'],
  bst501:        ['BST 501', 'BST501', 'Chong Lee'],
  bst605:        ['BST 605', 'BST605', 'Habte'],
  bst606:        ['BST 606', 'BST606', 'Yunro'],
  bst609:        ['BST 609', 'BST609'],
  bst693:        ['BST 693', 'BST693'],
  bst515:        ['BST 515', 'BST515', 'BMI 515', 'BMI515'],
  lsc598:        ['LSC 598', 'LSC598', 'Geospatial', 'John Bailey'],
  lsc598stp494:  ['LSC598/STP494', 'STP 494', 'STP494', 'Genomics', 'Fahad'],
  tph501:        ['TPH 501', 'TPH501', 'Josh Anbar'],
  tph502:        ['TPH 502', 'TPH502', 'Jordan Miller'],
  tph550:        ['TPH 550', 'TPH550', 'Loughman', 'Josh Loughman', 'Susan Robinson'],
  tph552:        ['TPH 552', 'TPH552', 'Biana Bogosian'],
  tph553:        ['TPH 553', 'TPH553'],
  tph554:        ['TPH 554', 'TPH554', 'Steffen Eikenberry', 'Terry Cullen'],
  tph555:        ['TPH 555', 'TPH555', 'Rodney Joseph', 'Dave Keating'],
  tph556:        ['TPH 556', 'TPH556'],
  tph557:        ['TPH 557', 'TPH557', 'Rachel Gur-Arie'],
  tph580:        ['TPH 580', 'TPH580', 'Practicum'],
  tph585:        ['TPH 585', 'TPH585', 'Capstone'],
  tph591:        ['TPH 591', 'TPH591', 'Jyoti Pathak'],
  tph593:        ['TPH 593', 'TPH593'],
  asb554:        ['ASB 554', 'ASB554', 'One Health', 'India Schneider'],
};

// Obsidian project names → course IDs
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
};

// ===== iCal PARSER =====
function parseIcal(icsText) {
  const events = [];
  const blocks = icsText.split('BEGIN:VEVENT');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split('END:VEVENT')[0];
    const ev = {};
    const unfolded = block.replace(/\r?\n[ \t]/g, '');
    const lines = unfolded.split(/\r?\n/);
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      let key = line.substring(0, colonIdx);
      const val = line.substring(colonIdx + 1);
      const semiIdx = key.indexOf(';');
      if (semiIdx !== -1) key = key.substring(0, semiIdx);
      switch (key) {
        case 'SUMMARY':     ev.summary = val; break;
        case 'DTSTART':     ev.dtstart = parseIcalDate(val); break;
        case 'DTEND':       ev.dtend = parseIcalDate(val); break;
        case 'DESCRIPTION': ev.description = val.replace(/\\n/g, '\n').replace(/\\,/g, ','); break;
        case 'LOCATION':    ev.location = val; break;
        case 'UID':         ev.uid = val; break;
        case 'STATUS':      ev.status = val; break;
      }
    }
    if (ev.summary && ev.dtstart) events.push(ev);
  }
  return events;
}

function parseIcalDate(str) {
  str = str.trim();
  if (str.length === 8) return new Date(+str.slice(0,4), +str.slice(4,6)-1, +str.slice(6,8));
  const y = +str.slice(0,4), m = +str.slice(4,6)-1, d = +str.slice(6,8);
  const h = +str.slice(9,11), min = +str.slice(11,13), s = +str.slice(13,15);
  if (str.endsWith('Z')) return new Date(Date.UTC(y, m, d, h, min, s));
  return new Date(y, m, d, h, min, s);
}

// ===== OBSIDIAN NOTE PARSER =====
function parseObsidianNote(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const note = { filePath };

  // Parse YAML frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    // Date
    const dateMatch = fm.match(/date:\s*"?(\d{4}-\d{2}-\d{2})"?/);
    if (dateMatch) note.date = dateMatch[1];
    // Projects (wiki-links)
    const projects = [];
    const projMatches = fm.matchAll(/\[\[([^\]]+)\]\]/g);
    for (const m of projMatches) projects.push(m[1]);
    note.projects = projects;
    // People
    const people = [];
    const pplSection = fm.match(/people:\s*\n((?:\s+-\s+.*\n?)*)/);
    if (pplSection) {
      const pplMatches = pplSection[1].matchAll(/\[\[([^\]]+)\]\]/g);
      for (const m of pplMatches) people.push(m[1]);
    }
    note.people = people;
  }

  // Title from first H1 or filename
  const h1Match = content.match(/^#\s+(.+)$/m);
  note.title = h1Match ? h1Match[1].trim() : path.basename(filePath, '.md').replace(/^\d{4}-\d{2}-\d{2}\s+/, '');

  // Action items: - [ ] or - [x]
  note.actionItems = [];
  const actionSection = content.match(/## Action Items\n([\s\S]*?)(?=\n##|\n$|$)/);
  if (actionSection) {
    const itemMatches = actionSection[1].matchAll(/- \[([ xX])\]\s+(.+)/g);
    for (const m of itemMatches) {
      note.actionItems.push({ text: m[2].trim(), done: m[1] !== ' ' });
    }
  }

  // Decisions
  note.decisions = [];
  const decSection = content.match(/## Decisions Made\n([\s\S]*?)(?=\n##|\n$|$)/);
  if (decSection) {
    const decMatches = decSection[1].matchAll(/^-\s+(.+)/gm);
    for (const m of decMatches) note.decisions.push(m[1].trim());
  }

  // Summary from ## Notes section (first paragraph or first few lines)
  const notesSection = content.match(/## Notes\n([\s\S]*?)(?=\n## Action|\n## Decisions|\n## Follow|$)/);
  if (notesSection) {
    // Get first 3 substantive lines
    const lines = notesSection[1].split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#') && !l.startsWith('- **Project') && !l.startsWith('- **Source') && !l.startsWith('- **Transcript'));
    note.summaryLines = lines.slice(0, 8);
  }

  // Follow-ups / next meeting
  note.nextMeeting = null;
  const followSection = content.match(/## Follow-ups\n([\s\S]*?)(?=\n##|\n$|$)/);
  if (followSection) {
    // Look for date patterns like "April 17, 2:00 PM" or "Apr 6 meeting"
    const datePattern = /(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,?\s+\d{4})?\s*(?:at\s+)?(?:\d{1,2}:\d{2}\s*[AP]M)?/gi;
    const followText = followSection[1];
    const dateMatches = followText.match(datePattern);
    if (dateMatches && dateMatches.length > 0) {
      note.nextMeetingText = dateMatches[0];
      // Try to parse
      const parsed = new Date(dateMatches[0] + (dateMatches[0].includes('202') ? '' : ', 2026'));
      if (!isNaN(parsed.getTime())) {
        const timeMatch = dateMatches[0].match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
        note.nextMeeting = {
          date: formatDateStr(parsed),
          time: timeMatch ? timeMatch[1] : null,
          label: followText.split('\n').find(l => l.includes(dateMatches[0]))?.replace(/^-\s*\[?[x ]?\]?\s*/, '').trim() || 'Follow-up meeting'
        };
      }
    }
  }

  // Also check Context section for next meeting
  if (!note.nextMeeting) {
    const ctxMatch = content.match(/\*\*Next meeting\*\*:\s*(.+)/i);
    if (ctxMatch) {
      const datePattern = /(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,?\s+\d{4})?/i;
      const dm = ctxMatch[1].match(datePattern);
      if (dm) {
        const parsed = new Date(dm[0] + (dm[0].includes('202') ? '' : ', 2026'));
        if (!isNaN(parsed.getTime())) {
          const timeMatch = ctxMatch[1].match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
          note.nextMeeting = {
            date: formatDateStr(parsed),
            time: timeMatch ? timeMatch[1] : null,
            label: ctxMatch[1].replace(/—\s*/, '').trim()
          };
        }
      }
    }
  }

  return note;
}

function matchNoteToCourses(note) {
  const courses = new Set();

  // Match via Obsidian project links (most reliable)
  for (const proj of note.projects || []) {
    const courseId = PROJECT_TO_COURSE[proj];
    if (courseId) courses.add(courseId);
  }

  // Also match via title + filename keywords
  const text = (note.title || '').toLowerCase() + ' ' + path.basename(note.filePath).toLowerCase();
  for (const [courseId, keywords] of Object.entries(COURSE_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) { courses.add(courseId); break; }
    }
  }

  return [...courses];
}

// ===== CALENDAR MATCHING =====
function matchEventToCourses(event) {
  const text = (event.summary || '').toLowerCase() + ' ' + (event.description || '').toLowerCase();
  const matches = [];
  for (const [courseId, keywords] of Object.entries(COURSE_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) { matches.push(courseId); break; }
    }
  }
  return matches;
}

// ===== HELPERS =====
function formatTime(date) {
  let h = date.getHours();
  const min = date.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return min === 0 ? `${h}:00 ${ampm}` : `${h}:${String(min).padStart(2,'0')} ${ampm}`;
}

function formatDateStr(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth()+1).padStart(2,'0') + '-' +
    String(date.getDate()).padStart(2,'0');
}

function formatDisplayDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function relativeDays(dateStr, now) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 0) return `In ${-diff} days`;
  return `${diff} days ago`;
}

function findCourseIdByTitle(courseStr) {
  if (!courseStr) return null;
  const lower = courseStr.toLowerCase();
  for (const [courseId, keywords] of Object.entries(COURSE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) return courseId;
    }
  }
  return null;
}

// ===== FETCH iCal =====
function fetchIcal(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'sync-calendar/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchIcal(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// ===== MAIN =====
async function main() {
  const now = new Date();
  const todayStr = formatDateStr(now);
  const cutoff = new Date(now.getTime() + LOOKAHEAD_DAYS * 86400000);
  const lookbackDate = new Date(now.getTime() - LOOKBACK_DAYS * 86400000);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  console.log(`[sync] ${now.toISOString()} — starting sync`);

  // ===== 1. OUTLOOK CALENDAR =====
  console.log(`[sync] Fetching Outlook calendar...`);
  let courseCalendar = {};
  try {
    const icsText = await fetchIcal(ICAL_URL);
    const allEvents = parseIcal(icsText);
    console.log(`[sync] Parsed ${allEvents.length} calendar events`);

    const upcoming = allEvents.filter(ev => ev.dtstart >= todayStart && ev.dtstart <= cutoff);
    console.log(`[sync] ${upcoming.length} upcoming in next ${LOOKAHEAD_DAYS} days`);

    for (const ev of upcoming) {
      const courses = matchEventToCourses(ev);
      for (const courseId of courses) {
        if (!courseCalendar[courseId]) courseCalendar[courseId] = [];
        courseCalendar[courseId].push({
          date: formatDateStr(ev.dtstart),
          time: formatTime(ev.dtstart),
          label: ev.summary,
          uid: ev.uid
        });
      }
    }
    for (const courseId of Object.keys(courseCalendar)) {
      courseCalendar[courseId].sort((a, b) => a.date.localeCompare(b.date));
    }
    for (const [courseId, meetings] of Object.entries(courseCalendar)) {
      console.log(`[sync] Calendar: ${courseId} → ${meetings.length} meeting(s)`);
      for (const m of meetings) console.log(`  → ${m.date} ${m.time} — ${m.label}`);
    }
  } catch (e) {
    console.error(`[sync] Calendar fetch failed: ${e.message} — continuing with notes only`);
  }

  // ===== 2. OBSIDIAN MEETING NOTES =====
  console.log(`[sync] Scanning Obsidian vault...`);
  const courseNotes = {}; // courseId → [parsed notes], sorted by date desc
  try {
    const files = fs.readdirSync(OBSIDIAN_MEETINGS)
      .filter(f => f.endsWith('.md') && /^\d{4}-\d{2}-\d{2}/.test(f))
      .sort()
      .reverse(); // newest first

    let scanned = 0;
    for (const file of files) {
      // Extract date from filename
      const fileDate = file.slice(0, 10);
      if (fileDate < formatDateStr(lookbackDate)) break; // stop at lookback limit

      const note = parseObsidianNote(path.join(OBSIDIAN_MEETINGS, file));
      const courses = matchNoteToCourses(note);

      for (const courseId of courses) {
        if (!courseNotes[courseId]) courseNotes[courseId] = [];
        courseNotes[courseId].push(note);
      }
      scanned++;
    }
    console.log(`[sync] Scanned ${scanned} meeting notes`);
    for (const [courseId, notes] of Object.entries(courseNotes)) {
      console.log(`[sync] Notes: ${courseId} → ${notes.length} meeting(s)`);
    }
  } catch (e) {
    console.error(`[sync] Obsidian scan failed: ${e.message} — continuing with calendar only`);
  }

  // ===== 3. READ EXISTING DATA =====
  let existing;
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const jsonStr = raw.replace(/^[^{]*/, '').replace(/;\s*$/, '');
    existing = JSON.parse(jsonStr);
  } catch (e) {
    console.error(`[sync] Could not parse ${DATA_FILE}: ${e.message}`);
    existing = { syncedAt: null, source: 'granola', courses: {}, upcomingDeadlines: [] };
  }

  // ===== 4. MERGE INTO COURSES =====
  const allCourseIds = new Set([...Object.keys(courseCalendar), ...Object.keys(courseNotes)]);

  for (const courseId of allCourseIds) {
    if (!existing.courses[courseId]) continue; // only update known courses
    const course = existing.courses[courseId];
    const calMeetings = courseCalendar[courseId] || [];
    const notes = courseNotes[courseId] || [];

    // --- Calendar meetings ---
    if (calMeetings.length > 0) {
      course.calendarMeetings = calMeetings;
      const nextCal = calMeetings[0];
      const existingDate = course.nextMeeting && course.nextMeeting.date;
      if (!existingDate || nextCal.date <= existingDate) {
        course.nextMeeting = { date: nextCal.date, time: nextCal.time, label: nextCal.label };
      }
    }

    // --- Obsidian notes → meetings array ---
    if (notes.length > 0) {
      // Build meetings array from Obsidian notes
      course.meetings = notes.map(n => ({
        date: formatDisplayDate(n.date),
        title: n.title,
        people: n.people || ['Elisa Penmar'],
        summary: (n.summaryLines || []).join(' ').slice(0, 500),
        decisions: n.decisions || [],
        actionItems: n.actionItems.map(ai => ({ text: ai.text, done: ai.done })),
        source: 'Obsidian'
      }));

      // Aggregate action items across all notes
      const allItems = [];
      const seen = new Set();
      for (const n of notes) {
        for (const ai of n.actionItems) {
          // Dedupe by first 50 chars of text
          const key = ai.text.slice(0, 50).toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            allItems.push(ai);
          }
        }
      }
      const done = allItems.filter(a => a.done);
      const pending = allItems.filter(a => !a.done);
      course.actionItems = {
        total: allItems.length,
        done: done.length,
        pending: pending.map(a => a.text)
      };

      // Last active date
      course.lastActiveDate = notes[0].date;
      course.lastActive = relativeDays(notes[0].date, now);

      // Notes summary
      const latestNote = notes[0];
      const pendingStr = pending.length > 0
        ? `Pending: ${pending.slice(0, 3).map(a => a.text.split(':').pop().trim().slice(0, 60)).join('; ')}.`
        : 'No pending items.';
      const decisionsStr = latestNote.decisions.length > 0
        ? ` Recent decisions: ${latestNote.decisions.slice(0, 2).join('; ')}.`
        : '';
      course.notes = {
        author: 'Elisa Penmar',
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        text: (pendingStr + decisionsStr).slice(0, 500),
        source: 'obsidian'
      };

      // Next meeting from notes (if not already set by calendar)
      if (!course.nextMeeting && latestNote.nextMeeting) {
        course.nextMeeting = latestNote.nextMeeting;
      }
    }
  }

  // ===== 5. UPDATE DEADLINES WITH MEETING INFO =====
  for (const dl of existing.upcomingDeadlines || []) {
    const courseId = findCourseIdByTitle(dl.course);
    if (!courseId) continue;

    const calMeetings = courseCalendar[courseId] || [];
    const dlDate = new Date(dl.date + 'T00:00:00').getTime();
    const range = 2 * 86400000;

    dl.hasMeeting = false;
    for (const calMeeting of calMeetings) {
      const calDate = new Date(calMeeting.date + 'T00:00:00').getTime();
      if (Math.abs(calDate - dlDate) <= range) {
        dl.hasMeeting = true;
        dl.meetingTime = calMeeting.time;
        dl.meetingLabel = calMeeting.label;
        break;
      }
    }
  }

  // ===== 6. WRITE =====
  existing.syncedAt = now.toISOString();
  existing.calendarSyncedAt = now.toISOString();
  existing.notesSyncedAt = now.toISOString();
  existing.source = 'outlook+obsidian';

  const js = [
    '// Auto-generated by sync-calendar.js from Outlook + Obsidian',
    `// Last synced: ${now.toISOString()}`,
    `window.SYNCED_DATA = ${JSON.stringify(existing, null, 2)};`,
    ''
  ].join('\n');

  fs.writeFileSync(DATA_FILE, js);
  console.log(`[sync] Wrote ${DATA_FILE}`);
  console.log(`[sync] Done.`);
}

main().catch(err => {
  console.error(`[sync] Error: ${err.message}`);
  process.exit(1);
});
