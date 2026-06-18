// redeem-share-token — Track C C2 (anonymous-session + grants variant).
//
// This project signs JWTs with an ASYMMETRIC (ES256) key we don't hold, so we
// cannot mint our own session token. Instead the worksheet establishes a REAL
// anonymous Supabase session (supabase.auth.signInAnonymously) and calls this
// function with that session + the link token. We validate the token (service
// role) and record a GRANT row (anon_uid -> course_id, owner_id, role). RLS on
// the data tables then authorizes the anon session by joining that grant.
//
// Deploy (anon-callable — faculty have no login; the function reads the caller's
// anon JWT from the Authorization header to identify them):
//   supabase functions deploy redeem-share-token --no-verify-jwt
// No JWT secret needed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ error: "function not configured" }, 500);

    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { token } = await req.json().catch(() => ({}));
    if (!token || typeof token !== "string") return json({ error: "missing token" }, 400);
    if (!jwt) return json({ error: "no session" }, 401);

    const admin = createClient(url, serviceKey);

    // Authoritatively identify the caller's (anonymous) session.
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    const anonUid = userData?.user?.id;
    if (userErr || !anonUid) return json({ error: "invalid session" }, 401);

    // Validate the share token.
    const { data: row, error } = await admin
      .from("coursecompose_share_tokens")
      .select("course_id, owner_id, role, revoked")
      .eq("token", token)
      .maybeSingle();
    if (error) return json({ error: "lookup failed" }, 500);
    if (!row || row.revoked) return json({ error: "invalid or revoked token" }, 401);

    // Record the grant (idempotent; role may change if a different link is used).
    const { error: gErr } = await admin
      .from("coursecompose_share_grants")
      .upsert(
        { anon_uid: anonUid, course_id: row.course_id, owner_id: row.owner_id, role: row.role },
        { onConflict: "anon_uid,course_id" },
      );
    if (gErr) return json({ error: "grant failed: " + gErr.message }, 500);

    await admin
      .from("coursecompose_share_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("token", token);

    return json({ ok: true, course_id: row.course_id, owner_id: row.owner_id, role: row.role });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
