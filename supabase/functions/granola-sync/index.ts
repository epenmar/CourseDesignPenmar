// granola-sync — Supabase Edge Function
//
// Server-side mirror of scripts/sync-granola.mjs. Fetches recent meeting notes
// from Granola's public API, parses them, matches each to a course, and upserts
// into the public.meetings table. Triggered manually from the dashboard's
// "Sync from Granola" button.
//
// Secrets required (set once via `supabase secrets set …`):
//   GRANOLA_API_KEY               — Granola personal access token
//   SUPABASE_SERVICE_ROLE_KEY     — service_role / new sb_secret_ key for upserts
//   SUPABASE_URL                  — auto-injected; only set if overriding
//
// Deploy:
//   supabase functions deploy granola-sync --no-verify-jwt
//
// --no-verify-jwt because we authenticate by virtue of the function's own
// allowed-list (no parameters from the browser besides a method check).

const GRANOLA_API = 'https://public-api.granola.ai/v1';
const LOOKBACK_DAYS = 60;

// ===== Course mapping (kept in sync with scripts/sync-granola.mjs) =====
const PROJECT_TO_COURSE: Record<string, string> = {
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
const TITLE_CODE_RE = /\b(MNS|BST|BMI|LSC|STP|TPH|POP|ASB|EXW|KIN|NUR)\s*0?(\d{3})\b/i;

// ===== Parsing helpers (ported as-is from sync-granola.mjs) =====
function findCheckedItems(block: string): string[] {
  const out: string[] = [];
  const re = /\[x\]\s+([^\n\[]+?)(?=\s*\[|$|\n)/gi;
  let m;
  while ((m = re.exec(block))) {
    const label = m[1].trim().replace(/[\s,:;]+$/, '');
    if (label && label.length < 80) out.push(label);
  }
  return out;
}

function splitSections(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /^###\s+([^\n]+?)\s*\n([\s\S]*?)(?=^###\s|^##\s|\n---\s*\n|$(?![\r\n]))/gm;
  let m;
  while ((m = re.exec(md))) {
    const heading = m[1].trim().toLowerCase();
    out[heading] = m[2].trim();
  }
  return out;
}

function bulletsOf(body: string): string[] {
  if (!body) return [];
  const out: string[] = [];
  let owner: string | null = null;
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

function firstSentences(text: string, n = 4): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  const parts = clean.split(/(?<=[.!?])\s+/);
  return parts.slice(0, n).join(' ').slice(0, 1200);
}

function parseFollowUp(headerBlock: string): { date?: string; time?: string | null; label: string } | null {
  const m = headerBlock.match(/Follow-up Meeting Scheduled For\s*:?\s*\n?\s*([^\n]+)/i);
  if (!m) return null;
  const line = m[1].trim();
  if (/^\[.*\]$/.test(line) || !line) return null;
  const dateRe = /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?/i;
  const d = line.match(dateRe);
  if (!d) return { label: line };
  const timeM = line.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
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

function parseTranscriptUrl(md: string): string | null {
  const m = md.match(/https:\/\/notes\.granola\.ai\/t\/[a-f0-9-]+/i);
  return m ? m[0] : null;
}

function courseFromProjectsOrTitle(projects: string[], title: string): string | null {
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

function pickSection(sections: Record<string, string>, names: string[]): string {
  for (const n of names) {
    const key = Object.keys(sections).find(k => k === n.toLowerCase() || k.startsWith(n.toLowerCase()));
    if (key) return sections[key];
  }
  return '';
}

interface ParsedNote {
  id: string;
  title: string;
  date: string;
  webUrl: string | null;
  transcriptUrl: string | null;
  projects: string[];
  people: string[];
  followUp: ReturnType<typeof parseFollowUp>;
  summary: string;
  decisions: string[];
  actionItems: { text: string; done: boolean; who: string }[];
  relationshipBuilding: string[];
}

function parseNote(detail: { id: string; title: string; created_at?: string; updated_at?: string; web_url?: string; summary_markdown?: string; summary_text?: string }): ParsedNote | null {
  const md = detail.summary_markdown || detail.summary_text || '';
  if (!md) return null;
  const headerEnd = md.search(/###\s*#?\s*Regular AI Notes\s*:?/i);
  const header = headerEnd >= 0 ? md.slice(0, headerEnd) : md;
  const body = headerEnd >= 0 ? md.slice(headerEnd) : md;
  const projectBlock = (header.match(/Project[^\n]*\n([\s\S]*?)(?=People|$)/i) || [])[1] || '';
  const peopleBlock = (header.match(/People[^\n]*\n([\s\S]*?)(?=Follow-up|Regular AI|$)/i) || [])[1] || '';
  const projects = findCheckedItems(projectBlock);
  const peopleChecked = findCheckedItems(peopleBlock);
  const sections = splitSections(body);
  let decisions = bulletsOf(pickSection(sections, ['decisions', 'key decisions', 'decisions made']));
  // Mirror of sync-granola.mjs — Granola notes rarely have a literal
  // "Decisions Made" heading; outcomes get filed under section titles like
  // "Assignment Weighting Structure Finalized". Scan headings for decision-
  // language keywords and merge their bullets in.
  const decisionTitleRe = /\b(finalized|established|agreed|decided|chosen|selected|approved|locked\s+in)\b/i;
  for (const heading of Object.keys(sections)) {
    if (/^(decisions|key decisions|decisions made)/.test(heading)) continue;
    if (decisionTitleRe.test(heading)) {
      const items = bulletsOf(sections[heading]);
      if (items.length > 0) decisions = decisions.concat(items);
    }
  }
  const actionRaw = bulletsOf(pickSection(sections, ['action items', 'next steps', 'follow-up actions', 'follow-ups']));
  const relationshipBuilding = bulletsOf(pickSection(sections, [
    'relationship building', 'relationship', 'rapport', 'personal',
    'context', 'background', 'small talk', 'tidbits', 'about the faculty'
  ]));
  const ID_PREFIXES = /^(elisa(?:\s+penmar)?|penmar|id|me|i)\b\s*[:\-]/i;
  const FACULTY_PREFIX = /^([a-z][\w .'-]{0,40}?)\s*[:\-]\s+/i;
  // Default is 'faculty' — see scripts/sync-granola.mjs for rationale.
  const actionItems = actionRaw.map(t => {
    const done = /\bdone\b/i.test(t) || /^\[x\]/i.test(t);
    const text = t.replace(/^\[[ x]\]\s*/i, '').trim();
    const naked = text.replace(/^[*_]+/, '').replace(/^[*_]+:/, ':');
    let who = 'faculty';
    if (ID_PREFIXES.test(naked)) who = 'id';
    else if (/^(faculty|instructor)\b/i.test(naked)) who = 'faculty';
    else if (FACULTY_PREFIX.test(naked)) who = 'faculty';
    return { text, done, who };
  });
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
    const skip = /^#?\s*(regular ai notes|obsidian tags)/i;
    const firstKey = Object.keys(sections).find(k => !skip.test(k) && sections[k].trim());
    if (firstKey) {
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

function fmtYmd(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ===== Granola API =====
async function gx(apiKey: string, path: string): Promise<any> {
  const r = await fetch(GRANOLA_API + path, {
    headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

// ===== Sync orchestration =====
async function runSync(apiKey: string, supabaseUrl: string, serviceKey: string) {
  const now = new Date();
  const cutoff = fmtYmd(new Date(now.getTime() - LOOKBACK_DAYS * 86400000));
  const all: any[] = [];
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    const qs = `?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await gx(apiKey, '/notes' + qs);
    for (const n of (res.notes || [])) {
      if ((n.created_at || '').slice(0, 10) < cutoff) { cursor = ''; break; }
      all.push(n);
    }
    if (!res.hasMore || !res.cursor) break;
    const lastDate = (res.notes.at(-1)?.created_at || '').slice(0, 10);
    if (lastDate && lastDate < cutoff) break;
    cursor = res.cursor;
  }

  // Fetch full detail for each + parse, with the same 5/sec rate-limit pause
  const courseNotes: Record<string, ParsedNote[]> = {};
  let unmatchedCount = 0;
  let fetched = 0;
  for (const stub of all) {
    if (fetched > 0 && fetched % 5 === 0) await new Promise(r => setTimeout(r, 1100));
    let detail;
    try { detail = await gx(apiKey, '/notes/' + stub.id); }
    catch (e) { console.warn(`skip ${stub.id}: ${(e as Error).message.slice(0, 80)}`); continue; }
    fetched++;
    const parsed = parseNote(detail);
    if (!parsed) continue;
    const courseId = courseFromProjectsOrTitle(parsed.projects, parsed.title);
    if (!courseId) { unmatchedCount++; continue; }
    (courseNotes[courseId] ||= []).push(parsed);
  }

  // Flatten into rows for upsert
  const rows: any[] = [];
  for (const [courseId, notes] of Object.entries(courseNotes)) {
    for (const n of notes) {
      rows.push({
        granola_id: n.id,
        course_id: courseId,
        meeting_date: n.date || null,
        title: n.title || null,
        people: n.people.length ? n.people : ['Elisa Penmar'],
        summary: n.summary || null,
        decisions: n.decisions || [],
        action_items: n.actionItems || [],
        follow_up: n.followUp || null,
        granola_url: n.webUrl || null,
        transcript_url: n.transcriptUrl || null,
        source: 'granola',
        synced_at: new Date().toISOString(),
      });
    }
  }

  const totalMatched = rows.length;
  if (rows.length > 0) {
    const r = await fetch(supabaseUrl + '/rest/v1/meetings?on_conflict=granola_id', {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(rows),
    });
    if (!r.ok) throw new Error(`upsert ${r.status} ${await r.text()}`);
  }

  return {
    fetched,
    matched: totalMatched,
    unmatched: unmatchedCount,
    courses: Object.keys(courseNotes).length,
  };
}

function cors(res: Response): Response {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, apikey, x-client-info');
  return res;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  if (req.method !== 'POST') return cors(new Response('Method not allowed', { status: 405 }));

  const apiKey = Deno.env.get('GRANOLA_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!apiKey) return cors(new Response(JSON.stringify({ error: 'GRANOLA_API_KEY not configured' }), { status: 500 }));
  if (!serviceKey) return cors(new Response(JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }), { status: 500 }));

  try {
    const result = await runSync(apiKey, supabaseUrl, serviceKey);
    return cors(new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  } catch (e) {
    console.error('[granola-sync]', e);
    return cors(new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }));
  }
});
