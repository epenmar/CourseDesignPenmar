// airtable-proxy — Supabase Edge Function
//
// Proxies Airtable API calls from the dashboard, injecting the Airtable PAT
// server-side so it never ships to the browser. The dashboard posts a JSON
// envelope describing the Airtable request; this function forwards it,
// substitutes the Bearer token from Supabase secrets, and returns the raw
// Airtable response body.
//
// Deploy (once):
//   supabase link --project-ref gflnymqjraxonbdtbxma     # if not linked
//   supabase secrets set AIRTABLE_PAT=pat...             # the real PAT
//   supabase functions deploy airtable-proxy --no-verify-jwt=false
//
// Call from the browser (example):
//   fetch(`${SUPABASE_URL}/functions/v1/airtable-proxy`, {
//     method: 'POST',
//     headers: {
//       'Authorization': 'Bearer ' + SUPABASE_PUBLISHABLE_KEY,
//       'Content-Type': 'application/json'
//     },
//     body: JSON.stringify({
//       method: 'GET',
//       path: 'appRrjeSGPrfXPSuu/tblhu9fDKBqoG9HQ3/recXXX'
//     })
//   });
//
// Allow-list: only requests against the ASU Online base (appRrjeSGPrfXPSuu)
// are forwarded. This is defense-in-depth so a leaked Supabase publishable
// key can't be used to turn this function into an open Airtable proxy.

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0/';
const ALLOWED_BASE_IDS = new Set(['appRrjeSGPrfXPSuu']);

function cors(res: Response): Response {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, apikey, x-client-info');
  return res;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  if (req.method !== 'POST') return cors(new Response('Method not allowed', { status: 405 }));

  const pat = Deno.env.get('AIRTABLE_PAT');
  if (!pat) return cors(new Response(JSON.stringify({ error: 'AIRTABLE_PAT not configured on server' }), { status: 500 }));

  let payload: { method?: string; path?: string; body?: unknown };
  try {
    payload = await req.json();
  } catch {
    return cors(new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 }));
  }

  const method = (payload.method || 'GET').toUpperCase();
  const path = payload.path || '';
  if (!path || typeof path !== 'string') {
    return cors(new Response(JSON.stringify({ error: 'path is required' }), { status: 400 }));
  }
  // Reject anything containing a scheme — we only want relative Airtable paths.
  if (/:\/\//.test(path)) {
    return cors(new Response(JSON.stringify({ error: 'path must be relative to api.airtable.com/v0/' }), { status: 400 }));
  }
  const baseMatch = path.match(/^(app[A-Za-z0-9]+)\//);
  if (!baseMatch || !ALLOWED_BASE_IDS.has(baseMatch[1])) {
    return cors(new Response(JSON.stringify({ error: 'Airtable base not in allow-list' }), { status: 403 }));
  }

  const init: RequestInit = {
    method,
    headers: {
      'Authorization': 'Bearer ' + pat,
      'Content-Type': 'application/json'
    }
  };
  if (payload.body != null && method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify(payload.body);
  }

  const upstream = await fetch(AIRTABLE_API_BASE + path, init);
  const text = await upstream.text();
  return cors(new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' }
  }));
});
