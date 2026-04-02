# Changelog

All notable changes to the Course Development Tool are documented here.
Format follows [Semantic Versioning](https://semver.org/).

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
