// redeem-share-token — Track C C2.
//
// Faculty/reviewers open a worksheet link carrying ?t=<token> with NO login.
// This function validates the token (service role) and mints a SHORT-LIVED,
// COURSE-SCOPED Supabase JWT so the worksheet's existing _sbClient calls become
// scoped to that one course via RLS (claims: course_id, owner_id, share_role).
//
// Deploy (anon-callable — faculty have no auth):
//   supabase functions deploy redeem-share-token --no-verify-jwt
// Required function secret (must equal the project's JWT secret so PostgREST
// accepts the minted token):
//   supabase secrets set SHARE_JWT_SECRET="<Project Settings → API → JWT secret>"
//
// SECURITY NOTE: the minted JWT has role 'authenticated' with a SYNTHETIC sub
// (the token row id), so it matches no real user_id — Curate/Compose owner-scoped
// policies (user_id = auth.uid()) deny it. Access is granted ONLY by the
// course-scoped Track-C policies that read the course_id claim. Before C3 cutover,
// confirm no table grants blanket access to any 'authenticated' user.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

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
    const { token } = await req.json().catch(() => ({}));
    if (!token || typeof token !== "string") return json({ error: "missing token" }, 400);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const jwtSecret = Deno.env.get("SHARE_JWT_SECRET");
    if (!url || !serviceKey || !jwtSecret) return json({ error: "function not configured" }, 500);

    const admin = createClient(url, serviceKey);
    const { data: row, error } = await admin
      .from("coursecompose_share_tokens")
      .select("id, course_id, owner_id, role, revoked")
      .eq("token", token)
      .maybeSingle();

    if (error) return json({ error: "lookup failed" }, 500);
    if (!row || row.revoked) return json({ error: "invalid or revoked token" }, 401);

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(jwtSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );

    const accessToken = await create(
      { alg: "HS256", typ: "JWT" },
      {
        aud: "authenticated",
        role: "authenticated",
        sub: row.id, // synthetic, stable per token; matches no real user_id
        course_id: row.course_id,
        owner_id: row.owner_id,
        share_role: row.role,
        iat: getNumericDate(0),
        exp: getNumericDate(60 * 60 * 12), // 12h
      },
      key,
    );

    // best-effort usage stamp
    await admin
      .from("coursecompose_share_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", row.id);

    return json({
      access_token: accessToken,
      course_id: row.course_id,
      owner_id: row.owner_id,
      role: row.role,
      expires_in: 60 * 60 * 12,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
