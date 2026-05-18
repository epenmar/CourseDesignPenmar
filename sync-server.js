#!/usr/bin/env node
// sync-server.js — Lightweight local server that syncs Outlook + Obsidian
// on every request (i.e., on dashboard page refresh).
// Runs on localhost:3456. No API keys, no cost.

const http = require('http');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 3456;
const SYNC_SCRIPT   = path.join(__dirname, 'sync-calendar.js');
const GRANOLA_SCRIPT = path.join(__dirname, 'scripts', 'sync-granola.mjs');
const DATA_FILE = path.join(__dirname, 'dashboard-data.js');
const ENV_FILE  = path.join(path.dirname(path.dirname(path.dirname(__dirname))), '.env'); // ~/conductor/.env

// Load .env so the Jira proxy has credentials without needing them in the HTML.
function loadEnv() {
  try {
    const raw = fs.readFileSync(ENV_FILE, 'utf8');
    const out = {};
    raw.split('\n').forEach(line => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
    return out;
  } catch (e) {
    console.warn('[sync-server] Could not read .env:', e.message);
    return {};
  }
}
const ENV = loadEnv();

// Throttle: don't re-sync if last sync was <60s ago
let lastSync = 0;

// Auto-publish state — keeps dashboard-data.js on GitHub Pages fresh
// without requiring a manual commit. Throttled because the cron runs
// every dashboard page-load and we don't want one commit per visit.
let lastPublishAt = 0;
let publishInProgress = false;
// Minimum gap between auto-pushes. Frequent enough to keep the
// deployed dashboard within ~30 min of reality; sparse enough that
// git log isn't drowned in [sync] commits.
const PUBLISH_THROTTLE_MS = 30 * 60 * 1000;
// Allow the user to opt out without code edits via ~/conductor/.env.
// Any non-truthy value disables the auto-push; the local dashboard
// still gets fresh data via the localhost:3456 path, only the
// deployed dashboard stops auto-updating.
const AUTO_PUBLISH = (ENV.DASHBOARD_AUTOPUBLISH || 'true').toLowerCase() !== 'false';

const server = http.createServer((req, res) => {
  // CORS headers so the dashboard can fetch from localhost
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Required for HTTPS pages (GitHub Pages) to fetch this localhost server —
  // Chrome's Private Network Access blocks the request otherwise.
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/jira/comment')) {
    handleJiraComment(req, res);
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/jira/sync-time')) {
    handleJiraSyncTime(req, res);
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/ai/query')) {
    handleAiProxy(req, res);
    return;
  }

  // GET  /jira/issue/:key       → fetch summary + current status + issue type
  // GET  /jira/transitions/:key → list available transitions for an issue
  // POST /jira/transitions/:key → apply a transition  { transitionId }
  // POST /jira/worklog/:key     → log time           { timeSpentSeconds, started?, comment? }
  // GET  /jira/children/:key    → child issues under an Epic (for ADDIE sub-tasks)
  var jiraMatch = req.url.match(/^\/jira\/(issue|transitions|worklog|children)\/([A-Z][A-Z0-9_]+-\d+)(\?|$)/i);
  if (jiraMatch) {
    var kind = jiraMatch[1].toLowerCase();
    var issueKey = jiraMatch[2].toUpperCase();
    handleJiraProxy(req, res, kind, issueKey);
    return;
  }

  const isForce = req.url.includes('force=1');
  if (req.url.startsWith('/sync') || req.url === '/') {
    const now = Date.now();
    const sinceLast = (now - lastSync) / 1000;

    if (!isForce && sinceLast < 60) {
      // Serve cached data without re-syncing
      console.log(`[sync-server] Serving cached data (synced ${Math.round(sinceLast)}s ago)`);
      serveData(res);
      return;
    }

    console.log(`[sync-server] Running sync (calendar + granola)...`);
    // 1) Outlook calendar + legacy Obsidian notes
    execFile(process.execPath, [SYNC_SCRIPT], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[sync-server] Calendar sync failed: ${err.message}`);
        if (stderr) console.error(stderr);
      } else if (stdout) {
        console.log(stdout.trim());
      }
      // 2) Granola meeting notes (runs after, overlays course entries it matches).
      // Timeout is generous because the script iterates every Granola note
      // summary in the lookback window (105+ at 60-day lookback) and Granola's
      // per-summary endpoint is the slow bottleneck. Manual runs land in ~75s;
      // the previous 45s cap killed every server-triggered run, so Granola
      // notes silently stopped flowing to the dashboard even though Granola
      // itself had the data. 150s gives headroom as the note count grows.
      execFile(process.execPath, [GRANOLA_SCRIPT], { timeout: 150000 }, (gErr, gOut, gStderr) => {
        if (gErr) {
          console.error(`[sync-server] Granola sync failed: ${gErr.message}`);
          if (gStderr) console.error(gStderr);
        } else if (gOut) {
          console.log(gOut.trim());
        }
        lastSync = Date.now();
        serveData(res);
        // Fire-and-forget: push the freshly-written dashboard-data.js to
        // GitHub Pages so the deployed dashboard tracks reality. Runs
        // after the response is sent so it never delays the user-facing
        // sync. Throttled + content-aware (see publishDashboardData).
        try { publishDashboardData(); } catch (e) { console.warn('[publish] threw:', e && e.message); }
      });
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Auto-commit + push dashboard-data.js to the configured remote so the
// GitHub-Pages-served dashboard tracks reality. Conservative defaults:
//   - Skipped entirely when AUTO_PUBLISH is false
//   - Throttled to PUBLISH_THROTTLE_MS so a noisy day doesn't spam commits
//   - Aborts if the working tree has UNRELATED modifications — refuses to
//     hijack the user's in-progress work
//   - Skips when the only diff is the syncedAt timestamp (no real data
//     change is worth pushing)
//   - Pushes `HEAD:main` to match the user's existing manual workflow
//   - Logs to sync-server.log; never blocks the response
function publishDashboardData() {
  if (!AUTO_PUBLISH) return;
  if (publishInProgress) return;
  if (Date.now() - lastPublishAt < PUBLISH_THROTTLE_MS) return;
  publishInProgress = true;
  const cwd = __dirname;
  // 1. Make sure dashboard-data.js actually changed since the last commit.
  execFile('git', ['diff', '--quiet', '--', 'dashboard-data.js'], { cwd }, (diffErr) => {
    if (!diffErr) {
      // exit 0 = no diff → nothing to publish
      publishInProgress = false;
      return;
    }
    // 2. Check if dashboard-data.js is the ONLY modified file. If the user
    //    has other in-flight edits, we don't want to commit-and-push their
    //    branch state out from under them.
    execFile('git', ['status', '--porcelain'], { cwd }, (statusErr, statusOut) => {
      if (statusErr) {
        console.warn('[publish] git status failed:', statusErr.message);
        publishInProgress = false;
        return;
      }
      const lines = (statusOut || '').split('\n').map(l => l.trim()).filter(Boolean);
      const otherModified = lines.filter(l => {
        const path = l.replace(/^\S+\s+/, '');
        return path !== 'dashboard-data.js' && !path.startsWith('??');
      });
      if (otherModified.length > 0) {
        console.log('[publish] working tree has other modifications, skipping auto-push:',
          otherModified.slice(0, 5).join(' | '));
        publishInProgress = false;
        return;
      }
      // 3. Skip if the only change is the syncedAt timestamp. Pushing those
      //    is mostly noise — the staleness chip already shows freshness via
      //    timestamp comparison, and the deployed snapshot doesn't need
      //    every-N-min churn for purely cosmetic age refreshes.
      execFile('git', ['diff', '--unified=0', '--', 'dashboard-data.js'], { cwd }, (dErr, dOut) => {
        if (dErr) {
          console.warn('[publish] git diff failed:', dErr.message);
          publishInProgress = false;
          return;
        }
        const meaningful = (dOut || '')
          .split('\n')
          .filter(l => (l.startsWith('+') || l.startsWith('-')) &&
                       !l.startsWith('+++') && !l.startsWith('---') &&
                       !/syncedAt|Last synced/.test(l));
        if (meaningful.length === 0) {
          publishInProgress = false;
          return;
        }
        // 4. Stage, commit, and push HEAD to origin/main.
        execFile('git', ['add', 'dashboard-data.js'], { cwd }, (addErr) => {
          if (addErr) {
            console.warn('[publish] git add failed:', addErr.message);
            publishInProgress = false;
            return;
          }
          const msg = '[sync] dashboard-data.js refresh';
          execFile('git', ['commit', '-m', msg], { cwd }, (commitErr, cOut, cStderr) => {
            if (commitErr) {
              console.warn('[publish] git commit failed:', commitErr.message);
              if (cStderr) console.warn(cStderr.trim());
              publishInProgress = false;
              return;
            }
            execFile('git', ['push', 'origin', 'HEAD:main'], { cwd, timeout: 30000 },
              (pushErr, pOut, pStderr) => {
                if (pushErr) {
                  console.warn('[publish] git push failed:', pushErr.message);
                  if (pStderr) console.warn(pStderr.trim());
                  // Don't reset lastPublishAt on failure — let the throttle
                  // window pass naturally so we don't spam attempts when
                  // offline. Next successful sync will retry.
                } else {
                  console.log('[publish] pushed dashboard-data.js to origin/main');
                  lastPublishAt = Date.now();
                }
                publishInProgress = false;
              });
          });
        });
      });
    });
  });
}

function serveData(res) {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    // Extract just the JSON from the JS file
    const jsonStr = raw.replace(/^[^{]*/, '').replace(/;\s*$/, '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(jsonStr);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

// POST /jira/comment  { issueKey: "EDL-7802", text: "..." }
// Posts a comment to the given Jira issue using credentials from ~/conductor/.env.
// POST /ai/query  — proxies to ASU's CreateAI endpoint with the bearer
// token held only on this machine (~/conductor/.env CREATE_AI_KEY). Lets
// the worksheet AI Design Assistant function without shipping the token
// in the GitHub Pages bundle. Body shape:
//   { query, systemPrompt, maxTokens, model, provider, temperature }
// Returns the upstream JSON ({ response: "..." }) verbatim.
function handleAiProxy(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 500000) req.destroy(); });
  req.on('end', () => {
    let payload;
    try { payload = JSON.parse(body); }
    catch (e) { return sendJson(res, 400, { error: 'Invalid JSON' }); }

    // .env in the parent uses CREATE_AI_API_KEY/URL; accept the shorter
    // CREATE_AI_KEY/URL names too in case they're added later.
    const upstreamUrl = ENV.CREATE_AI_API_URL || ENV.CREATE_AI_URL || 'https://api-main.aiml.asu.edu/query';
    const key = ENV.CREATE_AI_API_KEY || ENV.CREATE_AI_KEY;
    if (!key) {
      return sendJson(res, 500, {
        error: 'CREATE_AI_API_KEY not set in ~/conductor/.env. Add the bearer token there and restart sync-server.'
      });
    }

    const upstreamPayload = {
      action: 'query',
      request_source: 'override_params',
      query: payload.query || '',
      model_provider: payload.provider || 'aws',
      model_name: payload.model || 'claude4_5_sonnet',
      model_params: {
        system_prompt: payload.systemPrompt || '',
        temperature: typeof payload.temperature === 'number' ? payload.temperature : 0,
        max_tokens: payload.maxTokens || 1024
      }
    };

    const url = new URL(upstreamUrl);
    const lib = url.protocol === 'https:' ? require('https') : require('http');
    const upBody = JSON.stringify(upstreamPayload);
    const upReq = lib.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + (url.search || ''),
      headers: {
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(upBody)
      }
    }, upRes => {
      let chunks = '';
      upRes.on('data', c => { chunks += c; });
      upRes.on('end', () => {
        res.writeHead(upRes.statusCode || 502, { 'Content-Type': 'application/json' });
        res.end(chunks);
      });
    });
    upReq.on('error', err => {
      console.error('[ai/query] upstream error', err.message);
      sendJson(res, 502, { error: 'Upstream AI request failed: ' + err.message });
    });
    upReq.write(upBody);
    upReq.end();
  });
}

// POST /jira/sync-time  — runs scripts/sync-jira-time.mjs on demand
// so the dashboard "Sync time ⇢ Jira" button can trigger the same logic
// as the nightly cron. Returns stdout/stderr so the UI can show what
// happened.
function handleJiraSyncTime(req, res) {
  const script = path.join(__dirname, 'scripts', 'sync-jira-time.mjs');
  execFile(process.execPath, [script], { timeout: 90000 }, (err, stdout, stderr) => {
    if (err) {
      return sendJson(res, 500, {
        ok: false,
        error: err.message,
        stdout: stdout || '',
        stderr: stderr || ''
      });
    }
    sendJson(res, 200, { ok: true, stdout: stdout || '', stderr: stderr || '' });
  });
}

function handleJiraComment(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 100000) req.destroy(); });
  req.on('end', async () => {
    let payload;
    try { payload = JSON.parse(body); }
    catch (e) { return sendJson(res, 400, { error: 'Invalid JSON' }); }

    const issueKey = (payload.issueKey || '').trim();
    const text = (payload.text || '').trim();
    if (!issueKey || !text) return sendJson(res, 400, { error: 'issueKey and text required' });

    const base  = ENV.JIRA_BASE_URL;
    const email = ENV.JIRA_EMAIL;
    const token = ENV.JIRA_API_TOKEN;
    if (!base || !email || !token) {
      return sendJson(res, 500, { error: 'Jira credentials not configured in ~/conductor/.env' });
    }

    const auth = Buffer.from(`${email}:${token}`).toString('base64');
    const adf = {
      body: {
        type: 'doc',
        version: 1,
        content: text.split(/\n\n+/).map(para => ({
          type: 'paragraph',
          content: para.split('\n').flatMap((line, i, arr) => {
            const nodes = line ? [{ type: 'text', text: line }] : [];
            if (i < arr.length - 1) nodes.push({ type: 'hardBreak' });
            return nodes;
          })
        }))
      }
    };

    try {
      const r = await fetch(`${base}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(adf)
      });
      const txt = await r.text();
      if (r.status === 201) {
        let parsed = null; try { parsed = JSON.parse(txt); } catch(e) {}
        console.log(`[sync-server] Jira comment posted to ${issueKey} (id=${parsed && parsed.id})`);
        return sendJson(res, 200, { ok: true, id: parsed && parsed.id, issueKey: issueKey });
      }
      console.error(`[sync-server] Jira comment failed (${r.status}):`, txt.slice(0, 500));
      return sendJson(res, r.status, { error: `Jira ${r.status}`, detail: txt.slice(0, 500) });
    } catch (e) {
      console.error('[sync-server] Jira request error:', e.message);
      return sendJson(res, 500, { error: e.message });
    }
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Shared helper: builds Basic auth header or returns null + writes 500.
function jiraAuth(res) {
  const base  = ENV.JIRA_BASE_URL;
  const email = ENV.JIRA_EMAIL;
  const token = ENV.JIRA_API_TOKEN;
  if (!base || !email || !token) {
    sendJson(res, 500, { error: 'Jira credentials not configured in ~/conductor/.env' });
    return null;
  }
  return { base: base, header: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64') };
}

// Dispatches GET/POST for /jira/{issue,transitions,worklog,children}/:key
async function handleJiraProxy(req, res, kind, issueKey) {
  const a = jiraAuth(res);
  if (!a) return;
  const headers = {
    Authorization: a.header,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };

  try {
    // --- GET endpoints ---
    if (req.method === 'GET') {
      let url;
      if (kind === 'issue') {
        url = `${a.base}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,status,issuetype,parent`;
      } else if (kind === 'transitions') {
        url = `${a.base}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`;
      } else if (kind === 'children') {
        // Find direct children of an Epic: parent-link OR sub-tasks
        const jql = `parent = ${issueKey} ORDER BY summary ASC`;
        url = `${a.base}/rest/api/3/search/jql`;
        const r = await fetch(url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ jql: jql, fields: ['summary', 'status', 'issuetype'], maxResults: 50 })
        });
        const txt = await r.text();
        return sendJson(res, r.status, safeJson(txt));
      } else {
        return sendJson(res, 400, { error: 'GET not supported for ' + kind });
      }
      const r = await fetch(url, { method: 'GET', headers: headers });
      const txt = await r.text();
      return sendJson(res, r.status, safeJson(txt));
    }

    // --- POST endpoints ---
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 100000) req.destroy(); });
      req.on('end', async () => {
        let payload;
        try { payload = JSON.parse(body || '{}'); }
        catch (e) { return sendJson(res, 400, { error: 'Invalid JSON' }); }

        if (kind === 'transitions') {
          const transitionId = String(payload.transitionId || '').trim();
          if (!transitionId) return sendJson(res, 400, { error: 'transitionId required' });
          const r = await fetch(`${a.base}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ transition: { id: transitionId } })
          });
          // 204 = success, no body
          if (r.status === 204) {
            console.log(`[sync-server] Jira ${issueKey} transitioned (id=${transitionId})`);
            return sendJson(res, 200, { ok: true, issueKey: issueKey, transitionId: transitionId });
          }
          const txt = await r.text();
          console.error(`[sync-server] Jira transition failed (${r.status}):`, txt.slice(0, 500));
          return sendJson(res, r.status, safeJson(txt));
        }

        if (kind === 'worklog') {
          const seconds = parseInt(payload.timeSpentSeconds, 10);
          if (!seconds || seconds < 60) {
            return sendJson(res, 400, { error: 'timeSpentSeconds must be >= 60 (Jira minimum is 1 minute)' });
          }
          const worklog = { timeSpentSeconds: seconds };
          if (payload.started) worklog.started = payload.started;
          if (payload.comment) {
            worklog.comment = {
              type: 'doc',
              version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: String(payload.comment) }] }]
            };
          }
          const r = await fetch(`${a.base}/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(worklog)
          });
          const txt = await r.text();
          if (r.status === 201) {
            const parsed = safeJson(txt);
            console.log(`[sync-server] Jira worklog added to ${issueKey} (${seconds}s, id=${parsed && parsed.id})`);
            return sendJson(res, 200, { ok: true, issueKey: issueKey, id: parsed && parsed.id, timeSpentSeconds: seconds });
          }
          console.error(`[sync-server] Jira worklog failed (${r.status}):`, txt.slice(0, 500));
          return sendJson(res, r.status, safeJson(txt));
        }

        return sendJson(res, 400, { error: 'POST not supported for ' + kind });
      });
      return;
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    console.error(`[sync-server] Jira ${kind} error:`, e.message);
    return sendJson(res, 500, { error: e.message });
  }
}

function safeJson(txt) {
  try { return JSON.parse(txt); } catch (e) { return { raw: String(txt).slice(0, 500) }; }
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[sync-server] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[sync-server] Dashboard will trigger sync on each page refresh`);
  console.log(`[sync-server] Throttled to max 1 sync per 60s`);
  console.log(`[sync-server] Jira proxy ready at POST /jira/comment`);
});
