// course-compose-spec.js
//
// The versioned contract between CourseCompose (the faculty worksheet)
// and CanvasCurate (the downstream Canvas builder). Produces a single
// structured JSON object that captures everything the worksheet has
// collected about a course: info, objectives, modules, activities,
// materials, alignment, AI-fill preferences, file manifest, and
// review state.
//
// The shape of this object IS the contract. Curate reads `format` to
// pick the right ingestion path; CourseCompose always emits the latest
// version. If we evolve the schema, Curate handles version detection.
//
// ============================================================
//   SCHEMA — coursecompose/v1.0
// ============================================================
//   {
//     format: 'coursecompose/v1.0',
//     generatedAt: <ISO timestamp>,
//     generatedBy: <name or null>,
//
//     course: {
//       code, name, fullTitle, session, sessionShort, sessionValue,
//       credits, prerequisites, college, program,
//       instructor, instructorEmail, instructionalDesigner,
//       driveFolder, textbook, moduleCount, moduleStartZero
//     },
//
//     courseContext: { ctx-audience, ctx-prereqs, ctx-role, … ctx-support },
//
//     objectives: {
//       clos:  [<string>, …],
//       elos:  [<string>, …],
//       cloEloAlignment: [<array of int>, …],  // ELO index → array of CLO indices
//       eloMloAlignment: { '<eloIdx>': ['<mloId>', …] }
//     },
//
//     modules: [
//       {
//         number, topic, mlos: [<string>, …],
//         activities: [
//           {
//             id, name, type, points, due,
//             objectives: ['<mloId or CEPH X>', …],
//             contentComplete: <bool>,         // user-confirmed: this activity is done
//             richText: '<html>',              // free-form notes
//             links: [<string>, …],
//             attachedFiles: [<file ref>, …],
//             linkedMaterialIds: [<id>, …],
//             templateData: {                  // per-template HTML sections
//               assignment:  { Overview, Instructions, Rubric, … },
//               discussion:  { Overview, 'Discussion Prompt', Rubric, … },
//               quiz:        { Overview, Instructions, … },
//               blank:       { … }
//             },
//             aiFillPrefs: {                   // last-used AI Fill prefs
//               tool, toolCustom, customNotes,
//               autograde: { enabled, minWords, peerReplies, replyWords, reactions, other },
//               rubric:    { style, rows, levels, criteria }
//             }
//           }, …
//         ],
//         materials: [
//           {
//             id, type, title,
//             objectives: ['<mloId or CEPH X>', …],
//             richText: '<html>',
//             links: [<string>, …],
//             attachedFiles: [<file ref>, …],
//             linkedActivityIds: [<id>, …],    // computed from activities
//             notes: '<string>'
//           }, …
//         ]
//       }, …
//     ],
//
//     assignmentWeights: [ { category, weight, items }, … ],
//     gradingPolicy:     [ { label, lowPct, highPct }, … ],
//
//     timeline: {
//       milestoneDates: { '<index>': '<YYYY-MM-DD>', … },
//       milestonesCompleted: { '<index>': true, … }
//     },
//
//     reviewStatus: {
//       mlosReviewed, assignmentsReviewed, courseMappingApproved
//     },
//
//     progressPct: <number 0..100>,
//
//     // Flat list of every file/link/iframe the build tool needs to
//     // resolve. Walking this once is cheaper than re-traversing the
//     // modules tree on Curate's side, and dedupe is handled here.
//     manifest: [
//       {
//         ref:       'mat-456/file-0',     // stable reference within this spec
//         kind:      'file' | 'link' | 'iframe',
//         ownerType: 'activity' | 'material',
//         ownerId:   '<activity or material id>',
//         moduleNum: <int>,
//         filename:  '<string, present for file>',
//         mimeType:  '<string, present for file>',
//         sizeBytes: <int, present for file>,
//         driveUrl:  '<string, present for file/link>',
//         url:       '<string, present for link/iframe>',
//         title:     '<string, optional>'
//       }, …
//     ]
//   }
// ============================================================

