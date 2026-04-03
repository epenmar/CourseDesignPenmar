#!/usr/bin/env node
// sync-server.js — Lightweight local server that syncs Outlook + Obsidian
// on every request (i.e., on dashboard page refresh).
// Runs on localhost:3456. No API keys, no cost.

const http = require('http');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 3456;
const SYNC_SCRIPT = path.join(__dirname, 'sync-calendar.js');
const DATA_FILE = path.join(__dirname, 'dashboard-data.js');

// Throttle: don't re-sync if last sync was <60s ago
let lastSync = 0;

const server = http.createServer((req, res) => {
  // CORS headers so the dashboard can fetch from localhost
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

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

    console.log(`[sync-server] Running sync...`);
    execFile(process.execPath, [SYNC_SCRIPT], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[sync-server] Sync failed: ${err.message}`);
        if (stderr) console.error(stderr);
      } else {
        console.log(stdout.trim());
        lastSync = Date.now();
      }
      serveData(res);
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[sync-server] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[sync-server] Dashboard will trigger sync on each page refresh`);
  console.log(`[sync-server] Throttled to max 1 sync per 60s`);
});
