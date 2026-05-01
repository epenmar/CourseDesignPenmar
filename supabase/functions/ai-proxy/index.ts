// ai-proxy — Supabase Edge Function
//
// Server-side proxy to ASU's CreateAI endpoint, replacing the local
// sync-server's /ai/query handler. Lets every collaborator (not just the
// laptop running sync-server) reach the AI features in the worksheet —
// ELO tagging, rubric generation, course parser, the chat assistant, etc.
//
// Same request/response shape as the local handler: takes a JSON body of
// { query, systemPrompt, maxTokens, model, provider, temperature } and
// proxies to api-main.aiml.asu.edu/query, injecting the bearer token from
// Supabase secrets.
//
// Secrets required (set once via `supabase secrets set …`):
//   CREATE_AI_API_KEY         — the ASU AIML Platform bearer token
//   CREATE_AI_API_URL         — optional, defaults to api-main.aiml.asu.edu
//
// Deploy:
//   supabase functions deploy ai-proxy --no-verify-jwt

const DEFAULT_UPSTREAM = 'https://api-main.aiml.asu.edu/query';

function cors(res: Response): Response {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, apikey, x-client-info');
  return res;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  if (req.method !== 'POST') return cors(new Response('Method not allowed', { status: 405 }));

  const apiKey = Deno.env.get('CREATE_AI_API_KEY');
  const upstream = Deno.env.get('CREATE_AI_API_URL') || DEFAULT_UPSTREAM;
  if (!apiKey) {
    return cors(new Response(JSON.stringify({ error: 'CREATE_AI_API_KEY not configured on server' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    }));
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return cors(new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 }));
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
      max_tokens: payload.maxTokens || 1024,
    },
  };

  try {
    const upRes = await fetch(upstream, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(upstreamPayload),
    });
    const text = await upRes.text();
    return cors(new Response(text, {
      status: upRes.status,
      headers: { 'Content-Type': 'application/json' },
    }));
  } catch (e) {
    console.error('[ai-proxy] upstream error', e);
    return cors(new Response(JSON.stringify({ error: 'Upstream AI request failed: ' + (e as Error).message }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    }));
  }
});
