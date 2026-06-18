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

// When true, Airtable API calls route through the `airtable-proxy` Supabase
// edge function, which injects the PAT server-side. Flip this on after
// deploying the function (see supabase/functions/airtable-proxy/index.ts).
// When false, the browser uses the PAT stored in localStorage (prompted once).
window.AIRTABLE_VIA_PROXY = true;
