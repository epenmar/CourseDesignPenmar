// Supabase client configuration.
// Safe to commit: the publishable key is designed to be public and is gated by RLS policies.
window.SUPABASE_URL = 'https://gflnymqjraxonbdtbxma.supabase.co';
window.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_di7j_DR1Ie3GJdOtHb8NlQ_rI5eiP4Y';

// When true, Airtable API calls route through the `airtable-proxy` Supabase
// edge function, which injects the PAT server-side. Flip this on after
// deploying the function (see supabase/functions/airtable-proxy/index.ts).
// When false, the browser uses the PAT stored in localStorage (prompted once).
window.AIRTABLE_VIA_PROXY = true;
