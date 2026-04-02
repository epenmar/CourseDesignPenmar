# Changelog

All notable changes to the Course Development Tool are documented here.
Format follows [Semantic Versioning](https://semver.org/).

---

## [1.3.0] — 2026-04-02

### UX Refinements & CLO-to-ELO Split
- **CLO-to-ELO One-to-Many** — each CLO can now map to multiple ELOs with sub-labels (1a, 1b, etc.), add/remove individual ELOs per CLO
- **Materials Overview** — type selector dropdown, inline content layout, table view, delete button
- **Assignments Overview** — delete button, editable table view with objective tagging
- **Module Overview** — table view with editable MLOs
- **Module Pages** — inline content toggle (same pattern as overview pages)
- **Fix: template visibility** — all four templates were showing at once (missing CSS rule)
- **Fix: materials table view** — prefix mismatch causing toggle to fail
- **Accessibility tip** — updated wording for slide presentations

---

## [1.2.0] — 2026-04-02

### Overview Enhancements & Quiz Builder
- **Accordion collapse fix** — cards stay open when adding activity
- **Cross-container text highlighting** — TreeWalker approach for multi-element selection
- **Interactive objective picker** — tag activities with CLOs/ELOs in assignment overview
- **Hover tooltips** — full objective text on chips
- **Course objectives accordion** — CLO/ELO reference at top of assignments page
- **Module MLO accordion** — inside each overview card
- **Inline content expansion** — upload/link/template in both overview pages
- **Template dropdown** — Discussion, Assignment, Quiz, Blank Page
- **Google Drive export** — on all templates
- **Quiz builder** — interactive MC/TF/short-answer with correct toggle and feedback
- **AI quiz generation** — via Claude API
- **AI rubric generation** — Canvas-compatible format
- **Discussion rubrics** — rubric section added to discussion template
- **Accessibility tips** — PowerPoint vs PDF guidance on all upload zones

---

## [1.1.0] — 2026-04-02

### Data Model & Overview Views
- **Activity/Material Data Model** — activities and materials are now stored as structured data in localStorage (`courseActivities`, `courseMaterials`), enabling cross-module operations and multiple views
- **Assignments Overview** — new view showing all activities across all modules with card/table toggle, cross-module drag-and-drop, inline editing
- **Materials Overview** — new view showing all learning materials across all modules with card/table toggle, cross-module drag-and-drop
- **Dynamic Rendering** — module detail activities and materials now render from data model instead of hardcoded HTML
- **Cross-Module Drag & Drop** — drag activities or materials between modules in overview views
- **Tab Bug Fix** — fixed `switchAttachTab()` nesting issue with material wrappers
- **Content Accordion** — activity content accordions default to collapsed in all views

---

## [1.0.0] — 2026-04-02

### Initial Release
- **ID Dashboard** — course management with status tracking, progress bars, upcoming deadlines
- **Course Worksheet** — multi-section course development tool (course info, CLOs/ELOs, module overview, module detail with activities/materials, textbooks, course context, document preview)
- **Inline Commenting** — Supabase-powered commenting with text highlighting, URL-based auto-identity (`?user=`), comment threads, resolve/delete
- **AI Design Assistant** — Anthropic API integration for course design guidance
- **Send Worksheet Link** — mailto generation for instructor onboarding
- **Document Export** — download as .doc, export to Google Drive
- **GitHub Pages Deployment** — Actions workflow for static hosting
- **Custom Favicon** — ASU burgundy "ID" monogram

### Bug Fixes (from Tamara touch base)
- Fix text entry tabs in activity content areas
- Fix add activity button (missing handler and function)
- Fix comments not posting to Supabase
- Fix export/download document (was alert placeholder)
- Fix textbook field not populating from config for MNS 521
- Fix comment text persisting in input field via localStorage
- Fix highlight styling (subtle dashed underline instead of yellow background)
- Enable commenting on text inside input/textarea fields
- Remove misleading placeholder from comment identity modal
