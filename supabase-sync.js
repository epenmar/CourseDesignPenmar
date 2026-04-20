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
    'dashboard_resource_links', 'dashboard_comments_seen',
    'id_profile', 'meetingAssignments', 'meeting_action_items_state',
    'privateNotes', 'course_airtable_urls', 'course_jira_epics'
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
      var { error } = await sb.from('dashboard_state').upsert(dsRows, { onConflict: 'key' });
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
        var v = typeof row.data === 'string' ? row.data : JSON.stringify(row.data);
        localStorage.setItem(row.key, v);
      });
      pulled.dashboardState = dsData.length;
    }

    var { data: ucData, error: ucErr } = await sb.from('user_courses').select('course_id, data');
    if (ucErr) errors.push('user_courses: ' + ucErr.message);
    else if (ucData) {
      var merged = {};
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

  window.SupabaseSync = {
    pushAllToCloud: pushAllToCloud,
    pullAllFromCloud: pullAllFromCloud,
    cloudHasData: cloudHasData,
    client: sb
  };
})();
