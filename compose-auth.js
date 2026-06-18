// compose-auth.js — Track B auth foundation for multi-user Compose.
//
// DORMANT BY DEFAULT. Everything here is a no-op unless
// `window.COMPOSE_AUTH_ENABLED === true` (set in supabase-config.js). While the
// flag is false the dashboard/worksheet behave exactly as the single-user tool
// they are today: no login gate, and owner-only features stay enabled.
//
// When enabled:
//   - ComposeAuth.init({requireLogin:true})  gates the page behind ASU Google login
//   - ComposeAuth.user / .profile             the signed-in identity + profiles row
//   - ComposeAuth.isAdmin()                   true for the owner/admin (Elisa)
//   - ComposeAuth.ownerToolsBlocked()         true for a signed-in NON-admin ID
//                                             (used to "coming soon" the Canvas Plan)
//
// Reuses the existing window._sbClient (created in supabase-sync.js) so there is
// only one GoTrue instance. supabase-js persists the session in localStorage
// scoped to the project URL, so a login on the dashboard is also visible to the
// worksheet on the same origin.
(function () {
  var ENABLED = !!window.COMPOSE_AUTH_ENABLED;
  var ADMIN_EMAILS = (window.COMPOSE_ADMIN_EMAILS || []).map(function (e) { return String(e).toLowerCase().trim(); });
  var state = { ready: false, user: null, profile: null };

  function _client() { return window._sbClient || null; }

  function isAdmin() {
    if (!ENABLED) return true;            // single-user mode: owner features stay on
    if (!state.user) return false;
    var role = state.profile && state.profile.role;
    if (role === 'system_admin' || role === 'super_admin') return true;
    return ADMIN_EMAILS.indexOf(String(state.user.email || '').toLowerCase()) !== -1;
  }

  // True only when we positively know this is a signed-in, non-admin ID. Anon
  // sessions (no login) are NOT blocked, so an un-authed owner is never locked
  // out of owner tools — that exposure is the current behaviour and is closed
  // in Track C when the worksheet itself becomes authenticated.
  function ownerToolsBlocked() { return ENABLED && !!state.user && !isAdmin(); }

  function isAuthed() { return ENABLED ? !!state.user : true; }

  async function _loadProfile(sb) {
    // Reuse the SHARED user_profiles table — Compose and Curate live in one
    // Supabase project, so accounts are already unified. A DB trigger
    // (handle_new_user) auto-creates the row on first sign-in, so we only read.
    try {
      var resp = await sb.from('user_profiles').select('id,email,role,full_name').eq('id', state.user.id);
      if (resp && resp.data && resp.data.length) state.profile = resp.data[0];
    } catch (e) { console.warn('[compose-auth] profile load failed:', e && e.message); }
  }

  async function init(opts) {
    opts = opts || {};
    if (!ENABLED) { state.ready = true; return state; }
    var sb = _client();
    if (!sb || !sb.auth) {
      console.warn('[compose-auth] Supabase client not ready — auth init skipped');
      state.ready = true;
      return state;
    }
    try {
      var res = await sb.auth.getSession();
      var session = res && res.data && res.data.session;
      if (session && session.user) {
        state.user = session.user;
        await _loadProfile(sb);
      }
    } catch (e) { console.warn('[compose-auth] getSession failed:', e && e.message); }
    state.ready = true;
    if (opts.requireLogin && !state.user) _renderLoginGate();
    try {
      sb.auth.onAuthStateChange(function (_evt, s) { state.user = (s && s.user) || null; });
    } catch (e) {}
    return state;
  }

  async function signIn() {
    var sb = _client();
    if (!sb) return;
    await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { queryParams: { hd: 'asu.edu' }, redirectTo: window.location.href }
    });
  }

  async function signOut() {
    var sb = _client();
    if (sb) { try { await sb.auth.signOut(); } catch (e) {} }
    // Clear cached per-user local data so a shared machine can't leak one ID's
    // dashboard to the next. Cheapest correct option: full reload after sign-out.
    location.reload();
  }

  function _renderLoginGate() {
    if (document.getElementById('compose-login-gate')) return;
    var d = document.createElement('div');
    d.id = 'compose-login-gate';
    d.style.cssText = 'position:fixed; inset:0; background:#fff; z-index:99999; display:flex; ' +
      'flex-direction:column; align-items:center; justify-content:center; font-family:Inter,sans-serif;';
    d.innerHTML =
      '<div style="text-align:center; max-width:380px; padding:24px;">' +
        '<h1 style="color:#8c1d40; font-size:26px; margin:0 0 6px;">Compose</h1>' +
        '<p style="color:#666; margin:0 0 24px; font-size:14px;">Sign in with your ASU account to continue.</p>' +
        '<button id="compose-login-btn" style="background:#8c1d40; color:#fff; border:none; ' +
        'padding:12px 24px; border-radius:8px; font-size:15px; cursor:pointer;">Sign in with ASU Google</button>' +
      '</div>';
    document.body.appendChild(d);
    var btn = document.getElementById('compose-login-btn');
    if (btn) btn.onclick = signIn;
  }

  window.ComposeAuth = {
    init: init,
    isAdmin: isAdmin,
    isAuthed: isAuthed,
    ownerToolsBlocked: ownerToolsBlocked,
    signIn: signIn,
    signOut: signOut,
    get user() { return state.user; },
    get profile() { return state.profile; },
    get ready() { return state.ready; }
  };
})();
