// compose-worksheet-login.js — the "single-URL Google login" gate for the worksheet.
//
// The new faculty model: instead of a per-person secret link, a faculty member
// opens ONE plain worksheet URL, signs in with their ASU Google account, and is
// shown only the course(s) they've been granted. Their role (edit vs comment-only)
// comes from the grant, not the URL.
//
// DORMANT unless window.COMPOSE_IDENTITY_LOGIN_ENABLED === true (or ?identitylogin=1
// for a single load). While off, gate() is a no-op and the worksheet behaves
// exactly as today (anonymous + ?t= share-token flow untouched). The gate is also
// skipped whenever a ?t= token is present, so existing secret links keep working
// side-by-side during the transition.
//
// Decision tree for a load (when enabled and no ?t= token):
//   not signed in            -> show "Sign in with ASU Google" gate (blocks)
//   signed-in owner/admin     -> proceed normally (the ID working on their course)
//   signed-in faculty w/ grant-> proceed with the grant's identity (name + role)
//   signed-in, no grant here  -> show a picker of their granted courses (blocks)
(function () {
  var MAROON = '#8c1d40';

  function enabled() {
    if (window.COMPOSE_IDENTITY_LOGIN_ENABLED === true) {
      try {
        var v = new URLSearchParams(window.location.search).get('identitylogin');
        if (v === '0') return false;
      } catch (e) {}
      return true;
    }
    try {
      return new URLSearchParams(window.location.search).get('identitylogin') === '1';
    } catch (e) { return false; }
  }

  function _user() { return (window.ComposeAuth && window.ComposeAuth.user) || null; }
  function signIn() { if (window.ComposeAuth) window.ComposeAuth.signIn(); }
  function switchAccount() { if (window.ComposeAuth) window.ComposeAuth.signOut(); } // signOut reloads → gate re-shows

  // True for the course's owning ID (any ID, not just Elisa) or a system admin —
  // they get the full ID experience, never the faculty gate.
  async function _ownerOrAdmin(courseId) {
    if (window.ComposeAuth && window.ComposeAuth.isAdmin && window.ComposeAuth.isAdmin()) return true;
    var sb = window._sbClient; var u = _user();
    if (!sb || !u || !courseId) return false;
    try {
      var r = await sb.from('worksheets').select('owner_id').eq('course_id', courseId).maybeSingle();
      return !!(r && r.data && r.data.owner_id === u.id);
    } catch (e) { return false; }
  }

  // Resolve the gate for this load. Returns { identity, blocked }.
  async function gate(courseId) {
    if (!enabled()) return { identity: null, blocked: false };
    if (!_user()) { _renderSignInGate(); return { identity: null, blocked: true }; }
    if (await _ownerOrAdmin(courseId)) return { identity: null, blocked: false };

    if (courseId && window.ComposeGrants) {
      var g = await window.ComposeGrants.myGrantFor(courseId);
      if (g) {
        var u = _user();
        var name = (window.ComposeAuth.profile && window.ComposeAuth.profile.full_name) ||
                   (u.email ? u.email.split('@')[0] : 'Faculty');
        return { identity: { name: name, role: g.role }, blocked: false };
      }
    }
    // Signed in but not granted THIS course (or no course in the URL): offer a
    // picker of the courses they can access.
    var courses = window.ComposeGrants ? await window.ComposeGrants.myCourses() : [];
    // No course requested + exactly one grant → open it directly.
    if (!courseId && courses.length === 1) {
      _go(courses[0].course_id);
      return { identity: null, blocked: true };
    }
    _renderPicker(courseId, courses);
    return { identity: null, blocked: true };
  }

  function _go(courseId) {
    try {
      var p = new URLSearchParams(window.location.search);
      p.set('course', courseId);
      window.location.replace(window.location.pathname + '?' + p.toString());
    } catch (e) { window.location.href = 'course-worksheet-v2.html?course=' + encodeURIComponent(courseId); }
  }

  // ---------- overlays ----------
  function _overlay(innerHtml) {
    var existing = document.getElementById('compose-ws-login-gate');
    if (existing) existing.remove();
    var d = document.createElement('div');
    d.id = 'compose-ws-login-gate';
    d.style.cssText = 'position:fixed; inset:0; background:#faf8f5; z-index:2147483600; display:flex; ' +
      'flex-direction:column; align-items:center; justify-content:center; font-family:Inter,system-ui,sans-serif; padding:24px;';
    d.innerHTML = innerHtml;
    document.body.appendChild(d);
    return d;
  }

  function _renderSignInGate() {
    var d = _overlay(
      '<div style="text-align:center; max-width:400px;">' +
        '<img src="asu-edplus-logo.png" alt="ASU EdPlus" style="width:210px; max-width:80%; height:auto; display:block; margin:0 auto 22px;" />' +
        '<h1 style="color:' + MAROON + '; font-size:26px; margin:0 0 6px;">Course<span style="background:#FFC627; color:' + MAROON + '; padding:0 6px; border-radius:2px;">Compose</span></h1>' +
        '<p style="color:#666; margin:0 0 24px; font-size:14px; line-height:1.5;">Sign in with your ASU Google account to open your course worksheet.</p>' +
        '<button id="compose-ws-login-btn" style="background:' + MAROON + '; color:#fff; border:none; ' +
        'padding:12px 24px; border-radius:8px; font-size:15px; cursor:pointer;">Sign in with ASU Google</button>' +
      '</div>'
    );
    var btn = d.querySelector('#compose-ws-login-btn');
    if (btn) btn.onclick = signIn;
  }

  function _renderPicker(requestedCourse, courses) {
    var roleLabel = { instructor: 'Edit access', reviewer: 'Comment only' };
    var body;
    // When they came in on a specific course they can't open, offer to request it.
    var requestBlock = requestedCourse
      ? '<div id="ws-req-block" style="margin:0 0 16px;">' +
          '<button id="ws-req-btn" style="background:' + MAROON + '; color:#fff; border:none; padding:10px 18px; ' +
            'border-radius:8px; font-size:14px; cursor:pointer;">Request access to ' +
            String(requestedCourse).toUpperCase().replace(/</g, '&lt;') + '</button>' +
          '<div id="ws-req-msg" style="font-size:12px; color:#666; margin-top:8px; min-height:14px;"></div>' +
        '</div>'
      : '';
    if (!courses || !courses.length) {
      body = '<p style="color:#666; margin:0 0 16px; font-size:14px; line-height:1.5;">' +
        'You don’t have access to a course worksheet yet.' +
        (requestedCourse ? ' You can request it below, or ask' : ' Ask') +
        ' your instructional designer to add you.</p>' + requestBlock;
    } else {
      var note = requestedCourse
        ? '<p style="color:#a33; margin:0 0 16px; font-size:13px;">You don’t have access to that course. Choose one you can open:</p>'
        : '<p style="color:#666; margin:0 0 16px; font-size:14px;">Choose a course to open:</p>';
      var items = courses.map(function (c) {
        var code = String(c.course_id || '').toUpperCase().replace(/</g, '&lt;');
        return '<button class="compose-ws-course" data-course="' + encodeURIComponent(c.course_id) + '" ' +
          'style="display:flex; justify-content:space-between; align-items:center; width:100%; text-align:left; ' +
          'padding:12px 16px; margin:0 0 8px; border:1px solid #e6dfd6; border-radius:8px; background:#fff; ' +
          'cursor:pointer; font-size:14px; font-family:inherit;">' +
          '<span style="font-weight:600; color:#333;">' + code + '</span>' +
          '<span style="color:#999; font-size:12px;">' + (roleLabel[c.role] || c.role) + '</span>' +
        '</button>';
      }).join('');
      body = note + requestBlock + '<div style="max-height:50vh; overflow:auto;">' + items + '</div>';
    }
    var d = _overlay(
      '<div style="text-align:center; max-width:420px; width:100%;">' +
        '<h1 style="color:' + MAROON + '; font-size:22px; margin:0 0 14px;">Your Courses</h1>' +
        body +
        '<button id="compose-ws-switch" style="margin-top:18px; background:none; border:none; color:#888; ' +
        'font-size:12px; cursor:pointer; text-decoration:underline;">Use a different account</button>' +
      '</div>'
    );
    Array.prototype.forEach.call(d.querySelectorAll('.compose-ws-course'), function (b) {
      b.onclick = function () { _go(decodeURIComponent(b.getAttribute('data-course'))); };
    });
    var sw = d.querySelector('#compose-ws-switch');
    if (sw) sw.onclick = switchAccount;
    var reqBtn = d.querySelector('#ws-req-btn');
    if (reqBtn) reqBtn.onclick = async function () {
      var msg = d.querySelector('#ws-req-msg');
      reqBtn.disabled = true;
      if (msg) { msg.style.color = '#666'; msg.textContent = 'Sending…'; }
      var res = window.ComposeGrants ? await window.ComposeGrants.requestAccess(requestedCourse) : { ok: false, error: 'unavailable' };
      if (res && res.ok) {
        reqBtn.style.display = 'none';
        if (msg) { msg.style.color = '#2e7d32'; msg.textContent = '✓ Request sent to your course designer. You’ll get access once they approve it.'; }
      } else {
        reqBtn.disabled = false;
        if (msg) { msg.style.color = '#c0392b'; msg.textContent = 'Could not send: ' + ((res && res.error) || 'unknown error'); }
      }
    };
  }

  // ---------- masquerade / preview-as ----------
  // A thin banner so the owner never forgets they're viewing AS faculty (edits
  // save to the real course). "Exit preview" reloads the same URL without ?as=.
  function showMasqueradeBanner(role) {
    if (document.getElementById('compose-masq-banner')) return;
    var isReviewer = role === 'reviewer';
    var label = isReviewer ? 'Reviewer (comment-only view)' : 'Faculty (edit view)';
    var bar = document.createElement('div');
    bar.id = 'compose-masq-banner';
    bar.style.cssText = 'position:fixed; top:0; left:0; right:0; z-index:2147483000; background:' + MAROON +
      '; color:#fff; font-family:Inter,system-ui,sans-serif; font-size:12px; padding:5px 14px; ' +
      'display:flex; align-items:center; justify-content:center; gap:14px; box-shadow:0 1px 4px rgba(0,0,0,0.2);';
    var exitHref;
    try {
      var p = new URLSearchParams(window.location.search); p.delete('as');
      exitHref = window.location.pathname + (p.toString() ? '?' + p.toString() : '');
    } catch (e) { exitHref = window.location.pathname; }
    bar.innerHTML =
      '<span>👁 Previewing as <strong>' + label + '</strong>' +
      (isReviewer ? '' : ' — your edits save to the live course') + '</span>' +
      '<a href="' + exitHref + '" style="color:#fff; text-decoration:underline; white-space:nowrap;">Exit preview</a>';
    document.body.appendChild(bar);
    // Nudge the page down so the banner doesn't cover the top of the worksheet.
    try { document.body.style.paddingTop = ((parseInt(getComputedStyle(document.body).paddingTop) || 0) + 28) + 'px'; } catch (e) {}
  }

  // ---------- invite / add user (header 👤 button) ----------
  // Owner/admin only: reveal the 👤 button and wire its dropdown so the course's
  // ID can grant a faculty member or reviewer access (by ASU email) without going
  // back to the dashboard. Writes an identity grant via ComposeGrants; RLS lets
  // only an owner/admin do this, so the button stays hidden for everyone else.
  var _inviteCourseId = null;

  async function setupInvite(courseId) {
    _inviteCourseId = courseId;
    var btn = document.getElementById('ws-invite-btn');
    if (!btn || !window.ComposeGrants || !window.ComposeGrants.enabled()) return;
    var ok = false;
    try { ok = await _ownerOrAdmin(courseId); } catch (e) {}
    if (ok) btn.style.display = '';
  }

  function toggleInvite() {
    var existing = document.getElementById('ws-invite-pop');
    if (existing) { existing.remove(); return; }
    var anchor = document.getElementById('ws-invite-btn');
    if (!anchor) return;
    var pop = document.createElement('div');
    pop.id = 'ws-invite-pop';
    pop.style.cssText = 'position:absolute; top:100%; right:0; margin-top:6px; z-index:200; background:#fff; ' +
      'color:#333; border:1px solid #e0ddd5; border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,0.18); ' +
      'padding:12px; width:250px; font-family:Inter,system-ui,sans-serif;';
    pop.innerHTML =
      '<div style="font-size:12px; font-weight:600; color:' + MAROON + '; margin-bottom:8px;">Invite / add a user</div>' +
      '<input id="ws-invite-email" type="email" placeholder="name@asu.edu" style="width:100%; box-sizing:border-box; ' +
        'padding:7px 9px; border:1px solid #ddd; border-radius:6px; font-size:12px; margin-bottom:6px;" />' +
      '<select id="ws-invite-role" style="width:100%; box-sizing:border-box; padding:7px 9px; border:1px solid #ddd; ' +
        'border-radius:6px; font-size:12px; margin-bottom:8px;">' +
        '<option value="instructor">Faculty — can edit</option>' +
        '<option value="reviewer">Reviewer — comment only</option>' +
      '</select>' +
      '<button id="ws-invite-send" style="width:100%; background:' + MAROON + '; color:#fff; border:none; ' +
        'padding:8px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">Grant access</button>' +
      '<div id="ws-invite-msg" style="font-size:11px; margin-top:7px; min-height:14px; color:#666;"></div>';
    var wrap = anchor.parentElement; // #ws-header-icons (position:relative chain on sidebar-header)
    wrap.style.position = wrap.style.position || 'relative';
    wrap.appendChild(pop);
    var emailEl = pop.querySelector('#ws-invite-email');
    if (emailEl) emailEl.focus();
    pop.querySelector('#ws-invite-send').onclick = async function () {
      var email = (emailEl.value || '').trim();
      var role = pop.querySelector('#ws-invite-role').value;
      var msg = pop.querySelector('#ws-invite-msg');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.style.color = '#c0392b'; msg.textContent = 'Enter a valid email.'; return; }
      msg.style.color = '#666'; msg.textContent = 'Saving…';
      var res = await window.ComposeGrants.grant(_inviteCourseId, email, role);
      if (res && res.ok) {
        msg.style.color = '#2e7d32';
        msg.textContent = '✓ ' + email + ' can now sign in with ASU Google.';
        emailEl.value = '';
      } else {
        msg.style.color = '#c0392b';
        msg.textContent = 'Could not add: ' + ((res && res.error) || 'unknown error');
      }
    };
  }

  window.ComposeWorksheetLogin = {
    enabled: enabled,
    gate: gate,
    signIn: signIn,
    isOwnerOrAdmin: _ownerOrAdmin,
    showMasqueradeBanner: showMasqueradeBanner,
    setupInvite: setupInvite,
    toggleInvite: toggleInvite,
  };
})();