(function() {
  'use strict';

  var SPEC_VERSION = 'coursecompose/v1.0';

  // Pull the same data the worksheet renders from — activeCourse (the
  // in-memory snapshot loaded from hardcoded config + cloud overrides),
  // localStorage fields, and the module/material/activity stores. We
  // re-read on every call so the spec always reflects the latest state.
  function build() {
    var c = (typeof activeCourse !== 'undefined' ? activeCourse : null) || {};
    var loadField = (typeof window.loadField === 'function') ? window.loadField : function() { return null; };
    var courseActivities = (typeof window.courseActivities !== 'undefined') ? window.courseActivities : {};
    var courseMaterials = (typeof window.courseMaterials !== 'undefined') ? window.courseMaterials : {};

    var savedClos = (loadField('clos') || c.clos || []).filter(function(s) { return s && String(s).trim(); });
    var savedElos = (loadField('flatElos') || c.flatElos || []).filter(function(s) { return s && String(s).trim(); });
    var modOverview = loadField('moduleOverviewData') || {};
    var startN = c.moduleStartZero ? 0 : 1;
    var modCount = c.moduleCount || (c.modules || []).length || 7;

    // Walk modules. For each module collect its MLOs, activities, materials.
    // Skip pure cruft: empty MLOs / objectives entries.
    var modules = [];
    var manifest = [];

    for (var i = 0; i < modCount; i++) {
      var modNum = i + startN;
      var saved = modOverview[modNum] || {};
      var fromCfg = (c.modules || [])[i] || {};
      var mlos = (saved.mlos && saved.mlos.length ? saved.mlos : (fromCfg.mlos || []))
        .filter(function(s) { return s && String(s).trim(); });
      var topic = saved.topic || fromCfg.title || '';

      // ---- Activities ----
      var modActs = (courseActivities[modNum] || []).map(function(a) {
        var aid = a.id;
        var attached = (a.attachedFiles || []).slice();
        var actLinks = (a.links || []).slice();
        // Lazy-create a stable per-activity edit token. This is the
        // shared secret the iframe / SCORM source uses to gate edit
        // mode for ID + faculty (vs. read-only for students). Tokens
        // live on the activity itself so they survive across exports
        // and round-trips; we persist back on `a` so subsequent
        // saveActivityData() flushes pick it up.
        if (!a.editToken) a.editToken = _mintToken();

        // Manifest entries for this activity's files + links.
        attached.forEach(function(f, idx) {
          manifest.push(_fileManifestEntry(f, idx, 'activity', aid, modNum));
        });
        actLinks.forEach(function(url, idx) {
          if (!url) return;
          manifest.push({
            ref: aid + '/link-' + idx,
            kind: 'link',
            ownerType: 'activity',
            ownerId: aid,
            moduleNum: modNum,
            url: String(url)
          });
        });

        return {
          id: aid,
          name: a.name || '',
          type: a.contentType || 'assignment',
          points: a.points || '',
          due: a.due || '',
          objectives: (a.objectives || []).slice(),
          contentComplete: !!a.contentComplete,
          editToken: a.editToken,
          richText: a.richText || '',
          links: actLinks,
          attachedFiles: attached,
          linkedMaterialIds: (a.linkedMaterialIds || []).slice(),
          templateData: a.templateData ? _cloneJson(a.templateData) : {},
          aiFillPrefs: a.aiFillPrefs ? _cloneJson(a.aiFillPrefs) : null
        };
      });

      // ---- Materials ----
      var modMats = (courseMaterials[modNum] || []).map(function(m) {
        var mid = m.id;
        var attached = (m.attachedFiles || []).slice();
        var matLinks = (m.links || []).slice();

        // Compute linkedActivityIds by scanning every module's activities.
        // Single source of truth lives on the activity; surfaced here for
        // consumers (Curate) that walk materials first when building Files.
        var linkedActivityIds = [];
        Object.keys(courseActivities || {}).forEach(function(mk) {
          (courseActivities[mk] || []).forEach(function(act) {
            if (Array.isArray(act.linkedMaterialIds) && act.linkedMaterialIds.indexOf(mid) !== -1) {
              linkedActivityIds.push(act.id);
            }
          });
        });

        attached.forEach(function(f, idx) {
          manifest.push(_fileManifestEntry(f, idx, 'material', mid, modNum, m.title));
        });
        matLinks.forEach(function(url, idx) {
          if (!url) return;
          manifest.push({
            ref: mid + '/link-' + idx,
            kind: 'link',
            ownerType: 'material',
            ownerId: mid,
            moduleNum: modNum,
            url: String(url),
            title: m.title || ''
          });
        });

        return {
          id: mid,
          type: m.type || 'Reading',
          title: m.title || '',
          objectives: (m.objectives || []).slice(),
          richText: m.richText || '',
          links: matLinks,
          attachedFiles: attached,
          linkedActivityIds: linkedActivityIds,
          notes: m.notes || ''
        };
      });

      modules.push({
        number: modNum,
        topic: topic,
        mlos: mlos,
        activities: modActs,
        materials: modMats
      });
    }

    // Course Context & Design Notes captures (audience, fit, learning goals,
    // design vision/pacing, constraints, assets/support). Order matches the
    // worksheet's view-additional grouping and the parser's contextFieldIds.
    var formData = loadField('formData') || {};
    var contextFieldIds = ['ctx-audience', 'ctx-prereqs', 'ctx-role', 'ctx-current', 'ctx-outcomes', 'ctx-skills', 'ctx-vision', 'ctx-early', 'ctx-pacing', 'ctx-standards', 'ctx-technology', 'ctx-struggles', 'ctx-existing', 'ctx-support'];
    var courseContext = {};
    contextFieldIds.forEach(function(id) { if (formData[id]) courseContext[id] = formData[id]; });

    // Identity that generated the spec — lets Curate attribute audit info.
    var generatedBy = null;
    try {
      var identity = (typeof window.getCommentIdentity === 'function') ? window.getCommentIdentity() : null;
      generatedBy = identity && identity.name || null;
    } catch (e) {}

    return {
      format: SPEC_VERSION,
      generatedAt: new Date().toISOString(),
      generatedBy: generatedBy,
      course: {
        code: c.code || '',
        name: c.name || '',
        fullTitle: c.fullTitle || c.name || '',
        session: c.session || c.sessionShort || '',
        sessionShort: c.sessionShort || '',
        sessionValue: c.sessionValue || '',
        credits: c.credits || formData['ci-credits'] || '',
        prerequisites: c.prerequisites || formData['ci-prerequisites'] || '',
        college: c.college || '',
        program: c.program || '',
        instructor: c.instructor || '',
        instructorEmail: c.email || '',
        instructionalDesigner: c.id || '',
        driveFolder: c.driveFolder || '',
        textbook: c.textbook || formData['mat-textbook-1'] || '',
        moduleCount: modCount,
        moduleStartZero: !!c.moduleStartZero
      },
      courseContext: courseContext,
      objectives: {
        clos: savedClos,
        elos: savedElos,
        cloEloAlignment: c.cloEloAlignment || loadField('cloEloAlignment') || [],
        eloMloAlignment: c.eloMloAlignment || loadField('eloMloAlignment') || {}
      },
      modules: modules,
      assignmentWeights: loadField('assignmentWeights') || [],
      gradingPolicy: loadField('gradingPolicy') || [],
      timeline: {
        milestoneDates: loadField('timelineDates') || {},
        milestonesCompleted: loadField('milestoneManualComplete') || {}
      },
      reviewStatus: {
        mlosReviewed: !!loadField('mlosReviewed'),
        assignmentsReviewed: !!loadField('assignmentsReviewed'),
        courseMappingApproved: !!loadField('courseMappingApproved')
      },
      progressPct: loadField('completionPct') || 0,
      manifest: manifest
    };
  }

  // ---- helpers ----

  // Normalize an attached-file blob into a manifest entry. CourseCompose
  // stores files as { name, mimeType, sizeBytes, driveUrl?, dataUrl? };
  // Curate only needs the resolvable URL + metadata, so we drop dataUrl
  // (base64 payloads can balloon the spec into MB territory).
  function _fileManifestEntry(file, idx, ownerType, ownerId, moduleNum, titleHint) {
    return {
      ref: ownerId + '/file-' + idx,
      kind: 'file',
      ownerType: ownerType,
      ownerId: ownerId,
      moduleNum: moduleNum,
      filename: (file && file.name) || '',
      mimeType: (file && file.mimeType) || '',
      sizeBytes: (file && file.sizeBytes) || 0,
      driveUrl: (file && file.driveUrl) || '',
      title: titleHint || (file && file.name) || ''
    };
  }

  function _cloneJson(o) {
    try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; }
  }

  // Generate a stable random token for per-activity edit-mode gating.
  // crypto.randomUUID is widely available in the modern browsers we
  // target; the Math.random fallback is for older / sandboxed contexts
  // (jsdom etc) where the spec still needs to build without throwing.
  function _mintToken() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (e) {}
    var hex = function() { return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0'); };
    return hex() + '-' + hex() + '-' + hex() + '-' + hex();
  }

  // Public API.
  window.CourseComposeSpec = {
    VERSION: SPEC_VERSION,
    build: build
  };
})();
