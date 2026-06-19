// Supabase sync layer.
// Maps localStorage keys to/from Supabase tables.
// Manual sync for now (Phase 1). Later phases will auto-sync on every save.

(function() {
  if (!window.supabase || !window.SUPABASE_URL) {
    console.warn('[sync] Supabase client not loaded');
    return;
  }
  var sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY);
  window._sbClient = sb;

  // Which localStorage keys belong to which table
  var DASHBOARD_STATE_KEYS = [
    'inactive_courses', 'course_overrides', 'course_reviewers',
    'starred_courses', 'course_last_viewed', 'dashboard_hidden_cols',
    'dashboard_col_order', 'dashboard_filters',
    'dashboard_resource_links', 'dashboard_comments_seen',
    'id_profile', 'meetingAssignments', 'meeting_action_items_state',
    'privateNotes', 'course_airtable_urls', 'course_jira_epics',
    'course_jira_phases',
    'course_action_items', 'meeting_synced_uids', 'detail_collapsed_sections'
  ];

  function parseJson(s, fallback) {
    try { return JSON.parse(s); } catch(e) { return fallback; }
  }

  // Push all local data to Supabase
  async function pushAllToCloud() {
    var pushed = { worksheets: 0, dashboardState: 0, userCourses: 0 };
    var errors = [];

    // 1. Worksheets: one row per course
    var wsRows = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('worksheet_') === 0 && k !== 'worksheet_analytics') {
        // Skip analytics; skip migration flags
        if (k.indexOf('_migrated') !== -1) continue;
        var courseId = k.slice('worksheet_'.length);
        if (courseId.indexOf('analytics_') === 0) continue;
        var data = parseJson(localStorage.getItem(k), null);
        if (data && typeof data === 'object') {
          wsRows.push({ course_id: courseId, data: data });
        }
      }
    }
    if (wsRows.length > 0) {
      var { error } = await sb.from('worksheets').upsert(wsRows, { onConflict: 'course_id' });
      if (error) errors.push('worksheets: ' + error.message);
      else pushed.worksheets = wsRows.length;
    }

    // 2. Dashboard state: one row per key
    var dsRows = [];
    DASHBOARD_STATE_KEYS.forEach(function(k) {
      var raw = localStorage.getItem(k);
      if (raw == null) return;
      var val = parseJson(raw, raw);
      dsRows.push({ key: k, data: val });
    });
    if (dsRows.length > 0) {
      var { error } = await sb.from('dashboard_state').upsert(dsRows, { onConflict: (window.COMPOSE_DS_CONFLICT || 'key') });
      if (error) errors.push('dashboard_state: ' + error.message);
      else pushed.dashboardState = dsRows.length;
    }

    // 3. User-created courses
    var userCoursesRaw = parseJson(localStorage.getItem('user_courses'), {});
    if (userCoursesRaw && typeof userCoursesRaw === 'object') {
      var ucRows = Object.keys(userCoursesRaw).map(function(id) {
        return { course_id: id, data: userCoursesRaw[id] };
      });
      if (ucRows.length > 0) {
        var { error } = await sb.from('user_courses').upsert(ucRows, { onConflict: 'course_id' });
        if (error) errors.push('user_courses: ' + error.message);
        else pushed.userCourses = ucRows.length;
      }
    }

    return { pushed: pushed, errors: errors };
  }

  // Pull all data from Supabase and overwrite localStorage
  async function pullAllFromCloud() {
    var pulled = { worksheets: 0, dashboardState: 0, userCourses: 0 };
    var errors = [];

    var { data: wsData, error: wsErr } = await sb.from('worksheets').select('course_id, data');
    if (wsErr) errors.push('worksheets: ' + wsErr.message);
    else if (wsData) {
      wsData.forEach(function(row) {
        localStorage.setItem('worksheet_' + row.course_id, JSON.stringify(row.data));
      });
      pulled.worksheets = wsData.length;
    }

    var { data: dsData, error: dsErr } = await sb.from('dashboard_state').select('key, data');
    if (dsErr) errors.push('dashboard_state: ' + dsErr.message);
    else if (dsData) {
      dsData.forEach(function(row) {
        // starred_courses is a favorites list whose toggleStar cloud upsert is
        // fire-and-forget. A quick reload (or a failed upsert) could race it, so
        // blindly overwriting local with cloud here used to silently drop a star
        // the user had just added. Union-merge instead: cloud as base, plus any
        // local star not yet reflected in the cloud, so stars never vanish.
        if (row.key === 'starred_courses') {
          try {
            var localStars = parseJson(localStorage.getItem('starred_courses'), []) || [];
            var cloudStars = Array.isArray(row.data) ? row.data : (parseJson(row.data, []) || []);
            var union = cloudStars.slice();
            localStars.forEach(function(s) { if (union.indexOf(s) === -1) union.push(s); });
            localStorage.setItem('starred_courses', JSON.stringify(union));
            return;
          } catch (e) { /* fall through to plain overwrite */ }
        }
        var v = typeof row.data === 'string' ? row.data : JSON.stringify(row.data);
        localStorage.setItem(row.key, v);
      });
      pulled.dashboardState = dsData.length;
    }

    var { data: ucData, error: ucErr } = await sb.from('user_courses').select('course_id, data');
    if (ucErr) errors.push('user_courses: ' + ucErr.message);
    else if (ucData) {
      // Merge: start with whatever is in localStorage (preserves local-only courses
      // that were added but not yet pushed), then overlay cloud (cloud wins for
      // keys that exist in both, since cloud holds the freshest cross-device state).
      var pre = parseJson(localStorage.getItem('user_courses'), {}) || {};
      var merged = {};
      Object.keys(pre).forEach(function(k) { merged[k] = pre[k]; });
      ucData.forEach(function(row) { merged[row.course_id] = row.data; });
      localStorage.setItem('user_courses', JSON.stringify(merged));
      pulled.userCourses = ucData.length;
    }

    return { pulled: pulled, errors: errors };
  }

  // Check if cloud has any data at all (for nudging users on a fresh browser)
  async function cloudHasData() {
    var { count, error } = await sb.from('worksheets').select('*', { count: 'exact', head: true });
    if (error) return false;
    return (count || 0) > 0;
  }

  // Fire-and-forget push of a single user_courses row. Used by the dashboard
  // immediately after adding a course so it survives the next page reload
  // (otherwise the cloud pull would wipe it since it was never pushed).
  function pushUserCourse(courseId, data) {
    if (!courseId || !data) return;
    sb.from('user_courses').upsert(
      { course_id: courseId, data: data },
      { onConflict: 'course_id' }
    ).then(function(r) {
      if (r.error) console.warn('[user_courses push]', r.error.message);
    });
  }

  window.SupabaseSync = {
    pushAllToCloud: pushAllToCloud,
    pullAllFromCloud: pullAllFromCloud,
    pushUserCourse: pushUserCourse,
    cloudHasData: cloudHasData,
    client: sb
  };
})();
