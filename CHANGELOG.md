# Changelog

All notable changes to the Course Development Tool are documented here.
Format follows [Semantic Versioning](https://semver.org/).

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
