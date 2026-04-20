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

const server = http.createServer((req, res) => {
  // CORS headers so the dashboard can fetch from localhost
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/jira/comment')) {
    handleJiraComment(req, res);
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
      // 2) Granola meeting notes (runs after, overlays course entries it matches)
      execFile(process.execPath, [GRANOLA_SCRIPT], { timeout: 45000 }, (gErr, gOut, gStderr) => {
        if (gErr) {
          console.error(`[sync-server] Granola sync failed: ${gErr.message}`);
          if (gStderr) console.error(gStderr);
        } else if (gOut) {
          console.log(gOut.trim());
        }
        lastSync = Date.now();
        serveData(res);
      });
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

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
