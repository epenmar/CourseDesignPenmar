// compose-grants.js — identity-based course access grants (the "single-URL
// Google login" model).
//
// Where compose-share.js mints a SECRET LINK that an anonymous browser redeems,
// this records a durable grant keyed to a PERSON's ASU email: "<email> may act
// as <role> on <course>." When that person later signs in with Google, the
// database recognizes them by email (cc_grant_role) and shows them their course.
//
// Reads/writes the `course_grants` table as the signed-in owner. RLS only lets
// an owner manage grants for courses they own, so this is safe from the browser.
//
// DORMANT unless window.COMPOSE_IDENTITY_GRANTS_ENABLED !== false AND an owner is
// signed in. Writing a grant is purely additive — it can only ever GIVE a named
// person access; it never affects the existing secret-link flow.
(function () {
  function enabled() {
    return window.COMPOSE_IDENTITY_GRANTS_ENABLED !== false;
  }
  function _client() { return window._sbClient || null; }
  function _ownerId() {
    return (window.ComposeAuth && window.ComposeAuth.user && window.ComposeAuth.user.id) || null;
  }
  function _norm(email) { return String(email || '').trim().toLowerCase(); }

  // Grant <email> access to <courseId> as 'instructor' or 'reviewer'.
  // Re-granting a revoked email re-activates it (upsert on the unique key).
  // Returns { ok, error } — never throws.
  async function grant(courseId, email, role) {
    if (!enabled()) return { ok: false, error: 'identity grants disabled' };
    var sb = _client(); var owner = _ownerId();
    email = _norm(email);
    if (!sb) return { ok: false, error: 'no supabase client' };
    if (!owner) return { ok: false, error: 'sign in on the dashboard first' };
    if (!courseId || !email || (role !== 'instructor' && role !== 'reviewer')) {
      return { ok: false, error: 'missing course/email/role' };
    }
    try {
      var resp = await sb.from('course_grants').upsert({
        email: email, course_id: courseId, owner_id: owner,
        role: role, granted_by: owner, revoked: false
      }, { onConflict: 'email,course_id,role' }).select('id').maybeSingle();
      if (resp && resp.error) return { ok: false, error: resp.error.message };
      return { ok: true, id: resp && resp.data && resp.data.id };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  // All active grants for a course (owner view). Returns [] on any failure so the
  // dashboard render never breaks.
  async function list(courseId) {
    if (!enabled() || !courseId) return [];
    var sb = _client(); if (!sb || !_ownerId()) return [];
    try {
      var resp = await sb.from('course_grants')
        .select('id,email,role,revoked,created_at')
        .eq('course_id', courseId).eq('revoked', false)
        .order('role', { ascending: true }).order('created_at', { ascending: true });
      if (resp && resp.error) { console.warn('[compose-grants] list:', resp.error.message); return []; }
      return (resp && resp.data) || [];
    } catch (e) { console.warn('[compose-grants] list failed:', e && e.message); return []; }
  }

  // Remove a grant (hard delete — the row is recreatable by re-granting).
  async function revoke(grantId) {
    if (!enabled() || !grantId) return false;
    var sb = _client(); if (!sb || !_ownerId()) return false;
    try {
      var resp = await sb.from('course_grants').delete().eq('id', grantId);
      return !(resp && resp.error);
    } catch (e) { console.warn('[compose-grants] revoke failed:', e && e.message); return false; }
  }

  // ----- Worksheet (grantee) side: "what may I, the signed-in person, access?" -----
  function _myEmail() {
    return ((window.ComposeAuth && window.ComposeAuth.user && window.ComposeAuth.user.email) || '')
      .trim().toLowerCase();
  }

  // The signed-in person's grant role on one course, or null. Filtered to my own
  // email so an owner viewing their own course doesn't read as a "grantee".
  async function myGrantFor(courseId) {
    if (!enabled() || !courseId) return null;
    var sb = _client(); var email = _myEmail();
    if (!sb || !email) return null;
    try {
      var resp = await sb.from('course_grants').select('role')
        .eq('course_id', courseId).eq('email', email).eq('revoked', false)
        .limit(1).maybeSingle();
      if (resp && resp.data && resp.data.role) return { role: resp.data.role };
    } catch (e) { console.warn('[compose-grants] myGrantFor failed:', e && e.message); }
    return null;
  }

  // Every course the signed-in person has been granted (for the sign-in picker).
  async function myCourses() {
    if (!enabled()) return [];
    var sb = _client(); var email = _myEmail();
    if (!sb || !email) return [];
    try {
      var resp = await sb.from('course_grants').select('course_id,role')
        .eq('email', email).eq('revoked', false).order('course_id', { ascending: true });
      return (resp && resp.data) || [];
    } catch (e) { console.warn('[compose-grants] myCourses failed:', e && e.message); return []; }
  }

  window.ComposeGrants = {
    enabled: enabled,
    grant: grant,
    list: list,
    revoke: revoke,
    myGrantFor: myGrantFor,
    myCourses: myCourses,
  };
})();
