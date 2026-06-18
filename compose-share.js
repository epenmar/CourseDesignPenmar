// compose-share.js — Track C C2: share-token plumbing.
//
// DORMANT unless window.COMPOSE_SHARE_TOKENS_ENABLED === true. While off:
//   - the dashboard appends no token to links (tokenParam returns '')
//   - the worksheet does not redeem (applyWorksheetToken is a no-op)
// so behaviour is identical to today and the live faculty flow is untouched.
//
// When on:
//   Dashboard side: prime(courseId) mints/fetches a stable token per (course,role)
//     and caches it; tokenParam(courseId, role) returns "&t=<token>" for links.
//   Worksheet side: applyWorksheetToken() redeems a ?t= token (anon visitors only)
//     into a course-scoped Supabase session, swapping window._sbClient so existing
//     .from(...) calls are RLS-scoped to that course.
(function () {
  function enabled() { return !!window.COMPOSE_SHARE_TOKENS_ENABLED; }
  var _cache = {}; // courseId -> { instructor, reviewer }

  function _randomToken() {
    try {
      return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
    } catch (e) {
      return String(Date.now()) + Math.floor(Math.random() * 1e16).toString(16);
    }
  }

  async function _ensure(courseId, ownerId, role) {
    var sb = window._sbClient;
    if (!sb) return;
    try {
      var sel = await sb.from("coursecompose_share_tokens")
        .select("token,revoked").eq("course_id", courseId)
        .eq("owner_id", ownerId).eq("role", role).maybeSingle();
      if (sel && sel.data && !sel.data.revoked) { _cache[courseId][role] = sel.data.token; return; }
      var token = _randomToken();
      var ins = await sb.from("coursecompose_share_tokens")
        .upsert({ course_id: courseId, owner_id: ownerId, role: role, token: token },
                { onConflict: "course_id,owner_id,role" })
        .select("token").maybeSingle();
      _cache[courseId][role] = (ins && ins.data && ins.data.token) || token;
    } catch (e) { console.warn("[compose-share] ensure failed:", e && e.message); }
  }

  // Mint/fetch this course's instructor + reviewer tokens into the cache so
  // tokenParam() can append them synchronously when links are copied.
  async function prime(courseId) {
    if (!enabled() || !courseId) return;
    var owner = window.ComposeAuth && window.ComposeAuth.user;
    if (!owner || !owner.id) return;
    if (_cache[courseId] && _cache[courseId].instructor && _cache[courseId].reviewer) return;
    _cache[courseId] = _cache[courseId] || {};
    await Promise.all(["instructor", "reviewer"].map(function (role) {
      return _ensure(courseId, owner.id, role);
    }));
  }

  function tokenParam(courseId, role) {
    if (!enabled()) return "";
    var t = _cache[courseId] && _cache[courseId][role];
    return t ? ("&t=" + encodeURIComponent(t)) : "";
  }

  async function redeem(token) {
    var base = window.SUPABASE_URL;
    var key = window.SUPABASE_PUBLISHABLE_KEY;
    if (!base) return null;
    try {
      var resp = await fetch(base + "/functions/v1/redeem-share-token", {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": key, "Authorization": "Bearer " + key },
        body: JSON.stringify({ token: token }),
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) { console.warn("[compose-share] redeem failed:", e && e.message); return null; }
  }

  // Worksheet boot: if this is an anonymous visit carrying ?t=, redeem it and
  // point _sbClient at the course-scoped session. Logged-in IDs skip this (their
  // own session already grants owner access). Returns true if a scope was applied.
  async function applyWorksheetToken() {
    if (!enabled()) return false;
    if (window.ComposeAuth && window.ComposeAuth.user) return false;
    var t;
    try { t = new URLSearchParams(window.location.search).get("t"); } catch (e) { return false; }
    if (!t) return false;
    var r = await redeem(t);
    if (!r || !r.access_token) return false;
    try {
      window._sbClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY, {
        global: { headers: { Authorization: "Bearer " + r.access_token } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      window._composeShareSession = r;
      return true;
    } catch (e) { console.warn("[compose-share] apply failed:", e && e.message); return false; }
  }

  window.ComposeShare = {
    enabled: enabled,
    prime: prime,
    tokenParam: tokenParam,
    redeem: redeem,
    applyWorksheetToken: applyWorksheetToken,
  };
})();
