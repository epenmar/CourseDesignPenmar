// Supabase client configuration.
// Safe to commit: the publishable key is designed to be public and is gated by RLS policies.
window.SUPABASE_URL = 'https://gflnymqjraxonbdtbxma.supabase.co';
window.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_di7j_DR1Ie3GJdOtHb8NlQ_rI5eiP4Y';

// Track B (multi-user auth). DORMANT until set true: while false, the dashboard
// has no login gate and all owner-only features stay enabled (single-user mode).
// Flip to true only after the Google OAuth provider is configured in Supabase
// (see docs/track-b-auth-foundation.md) and the schema migration has run.
window.COMPOSE_AUTH_ENABLED = true;
// Bootstrap admins (lowercased emails). Used before/until a profiles.is_admin
// row exists so the owner keeps access to owner-only tools (e.g. Canvas Plan).
window.COMPOSE_ADMIN_EMAILS = ['elisa.penmar@asu.edu', 'epenmar@asu.edu'];
// Track C share tokens. DORMANT until true: links carry no token and the
// worksheet doesn't redeem (behaviour identical to today). Flip on only after
// the redeem-share-token edge function is deployed and the C3 isolation RLS is
// in place (see docs/track-c-share-tokens.md).
window.COMPOSE_SHARE_TOKENS_ENABLED = true;
// Identity-based course grants (the "single-URL Google login" model): the owner
// grants a faculty member access by their ASU email, and on Google sign-in that
// person is recognized by email (course_grants table + cc_grant_role). Additive
// and safe — writing a grant only ever GIVES a named person access and never
// touches the existing secret-link flow. Set false to hide the grant controls.
window.COMPOSE_IDENTITY_GRANTS_ENABLED = true;
// Worksheet single-URL Google login. DORMANT until true: while false the worksheet
// behaves exactly as today (anonymous + ?t= secret-link flow). When true, a faculty
// member opening a token-less worksheet URL is asked to sign in with ASU Google and
// shown only the course(s) they've been granted. Existing ?t= links always bypass
// this gate, so the two models run side-by-side. Per-load override: ?identitylogin=1
// to force on, ?identitylogin=0 to force off.
window.COMPOSE_IDENTITY_LOGIN_ENABLED = true;
// dashboard_state upsert conflict target. Stays 'key' until the C3 isolation
// cutover changes the primary key to (user_id, key); set to 'user_id,key' then.
window.COMPOSE_DS_CONFLICT = 'user_id,key';

// When true, Airtable API calls route through the `airtable-proxy` Supabase
// edge function, which injects the PAT server-side. Flip this on after
// deploying the function (see supabase/functions/airtable-proxy/index.ts).
// When false, the browser uses the PAT stored in localStorage (prompted once).
window.AIRTABLE_VIA_PROXY = true;
