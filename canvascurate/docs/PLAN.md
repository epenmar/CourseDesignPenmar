# CanvasColossus v2 — Build Plan

**Status:** Phase 5 is feature-complete and in closeout/stabilization; Phase 6 Transfer/Reports is functionally complete for v1.0 and in release stabilization. Editor, local and Canvas-native page revisions, source-course replacement with asset remapping, images, links, Canvas push/apply flows, editor image/file upload, advanced formatting, managed content blocks, AI writing tools, editor accessibility checks, image compression, page/assignment/discussion creation, classic quiz question editing/push guardrails, Documents/TagFlow remediation, tagged-PDF export, Canvas replacement deployment, and Course Creation outline-to-Canvas Clean draft export with confirmation/review are live. Transfer now has readiness, Curate/Create session support, target-course validation, push/copy confirmation modals, target-course push, same-course push, staged deletion support, linked assignment/activity decision syncing, classic quiz/question transfer, file/image migration counts, module restructuring operations, activity assignment-shell collapse for graded discussions/quizzes, Canvas-native copy-to-target, and post-transfer Canvas links. Reports now includes Excel exports, Faculty Review upload, active Canvas backup generation, readable transfer reports, Health Summary export, and Print/PDF preview. Remaining launch work focuses on smoke testing, production hardening, and monitoring; New Quizzes support is deferred to v1.1/v1.2 because launch usage is low and Canvas-native copy remains the safest path for those courses.
**Last updated:** 2026-05-06
**Owner:** Michael Arseneault

---

## Decisions Log

| # | Decision | Resolved |
|---|----------|----------|
| OQ1 | Design system as in-repo Tailwind config + CSS (no npm package) | ✅ 2026-04-21 |
| OQ2 | Canvas OAuth — PAT with 7-day expiry for v2 launch; OAuth post-launch | deferred |
| OQ3 | R2 cold storage prefix: `archive/sessions/{id}/` and `archive/documents/{id}/` | ✅ per DATA_MODEL.md |
| OQ4 | Admin role: `app_role` enum on `user_profiles.role` column | ✅ per DATA_MODEL.md |
| OQ5 | Primary color: #8c1d40 (ASU official maroon); Secondary: #ffc627 (ASU official gold) | ✅ 2026-04-21 |
| OQ6 | AI provider: ASU AIML Platform only (no Claude/Ollama fallback) | ✅ 2026-04-21 |

---

## Design System Canonical Tokens

Establish these once in `frontend/src/app/globals.css` via `@theme` — do not deviate in component code.

```ts
colors: {
  primary:                   "#8c1d40",  // ASU maroon — key UI, active states, CTAs
  "primary-container":       "#6e1632",  // pressed/depth variant
  "on-primary":              "#ffffff",
  secondary:                 "#ffc627",  // ASU gold — secondary actions, accents
  "secondary-container":     "#ffc627",
  "on-secondary-container":  "#191919",
  surface:                   "#ffffff",  // page canvas (Level 0)
  "surface-container-low":   "#fafafa",  // sections/sidebar (Level 1)
  "surface-container-lowest":"#ffffff",  // cards (Level 2)
  "surface-container":       "#f0f0f0",
  "surface-container-high":  "#efefef",
  "surface-dim":             "#d0d0d0",
  "on-surface":              "#191919",
  "on-surface-variant":      "#6f6f6f",
  "outline-variant":         "#efefef",
  error:                     "#ba1a1a",
  "error-container":         "#ffdad6",
}
fontFamily: {
  headline: ["Neue Haas Grotesk Display Pro", "Inter Tight", "sans-serif"],
  body:     ["Neue Haas Grotesk Text Pro", "Inter Tight", "sans-serif"],
  label:    ["Neue Haas Grotesk Text Pro", "Inter Tight", "sans-serif"],
}
```

**Canonical nav pattern:** Use the session shell as reference. Active state =
primary text on a white/surface card with subtle elevation. Sidebar background =
`surface-container-low`.

---

## Phase 1 — Foundation

**Goal:** Runnable Next.js app with auth, Supabase connected, design system wired.

| Task | Status | Notes |
|------|--------|-------|
| Init Next.js 16 (App Router) + TypeScript | ✅ | Next.js 16.2.4 / Tailwind v4 |
| Configure Tailwind with canonical design tokens | ✅ | CSS-first via `@theme` in globals.css |
| Add EdPlus typography fallback via `next/font` | ✅ | Inter Tight is loaded as the active fallback for Neue Haas Grotesk |
| Wire Google OAuth via Supabase Auth | ✅ | Callback route + proxy (auth redirect) wired |
| Implement `user_profiles` upsert on first login | ✅ | DB trigger in migration.sql |
| Apply full DATA_MODEL.md schema to Supabase | ✅ | `docs/migration.sql` — paste into SQL editor |
| Implement RLS policies for all user-owned tables | ✅ | All 18 tables covered in migration.sql |
| Build sidebar nav shell (dashboard screen as reference) | ✅ | `src/components/ui/SideNav.tsx` |
| Login page (`/login`) — Google sign-in only | ✅ | |
| Dashboard shell (`/dashboard`) — session list skeleton | ✅ | Empty state + layout wired |
| Proxy: redirect unauthenticated to `/login` | ✅ | `src/proxy.ts` (Next.js 16 convention) |
| Deploy to Vercel (staging) | ☐ | Needs `.env.local` with Supabase keys |

---

## Phase 2 — Canvas Sync & Core Data

**Goal:** User can connect a Canvas course, pull content, and see a paginated list.

| Task | Status | Notes |
|------|--------|-------|
| Canvas PAT entry UI + encrypted storage | ✅ | PAT via `X-Canvas-Pat` header; stored encrypted in `user_canvas_credentials` |
| PAT expiry warning (7-day) on dashboard | ✅ | Dashboard calls backend credential warning endpoint; warns at <= 2 days remaining |
| Python FastAPI service scaffold on Railway | ✅ | Deployed on Railway; `/canvas/ping` health check live |
| `/canvas/pull` endpoint — full course fetch | ✅ | Queues `canvas_pull` background job; fetches pages, assignments, discussions, quizzes, files, modules |
| Write to `course_content_items` + `course_content_bodies` | ✅ | Metadata and body persisted separately |
| `course_sync_runs` audit record per pull | ✅ | Tracks status, duration, fetched count, changed count, errors |
| Incremental re-sync (hash diff, only update changed) | ✅ | Body hash diff avoids rewriting unchanged bodies |
| Session creation flow — connect + name session | ✅ | `POST /canvas/sessions`; creates `courses` + `sessions` records; `/sessions/new` UI live |
| Content list page with cursor pagination (20/page) | ✅ | `/sessions/[id]/inventory` metadata-only list with type filters and cursor next page |
| Progress indicator during Canvas pull | ✅ | `SyncCourseButton` starts pull and polls `background_jobs` status via backend |

---

## Phase 3 — Health & Inventory

**Goal:** Health run produces findings; inventory supports bulk keep/delete decisions. Export/report surfaces land in Phase 6.

| Task | Status | Notes |
|------|--------|-------|
| `/health/run` endpoint — WCAG 2.1 AA audit | ◐ | Async `/health/sessions/{id}/run`; scans missing alt, link text, headings, table headers |
| Orphan detection (published, no module link) | ✅ | Sync sets `is_orphaned`; health scan writes findings |
| Duplicate detection (title + body hash) | ✅ | Health scan updates `duplicate_group_key` and writes findings |
| Write to `health_findings` + `health_runs` | ✅ | Async health job writes durable run summary and findings |
| Course Health page — summary + per-issue drill-down | ✅ | Summary, issue/severity filters, paginated latest-run findings, and content actions live |
| Content Inventory page — paginated list with filters | ✅ | Backend paginated/search/sort API; rich iframe preview; resizable columns |
| Inline keep / delete / defer actions | ✅ | Missing decisions auto-seed on first inventory load; keep/delete/defer persist to `content_inventory_decisions` |
| Bulk select + bulk delete | ✅ | Current-page bulk keep/defer/remove decisions via backend batch endpoint |

---

## Phase 4 — Editor, Images & Links

**Goal:** Full content editing with push-to-Canvas; image alt text and link text management, with image binaries proxied through R2 and list views kept metadata-first.

| Task | Status | Notes |
|------|--------|-------|
| Tiptap editor setup + all v1 extensions | ◐ | Core Tiptap editor is live with an RCE-style ribbon toolbar, formatting, font family/size controls, text color/highlight/pill styles, subscript/superscript, visibly styled links, resizable images, tables, callouts, accordions, styled separators, managed content blocks, video/HTML embeds, LaTeX equation editor, preview, expanded editor mode, and HTML mode; remaining v1 polish focuses on regression/stabilization and small reference-editor parity gaps |
| Edit/View page layout | ✅ | `/edit` now has a real editor workspace with split/edit/preview modes |
| Load content body on demand (not on list) | ✅ | Saved body loads only for the selected editor item |
| Server-side HTML extraction/indexing for editor/images/links | ✅ | Shared backend extraction feeds links/images without client-side full-body parsing |
| Persist image inventory from stored HTML into `course_images` | ✅ | Persists during sync/backfill for pages, assignments, discussions, quizzes, and quiz questions; resync defaults orphaned top-level images to removal while preserving explicit review actions and deployed quiz-question images |
| Links inventory endpoint — paginated, derived from stored HTML | ✅ | Backend link inventory and page-level filtering are live |
| Revision history per content item | ✅ | Saves to `content_revisions`; revision list and restore are live in `/edit`; parent quiz history now includes child quiz-question revision summaries |
| Canvas-native revision history for pages | ✅ | Identify Issue modal can list Canvas page revisions on demand, preview current vs selected version, restore into local `content_revisions`/Pending Review, flag audit-report issues, and replace page content from a matching source-course page without pushing directly to Canvas; source-course replacement copies referenced Canvas files/images into the active course, rewrites Canvas file endpoints, rewrites same-instance non-file course links to the active course id, and has been manually validated with images, files, auto-opening pages, module placement, and Canvas push |
| Publish / unpublish toggle per item | ✅ | Queue/menu publish state stages module operations as the single source of truth; bulk Canvas apply has been validated |
| Module queue/builder parity with v1 | ✅ | Module-structure view is default with By Module / By Type / Smart views, scoped queue counts, collapsible modules with bulk expand/collapse, drag reorder/move, menu-based move, staged module create/rename/reorder/delete, staged item rename, and item/module action menus; duplicate and shift dates remain post-launch candidates |
| Create new Canvas content items | ✅ | User flow creates new page, assignment, and discussion drafts inside v2, writes to existing `course_content_items` / `course_content_bodies`, appears in inventory/editor flows, supports revision history and Pending Review, pushes to Canvas as newly created items, and places items into selected modules on push with repair support for missed placements; quiz creation was not in the reference app and is deferred to v2.2/v2.3 |
| Persist full module item graph | ✅ | Sync stores module item IDs, type, content IDs/page URLs, position, indent, published state, requirements, and module-level metadata; Canvas module push/apply validation completed |
| Unified pending changes review | ✅ | Editor pending review dialog combines local content edits and staged module operations; content row-level/selected push and module operation apply are live; content push history records pushed revision summaries, and module update history is shown separately |
| Content edit diff scaffold | ✅ | Backend detects unpushed editor revisions and exposes before/after title/body summaries plus unified diff for selected item; publish-state diff remains post-launch polish if revision metadata expands |
| Module operation staging model | ✅ | `module_queue_operations` persists local module queue operations separately from the Canvas baseline; module create/rename/reorder/delete plus item publish/unpublish, indent, rename, reorder, cross-module move, and remove-from-module staging are live and regression tested |
| Editor media upload + insert | ✅ | Image upload from editor validates 10 MB max, compresses large images below the AI platform threshold, stores an R2 source/cache copy, uploads to Canvas Files, opens a required alt/decorative review modal with AI alt/long-description generation, inserts the Canvas file URL into the draft, and records `course_images`; non-image file upload supports PDF, Word, PowerPoint, CSV, and Excel files, uploads to Canvas Files, optionally stores source files in R2/`documents`, inserts course-copy-safe Canvas file links, and can hyperlink selected text |
| Advanced block inserts (accordion/callout/separator/HTML embed) | ✅ | Callout, accordion, styled separator, and HTML/embed insertion UX ported into the v2 editor |
| Managed content block library | ◐ | Image + Text, Full Width Image, Image Card, Profile Card, Testimonial, 2/3-column layouts, styled table, module header, pull quote, step indicator, and CTA button are live with Canvas image upload/review where needed; remaining pass should add block management controls and additional simple reference blocks |
| Command palette / slash commands | ◐ | Slash command menu is live for core formatting, subscript/superscript, common text colors/highlights, tables, callouts, accordions, separators, and HTML blocks; future pass can add template/content-block library entries |
| Push single item to Canvas | ✅ | Backend push endpoint and editor action validated for pages, assignments, discussions, classic quizzes, Classic Quiz questions through parent quiz push, and New Quiz instructions; quiz creation remains deferred |
| Batch push with per-item status tracking | ✅ | Pending review dialog can push all pending content edits sequentially with per-item UI status and durable `content_pushed` events in `platform_events`, including revision counts/ranges/change summaries for later reports |
| Batch apply staged module operations | ✅ | Pending review dialog can apply staged module create/rename/reorder/delete plus item publish/unpublish, indent, rename, reorder, cross-module move, and remove-from-module changes to Canvas; create/rename individual module apply UX is live; requirements punted to a later version |
| Diff / compare before push | ✅ | Content unified diff exists; module pending review shows before/after summaries for staged module operations, with deeper module diff polish tracked as post-launch refinement |
| Find & Replace — regex, scoped to item or full course | ◐ | Current-item literal find/replace is available from the RCE toolbar; dedicated course-wide literal search/replace workspace can send selected item replacements to Pending Review; regex and finer match-level selection still pending |
| AI editor writing tools | ✅ | Selected-text AI rewrite menu supports rewrite, simplify, expand, formalize, make concise, and grammar fixes; Tools modal generates learning objectives, discussion prompts, module overviews, assignment instructions, welcome messages, and smart page-context additions via ASU AIML with optional model/provider overrides |
| Editor accessibility check | ✅ | Tools modal scans the current draft for missing/empty/filename alt text, vague or URL-style link text, empty/skipped headings, missing table headers, and low inline contrast; safe in-editor fixes are live for headings, table headers, contrast color removal, and AI-improved link text |
| Images tab — paginated gallery, lazy-loaded thumbnails | ◐ | Real inventory, thumbnails, image management UI, preview modal, and apply-to-content actions are live; quiz-question images are included and alt/decorative updates push through the guarded parent-quiz flow; bulk decorative and generated-alt flows create Pending Review content revisions; long-description rendering and non-image uploads still pending |
| Image proxy — download to R2 on first encounter | ✅ | Proxy route, authenticated fetch, R2 caching, and thumbnail generation are live; Canvas fallback now protects rendering if R2 fails |
| Alt text edit per image | ✅ | Per-image alt text, decorative state, and long-description edits persist |
| Image review actions + bulk decorative/keep/remove | ✅ | Bulk keep/remove/defer and decorative actions live; bulk decorative applies to content so Pending Review can push Canvas updates |
| AI alt text generation (single + batch) via ASU AIML | ✅ | Single-image and bulk alt/long-description generation wired into images manager; bulk alt/both applies generated alt text to content while long-description-only remains metadata-only |
| Links tab — list all links, flag ambiguous | ✅ | Use `links_final_navigation_refined` screen |
| AI link text suggestion via ASU AIML | ✅ | Single and selected-bulk AI suggestions use surrounding page context, support a link-specific AI model override, and apply reviewed text to content revisions |
| Classic quiz question editing and guarded push | ✅ | Classic quiz questions sync into local `quiz_question` content records with bodies/revisions, show beneath quiz content in the RCE, support add/edit/delete staging through the parent quiz, include embedded images in the Images queue, and push question edits plus image alt/decorative updates through guarded Canvas endpoints that block when submissions exist; MC, multiple answer, true/false, matching, numerical, fill-in-multiple-blanks, multiple dropdowns, essay, file upload, text-only, and calculated review paths have type-specific UI guardrails; Canvas-returned question/answer IDs sync back locally after push |
| Documents tab — list attached files | ◐ | Documents inventory lists Canvas course files, editor-uploaded files, linked-from content references, filename-style link text issues, upload source context, Canvas file metadata, and initial PDF probe status/findings; replacement, unlinking, deletion safety, and full remediation workflows remain Phase 5 |

### Phase 4 Closeout Checklist

| Item | Status | Notes |
|------|--------|-------|
| Regression pass across page, assignment, discussion, module, quiz, image, link, and file push flows | ✅ | Manual testing validated app-history restore, Canvas revision restore, source-course replacement with images/files, page/assignment/discussion creation with module placement, quiz edit/add/delete/push plus submissions block, file upload/selected-text linking, accessibility fixes, and pending review push/apply flows |
| Targeted quiz-image regression | ✅ | Post-fix smoke testing validated quiz-question image inventory after resync plus alt-text and decorative image updates pushing successfully to Canvas through the parent quiz flow |
| Module creation from queue | ✅ | Users can create a local module shell from the content queue, see it immediately in By Module, review the staged create operation, and apply it to Canvas through Pending Review |
| Source-course replacement asset remapping | ✅ | Initial remap pass copies up to 25 referenced Canvas files/images into the active course and rewrites Canvas file URLs/API endpoints plus same-instance page/assignment/discussion/quiz/module links; validated with source pages containing images and files, including push into a newly created module |
| Dependency security cleanup | ✅ | Backend vulnerable pins patched; frontend `postcss` override clears local npm audit while waiting on GitHub/Next nested dependency scan behavior |
| Release readiness notes | ✅ | Captured in `docs/RELEASE_CHECKLIST.md`; known v1 risks: source pages with more than 25 referenced files, inaccessible source files, or files over 50 MB fail safely and require manual handling; deep document remediation, long-description rendering, additional RCE templates, module duplicate/shift-date tools, and quiz creation remain post-launch |
| V1.0 launch polish watchlist | ✅ | Before launch, do a final quick check of Pending Review wording for failed Canvas pushes/submission blocks, quiz-question image alt/decorative messaging, long-description metadata-only language, empty-module queue visibility, and source-course asset-copy warnings |
| Deep document remediation / replacement | ➜ Phase 5 | Keep out of Phase 4 except for inventory visibility and initial PDF probe state |

### Post-Launch Candidates

| Item | Target | Notes |
|------|--------|-------|
| New quiz creation | v2.2/v2.3 | Not launch-critical and not present in the reference application; revisit after v1 quiz editing/push guardrails have production mileage |
| AI quiz answer verification parity | v1.1/v1.2 | Restore reference-style AI review of question prompts/answers after launch; not required for the guarded Classic Quiz editing/push workflow |
| Images inventory compact list view | v1.1 | Add a Card/List view toggle for the Images page, keeping card view as the visual default while adding a denser list/table mode for faster filename, deployment, alt/decorative, review-action, and status scanning |
| Editor/backend/document modularization | v1.1 | Split `ContentEditorWorkspace.tsx`, remaining heavy document detail/TagFlow surfaces such as PDF Figures review, and `backend/routers/canvas.py` into smaller responsibility-focused components/routers/services after launch; do incrementally with focused tests and user feedback to improve maintainability without destabilizing v1 release flows |
| Additional simple RCE block templates | v1.1/v1.2 | Add lower-risk reference blocks after launch once core editor and Canvas push flows stabilize |
| Course Creation template selector | v1.1/v1.2 | Backend template-backed generation is launch-ready; user-facing template selection and per-item template overrides can follow once the Transfer push path is stable |
| Module duplicate and shift-date tools | v1.1/v1.2 | Useful parity/polish work, but not required for launch content editing workflows |
| Background worker scaling and rate limiting | v1 stabilization/v1.1 | Keep launch architecture on Railway web + worker services, Supabase-backed durable jobs, and R2 artifacts. Add per-user/session/document admission caps, duplicate active-job guards, stale-job recovery, and worker pools split by `WORKER_JOB_TYPES` for PDF, AI, Canvas, transfer, and reporting workloads. Evaluate Redis only if Postgres queue throughput, delayed retries, or precise distributed token-bucket limits exceed launch needs. |
| New Quizzes support | v1.1/v1.2 | Fine-grained New Quizzes editing/transfer is out of v1.0 scope; Classic Quizzes remain supported, and Canvas-native Copy to Target is the preferred v1 path for New Quizzes-heavy courses |

---

## Phase 5 — Documents / TagFlow & Course Creation

**Goal:** PDF remediation workflow; New Course / Course Creations pipeline that turns uploaded source documentation into a reviewed Canvas course outline and generated course content.

**First slice scope:** Build the document workflow foundation, then reuse the same job/status architecture for Course Creation. The first pass owns uploaded/Canvas PDF detail pages, `document_analysis` jobs in `background_jobs`, per-document accessibility findings, replacement/reference safety review, automatic TagFlow page-preview preparation, AI draft-zone preparation, document-level figure review, editable PDF title/language metadata, tagged-PDF export, Canvas replacement deployment, Course Creation source extraction, AI outline generation, template-backed draft body generation, and export of generated drafts into the existing Canvas Clean tool suite. V1 should now prioritize stabilization and launch-critical gaps over additional large refactors; heavier PDF Figures/detail/TagFlow decomposition moves to v1.1 unless a launch blocker forces us into that code path. All PDF remediation, export, Canvas replacement deployment, outline generation, and generated draft materialization must stay behind background jobs so large files and long AI runs never block request/response paths.

**Reference app parity anchors:** Use `documents_inventory_analysis` for the searchable high-density inventory and `documents_file_remediation_detail` for the document detail shape: complexity factors, structure/findings panels, job actions, and remediation entry points. Adapt the layouts to the current v2 navigation, canonical tokens, and existing Documents inventory rather than reintroducing the reference app shell.

**Data architecture guardrails:** Treat Canvas Files, editor-uploaded files, `documents`, `course_content_items`, `background_jobs`, and `platform_events` as one connected work history. Keep Canvas file IDs, source content references, R2 keys, generated/exported artifacts, analysis findings, queued jobs, replacement decisions, and Canvas push results linked by `session_id`, `user_id`, document/content IDs, and job IDs. Replacement should upload/deploy the accessible file while preserving the original file metadata and reference history.

**Backend structure guardrails:** Follow `docs/BACKEND_STRUCTURE.md` for new backend API/service placement. New work should prefer focused `backend/api/<feature>` route modules and `backend/services/<feature>` domain modules, while existing `canvas.py` behavior is extracted gradually as feature slices are touched.

**Frontend structure guardrails:** Follow `docs/FRONTEND_STRUCTURE.md` for new frontend module/component placement. New work should prefer focused `frontend/src/modules/<feature>` components, hooks, API clients, and types rather than growing large screen-manager files such as `DocumentDetailManager.tsx` and `TagFlowStructurePreview.tsx`.

**Current Phase 5 parity sequence:** Core PDF remediation/export is v1-capable after representative PDFs pass TagFlow review, generated export inspection, Canvas deployment, and Ally checks. V1 should include document inventory clarity for PDF-first work and bulk queueing of selected PDFs into review/remediation; bulk export, bulk Canvas deployment, and bulk original cleanup stay v2 because each output still needs per-document review and deployment confirmation. MCID/content binding, richer audit snapshots, page deletion/reordering, deeper PDF/UA validation, OCR-assisted flowchart node detection, and heavier frontend/backend modularization are v1.1/v2 hardening rather than launch blockers. Layout hints improve AI output before users spend time reviewing zones; flowchart builder should keep a manual fallback even if OCR-assisted node detection is added.

| Task | Status | Notes |
|------|--------|-------|
| PDF upload → R2 storage → `documents` row | ✅ | Editor file uploads can create R2-backed `documents` rows with initial PDF probe metadata when R2 is configured; standalone document sessions can now start without a Canvas shell, upload supported documents to R2, create `documents` rows, and auto-queue PDF analysis/remediation prep |
| Document detail page for uploaded/Canvas files | ✅ | `/sessions/[id]/documents/[docId]` ships for v1 with document metadata, compact summary cards, collapsible complexity breakdown, TagFlow page previews, PDF Figures review, PDF Extraction metadata/details, stored findings, reference review, job history, replacement candidate, original cleanup, Canvas link, and replacement readiness panels. TagFlow page strip/modal, PDF Extraction, accessibility findings, reference review, replacement candidate, remediation readiness, work history, and original cleanup panels have been extracted into `frontend/src/modules/documents/components/` without behavior changes. Remaining heavy PDF Figures editor extraction is deferred to v1.1 unless needed for a launch-blocking fix. |
| Backend document analysis job + status endpoint | ✅ | `document_analysis` uses `background_jobs`; detail/status endpoints expose latest job and persisted findings. Deeper worker/module extraction is v1.1 hardening unless needed for a launch-blocking fix. |
| PDF accessibility findings stored per document | ✅ | Initial probe and normalized analysis are stored on the file content metadata, with linked `documents.tag_data` updated when available. A dedicated findings table can be added in v1.1/v2 if query/report needs require it. |
| Replacement artifact boundary | ✅ | Users can upload a manual replacement candidate from document detail for supported document types (PDF, Word, PowerPoint, CSV, Excel); the replacement is stored in R2, PDF candidates are lightly probed, metadata is persisted, and Canvas deployment waits for reference review. |
| Replacement reference review + deploy job | ✅ | Deploy opens a reference-selection modal, uploads the replacement candidate to Canvas Files through `document_replacement_deploy`, records reference review automatically, and creates local Pending Review content revisions for selected links; users still approve/push those content revisions through existing Pending Review. |
| Replacement deployment history and inventory clarity | ✅ | Document detail shows replacement deployment job history, Canvas file IDs/links, selected references, and pending revision counts; Documents inventory badges distinguish replacement candidates, deployed replacements, replaced originals, replacement files, and non-embedded image files. |
| Original cleanup inventory decisions | ✅ | Replaced originals surface their existing inventory decision state and can be marked keep, cleanup, or defer from document detail; cleanup can queue a Canvas Archive folder move job and marks the inventory decision applied when Canvas confirms the move. |
| Document work-history read model | ✅ | Document detail receives a normalized `work_history` timeline spanning background jobs, inventory decisions, and platform events with stable source table/id fields for later reports and dashboard audit views. |
| Document cleanup inventory filters | ✅ | Documents inventory exposes query-scoped counts and filters for replacement deployed, ready to archive, still placed, cleanup marked, archived, no content links, filename-link states, and file type, plus priority/name sorting so users can narrow to currently supported PDF remediation work without relying on search; filtering/sorting/count shaping lives in `backend/services/documents/inventory.py`, with frontend inventory types moved to `frontend/src/modules/documents/types.ts`. |
| PDF remediation job scaffold | ✅ | `document_remediation` jobs extract PDF title, language, author, keywords, structural tag signals, existing heading/tag evidence, page text blocks with fallback extraction, grouped figure candidates, raw image diagnostics, and a heuristic PDF profile for pages/images/tables/fonts/layout/OCR indicators; Documents inventory can queue PDF review directly for one PDF or selected visible PDFs, displays reviewed PDFs as Simple, Moderate, or Complex, and keeps row actions/status text aligned with background preview and AI-zone preparation before opening TagFlow; document detail surfaces remediation next actions, metadata/profile signals, figure review, and document-level TagFlow launch/preview entry points. Bulk export/deploy/cleanup remains v2 after per-document export confidence is stronger. |
| Automatic TagFlow preparation after PDF analysis | ✅ | Initial PDF remediation analysis automatically queues required original page preview assets and AI draft-zone suggestions where ASU AIML is configured, applies AI draft zones to the working TagFlow state so previews show the overlay immediately, keeps all work behind background jobs, preserves manual-zone authority, and never auto-marks pages remediated |
| PDF/AI worker backpressure hardening | ◐ | Initial external worker process, FastAPI dispatch gate, Supabase-backed job admission helper, duplicate active-job guards, per-user active caps for PDF review/export/preview/AI jobs, stale running-job recovery, queued single and bulk Image Inventory AI alt/long-description generation, queued PDF figure alt/long-description generation, and queued bulk Links AI suggestion generation with per-job progress are in place. Worker idle polling now defaults to 5 seconds to reduce Supabase chatter while staying responsive; worker job groups (`pdf`, `ai`, `canvas`, `transfer`, `course_creation`, `reports`) are documented for Railway split-worker deployment. Remaining hardening: workerize editor rewrite/generate actions; refine preview coalescing beyond one active preview job per document; deploy split Railway workers by `WORKER_JOB_TYPES`; and expose backlog alerts. Redis remains a later scaling option, not a launch dependency. |
| PDF/TagFlow backend modularity | ◐ | PDF/TagFlow request contracts and tag enums now live in `backend/models/pdf.py`, figure-specific behavior lives in `backend/services/pdf_figures.py`, TagFlow zone normalization/page validation/save-state mutation lives in `backend/services/tagflow_state.py`, and tagged-PDF export readiness/validation now lives under `backend/services/pdf_export` with a focused `backend/api/pdf_export` boundary. Broader remediation planning and preview job helper extraction from the large Canvas router is deferred to v1.1 unless needed for a launch-blocking fix. |
| PDF title/language remediation metadata | ✅ | Editable PDF title and language fields are live in the document detail PDF Extraction panel, with a curated language dropdown plus custom BCP 47 code fallback; reviewed values persist to remediation metadata/export readiness state, and TagFlow surfaces compact metadata readiness. Export-readiness checks flag missing title/language before export. |
| Document file management | ✅ | V1 safety workflow is covered by Documents inventory badges/filters (`No content links`, replacement deployed, ready to archive, still placed, cleanup marked, archived), detail-page reference review with source navigation, replacement deploy history, original cleanup decisions, and Canvas Archive moves for replaced originals. Keep hard delete, automatic unlinking, bulk cleanup, and deeper Canvas folder/file operations in v1.1/v2 unless a launch blocker appears. |
| Non-embedded Canvas image file handling | ☐ | Documents may include image files that are not in the Images queue because the Images queue only tracks inline `<img>` usage from content HTML; add an explicit unused/non-embedded image-file state so users can distinguish Canvas image assets from rendered images needing alt/decorative review |
| Initial PDF accessibility review | ✅ | Lightweight upload-time probe detects encrypted PDFs, missing structure tree, missing mark info, missing title metadata, and page count; deeper analysis/remediation remains behind document jobs. |
| Visual zone-tagging editor | ✅ | TagFlow route shows every generated page with working-state status, validation state, and original/tagged asset state; PDF review queues preview rendering, stores private WebP assets in R2, issues short-lived signed preview URLs after authorization with proxy fallback, and uses a single-preview modal with live frontend outline overlays from saved zones instead of relying on baked overlay images; users can launch into TagFlow from document detail or a page preview, and Artifact zones are excluded from content reading-order numbering. |
| TagFlow preview polish | ✅ | Shows queued/running state, progress counts, per-card loading states, and auto-refresh while original WebP preview assets render; preview jobs target missing/stale pages, preserve existing R2 previews until replacements are ready, issue 15-minute signed R2 URLs for fast thumbnail/editor loading with proxy fallback, surface stale preview badges for future TagFlow edits, avoid forcing server-component refreshes before backend preview status changes, and keep tagged-overlay refreshes from presenting as original preview generation after zone saves. Further preview helper extraction is v1.1 hardening unless needed for a launch-blocking fix. |
| Editable TagFlow working state | ✅ | Manual zone editor can add/remove/update page zones with tag type, reading order, and percentage bounds; preview-page editing supports local mouse-drawn zones, mouse repositioning/resizing, compact reading-order drag/drop rows with per-zone options, selected-zone deletion, overlay visibility, undo/redo shortcuts, and page status labels of Unreviewed, Edited, and Remediated before writing to `tagflow_state`; saves update version, runs lightweight page validation, warns before marking a page remediated with validation issues, marks page previews/analysis stale, queues a page-specific tagged preview refresh, and writes a document work-history event without mutating the original PDF analysis. |
| Full-page TagFlow coverage | ✅ | TagFlow lists every page from `tagflow_state.pages`, keeps generated previews editable, caps the default page grid at eight pages with a view-all expansion card, uses a full-screen Acrobat-style editor with thumbnail page navigation, real zooming center canvas, drag-resizable left/right rails, and right zone tools, and can queue missing full-page preview assets on demand through the same background job/asset/status contracts. Advanced keyboard shortcuts and targeted per-page preview generation controls are v1.1 polish. |
| AI zone suggestion via ASU AIML | ✅ | `tagflow_ai_suggestions` background jobs are live, initial PDF review auto-queues suggestions when AI is configured, AI-generated zones are stored separately from manual zones with source/confidence/job metadata, and auto-apply moves the draft into working TagFlow state without marking pages remediated. Prompts include extracted page text, figure candidates, existing zones, existing structure/tag evidence, and the resolved page/document layout hint so partially tagged PDFs preserve H1/H2 intent and column flow instead of demoting headings; two/three-column hints also trigger a deterministic column-major reorder pass on suggested zones. Further tuning against real PDFs is v1.1 hardening. |
| Page-layout hints for AI tagging | ✅ | Reference-style layout controls are live in TagFlow with Auto-detect, Single column, Two column, and Three column options. Users can apply the hint to the current page or whole document; hints persist through the focused document remediation API/service path outside `canvas.py`, mark affected AI suggestions stale, and are included in AI prompt context. Additional validation across complex multi-column PDFs is v1.1 hardening. |
| AI alt text for figure zones via ASU AIML | ✅ | PDF review now builds a service-backed figure inventory from grouped PDF figure candidates and distinguishes raw PDF image objects from reviewable figure candidates in the UI; document detail displays wider reviewable figure crops with decorative, ignore/restore, alt text, long-description, figure type, and flowchart guidance fields plus per-figure ASU AIML generation. Figure crops are cached as private R2 assets when configured, matching TagFlow figure candidates surface review state while editing zones, saved Figure zones bind to stable figure candidate/inventory IDs for validation/export, and users can generate or edit bound figure alt text, long descriptions, and flowchart/diagram guidance directly from TagFlow when context requires it. Generated exports write figure alt entries and have passed Ally checks on tested image PDFs. |
| Flowchart builder for complex figures | ✅ | Flowchart figures expose a dedicated builder modal from PDF Figures and selected TagFlow Figure zones, and can persist structured nodes, node descriptions, connector relationships, reading sequence, visual node bounds, start/end/independent roles, and freeform guidance; document-level figures save through a focused `backend/api/pdf_figures` endpoint outside `canvas.py`, while selected-zone structures save with TagFlow zones. The shared builder lives under `frontend/src/modules/tagflow`; TagFlow includes a visual annotator with draggable/resizable boxes, click-to-connect relationships, zoom, role cycling, and guidance generation while retaining the structured editor fallback. A focused `backend/api/tagflow` zone-image endpoint crops selected Figure zones from generated original preview assets, giving the builder a larger focused canvas and providing the foundation for future OCR-assisted "Detect nodes" progressive enhancement in v1.1/v2. |
| Export as tagged accessible PDF | ✅ | V1 export is live behind durable `pdf_export` jobs. Export requires reviewed title/language and valid TagFlow state, consumes saved zones/reading order plus reviewed figure alt/long-description/flowchart metadata, keeps the original PDF downloadable with the original filename, generates an R2-backed artifact with an "accessible" filename suffix, registers that artifact as the replacement candidate for Canvas-backed documents, and can upload standalone exported PDFs to a selected Canvas course as a new Canvas Files upload. The reference-informed `pikepdf` writer sets metadata, `/Lang`, `/MarkInfo`, and a planned PDF structure tree from TagFlow zones; generated artifacts are inspected for language, marked-document flag, structure tree, expected role counts, and figure alt entries. Tested heading/figure PDFs pass Ally after Canvas deployment. V1.1/v2 hardening: richer export audit snapshots, page deletion/reordering, marked-content MCID binding, and deeper PDF/UA validation. |
| Course Creation architecture foundation | ✅ | Standalone Create-session foundation is live outside `canvas.py`: `backend/api/course_creation`, `backend/services/course_creation`, `backend/jobs/course_creation.py`, and `frontend/src/modules/course_creation`. The current slice covers create-session startup without a Canvas shell, project setup metadata, R2-backed source uploads, extraction job status, reviewable extraction previews, AI outline generation, source-backed fallback/debug handling, reviewed outline persistence, source chunk rebinding, template-backed content generation, resumable draft materialization, and export into Canvas Clean. Continue mining reference code for later implementation details rather than porting wholesale: `_reference/backend/services/file_extractor.py` for structured Office extraction, `_reference/backend/services/content_assembler.py` for deterministic assembly, `_reference/backend/api/_create_push.py` and `_reference/backend/services/canvas_api.py` for Canvas push methods/progress, `_reference/backend/api/transfer/__init__.py` for cross-course orchestration patterns, and `_reference/frontend/src/components/create/CreateUploadPage.tsx` for upload-flow UX. |
| Course Creations page | ✅ | `/sessions/[id]/create` workspace starts/resumes create sessions, captures setup, manages source uploads/extraction, queues outline generation, reviews generated modules/items, queues draft generation, shows background progress/spinner state, and opens an Export to Canvas Clean confirmation modal with generated module/item counts and item previews before handoff. |
| New Course project setup | ✅ | Initial setup form captures title, code, description, audience/level, term length, module count, and source notes without requiring a Canvas shell at project start. Target mode and generation preferences remain follow-up controls. |
| Source documentation upload | ✅ | Course Creation source files upload to R2, link to the create session through project-scoped document metadata, and expose upload/delete/list APIs under the course-creation boundary. |
| Source extraction job scaffold | ✅ | Initial `course_creation_source_extract` background job reads from R2, writes an extraction artifact back to R2, updates source/job status, and exposes reviewable PDF/text/CSV chunks with file/page/row provenance. Structured Office extraction remains a follow-up using the reference `file_extractor.py` approach. |
| AI content extraction + chunking via ASU AIML | ✅ | `course_creation_outline_generate` jobs collect extracted R2 source artifacts, send project setup plus source chunks to ASU AIML using Canvas Create-specific model/provider/token controls, normalize returned source-analysis chunks with confidence/source provenance, and store reviewable summaries in Course Creation project metadata. Further tuning against Office-derived chunks is part of the structured Office extraction follow-up. |
| Generate course outline | ✅ | Outline generation runs behind background jobs, stores draft modules/objectives/topics/workload/content recommendations separately from generated Canvas content, retries compact JSON when needed, stores AI response debug excerpts/artifacts on parse failures, and surfaces module drafts, source analysis, gaps, and assumptions in the Course Creation workspace. |
| Outline review and editing | ✅ | Users can revise outline title/description, module titles/order/overview/objectives/topics/workload, draft item type/title/purpose/order, add/remove draft items, remove modules, save a reviewed outline revision, and rebind module/item source chunks from the full extracted source pool before generating Canvas Clean drafts. |
| Template-backed draft generation | ✅ | Backend template layer is live for overview, learning materials, assignment, discussion, and quiz-shaped drafts. User-facing template selection and per-item template overrides are post-launch polish. |
| Generate draft Canvas content from outline | ✅ | `course_creation_drafts_generate` background jobs create/resume local Canvas Clean modules and page/assignment/discussion/quiz drafts from the approved outline, use per-item ASU AIML structured JSON around deterministic templates, fall back to source-backed template content when AI body generation fails, and avoid duplicating rows for the same outline job. |
| Export generated drafts to Canvas Clean | ✅ | Generated modules/items are written to existing `course_modules`, `module_queue_operations`, `course_content_items`, `course_module_items`, `course_content_bodies`, and `content_revisions`; export confirmation marks the Course Creation project as `exported_to_canvas_clean`, routes future dashboard opens to the editor, and switches the sidebar from Create-only navigation to the full Canvas Clean suite: editor, Images, Links, Documents, Health, Reports, and future Transfer flow. |
| Review generated content in Tiptap editor before push | ✅ | Generated Course Creation drafts open in the existing Canvas Clean editor/revision workflow before any Canvas push, with local revisions and Pending Review behavior preserved. |
---

## Phase 6 — Transfer & Reports

**Goal:** Cross-course content migration; all export surfaces. Course Creation now exports generated modules/items into Canvas Clean, so Phase 6 should treat those local drafts the same way as pulled Canvas content: review/remediate first, then transfer/push/report through the shared Canvas Clean suite.

| Task | Status | Notes |
|------|--------|-------|
| Transfer architecture foundation | ✅ | Focused `backend/api/transfer`, `backend/services/transfer`, `backend/jobs/transfer.py`, and `frontend/src/modules/transfer` feature area is live. Reference files remain useful for later Canvas edge cases, but the v2 implementation now uses durable background jobs, v2 session/content tables, readiness APIs, and Transfer-specific services rather than reference session-state code. |
| Transfer page — source/target course selection | ✅ | `transfer_main_options`-informed workspace is live with mode cards, readiness summary, pending generated/modified content, target validation modals, transfer previews, refresh loading state, running/completed job status, post-transfer "Open Course in Canvas" action, and Curate/Create session support. |
| Transfer readiness API | ◐ | Endpoint aggregates session/course context, modules/items, staged module operations, unpushed content revisions, Course Creation generated drafts, deletion/orphan candidates, linked assignment/activity relationships, referenced file/image counts, and transferable content counts. Target/copy modes use transferable counts while same-course push focuses on pending local changes and suppresses target-only known-exception language. |
| Target course validation | ◐ | Target Canvas course URL validation checks allowed Canvas host, active PAT, and target course access before any push/copy job can run. Validation now handles ASU Canvas host aliases (`canvas.asu.edu` / `asu.instructure.com`) so a valid stored credential can be reused when the pasted URL uses the alternate hostname. |
| Copy modal — Canvas-native course copy | ✅ | `transfer_copy_to_target_modal`-informed confirmation UI validates target course, shows matched course details, captures erase-first intent with IMSCC backup/proceed-without-backup safeguard, and launches a Canvas-native `course_copy_importer` content migration from the connected source Canvas course to the target shell. Copy mode intentionally skips fine-grained item selection because Canvas handles the full course copy. |
| Push modal — confirmation + status | ✅ | `transfer_push_to_target_modal`-informed confirmation UI validates target course, shows matched course details, summarizes module/item/file impact, previews included content, launches background jobs, hides misleading in-progress count details, and switches completion CTA to "Open Course in Canvas" while keeping Close available. |
| Canvas course creation/push service | ✅ | Focused Canvas write routines in `backend/jobs/transfer.py` can create/update modules, pages, assignments, discussions, classic quizzes/questions, files/images, supported module placements, same-course updates/deletions, module restructure operations, and Canvas-native source-to-target course copies with progress events and idempotent Canvas result metadata. Fine-grained New Quizzes support is deferred to v1.1/v1.2; additional erase-first hardening remains a launch stabilization watch item. |
| Push generated course to new or existing Canvas course | ✅ | Reviewed Canvas Clean drafts from Course Creation and Curate sessions can be pushed/copied to a selected target Canvas course, including module placement, pages, assignments, discussions, referenced file/image migration, link remapping, and direct Canvas links after completion. |
| Canvas push/transfer jobs | ✅ | Target-course `transfer_target_push` jobs handle optional erase-first with IMSCC backup gating, modules, Canvas pages, assignments, discussions, classic quizzes/questions, supported module item placement, linked-only internal page/assignment/discussion preservation, referenced Canvas file/image migration from content and quiz-question bodies, progress events, link remapping, skipped unsupported summaries, and post-completion Canvas URL metadata. Copy-course `transfer_course_copy` jobs use Canvas content migrations to copy the connected source Canvas course into the target shell after optional backup/erase. Same-course `transfer_same_course_push` handles edited pages, assignments, discussions, classic quizzes/questions with submission guardrails, newly created local modules, module rename/reorder/delete operations, newly created local pages/assignments/discussions, placement of those new local items into created/existing Canvas modules, staged module item publish/indent/rename/move/remove/position operations, explicit staged deletions for pages/assignments/discussions/quizzes/files, linked assignment-shell/activity decision protection for graded discussions and quizzes, and Canvas file deletion guards for files still referenced by kept content including quiz-question images, PDFs, CSVs, and other linked course files. Sync now collapses Canvas assignment shells for graded discussions/quizzes into the real activity rows so inventory no longer surfaces duplicate companion assignments after resync. Remaining v1 work is representative-shell QA and additional erase-first hardening; New Quizzes are deferred to v1.1/v1.2. |
| Transfer exceptions report | ✅ | Readiness and preview surfaces identify unsupported, unplaced, orphaned, skipped, and manual-review items; same-course push hides target-only "known exceptions" language while retaining orphan review. Transfer jobs now persist a capped structured result report in the existing background job payload for created/updated/deleted/placed/migrated/protected/skipped/warning/error items; both same-course and target modals surface that report after completion, and Reports now exports the latest transfer report as a readable Excel workbook with summary and category tabs. Persisting generated report artifacts to `reports`/R2 remains follow-up. |
| Transfer/pull stabilization | ◐ | Shared chunked `course_content_bodies` lookup helper prevents oversized Supabase REST `in.(...)` URLs across health scan, pull image inventory, transfer readiness/planning, Course Creation draft preview, and editor/search routes. Inventory decision save responses now avoid circular linked-decision JSON objects, Health Documents counts both standalone uploaded documents and synced Canvas files, file inventory rows can surface referenced status/course location from kept content-body references such as quiz-question images, PDFs, and CSVs, image-file review decisions now sync between Content Inventory file rows and Image Inventory rows, and Canvas sync removes stale companion assignment-shell rows for graded discussions/quizzes on resync. Continue monitoring Canvas 401 thumbnail prewarm failures and any remaining slow inventory reads. |
| Document/TagFlow queue visibility | ◐ | Documents inventory now includes compact per-document background job summaries for PDF analysis, remediation extraction, TagFlow preview generation, AI zone generation, PDF export, Canvas deploy, replacement deploy, and archive jobs so users can see latest-failed work without opening each document detail page; active PDF analysis relies on the row-level spinner/status and bulk queue buttons disable immediately. System-admin queue diagnostics are available from the account menu for users with `user_profiles.role` of `system_admin` or `super_admin`, showing aggregate status counts, queue-health banner, worker-pool backlog summaries with oldest-active age warnings for PDF/AI/Canvas/transfer/report capacity, active job types, recent jobs, and admin-only retry for failed/canceled jobs. Remaining work: alert on sustained backlogs before request latency degrades. |
| Canvas Content Migration API integration | ✅ | Copy-to-target now uses Canvas `course_copy_importer` content migrations with polling, completion status, migration issue surfacing, and optional backup/erase. Remaining work is hardening against additional Canvas shell states and deciding whether other transfer modes should use migration APIs. |
| Reports & Downloads page | ✅ | `reports_and_downloads`-informed page is live without the Audit Intelligence promo block. It loads session counts, latest health/transfer activity, recent platform events, and exposes immediate Excel downloads for Content Inventory, Faculty Review, Health Summary, and Latest Transfer Report plus CSV download for edit history. Content Inventory now mirrors the reference workbook structure more closely with course URL/audit date, sectioned summary counts, graded/status/decision details, WCAG/link context, image thumbnails when cached, and files. Faculty Review includes Content Inventory, Quiz & Question Banks, Content Images, and Files tabs. Print/PDF now loads printable course bodies with all/module/type selection, hides app chrome in browser print/save-as-PDF output, converts iframe/embed/video content to visible source-link placeholders, uses signed R2 URLs for already-cached images, and shows placeholders for uncached Canvas-auth images rather than slowing the report with live Canvas fetches. R2-backed generated report records remain follow-up. |
| Faculty Review upload | ✅ | Faculty Review workbook upload applies checked quiz/content image alt text and long-description edits back to `course_images`, applies Content Inventory/Files Keep/Remove/Defer decisions to `content_inventory_decisions`, and reuses file/image decision sync so workbook changes stay aligned with inventory. Canvas remediation still flows through existing review and Transfer push paths. |
| Active Canvas backup download | ✅ | Reports can queue an IMSCC export for the connected source Canvas course, poll the background job, and expose the Canvas download URL when complete. This reuses the same Canvas content export primitives as Transfer backup while avoiding long request/response streaming through Railway. |
| Health Summary export (Excel) | ✅ | Immediate Health Summary download now generates an Excel workbook with latest run metadata, summary counts, WCAG findings, image issues, link issues, inventory findings, files, and documents. Health PDF generation and persisting generated reports to `reports`/R2 remain follow-up. |
| Inventory export (Excel) | ✅ | Immediate download now generates an Excel workbook aligned to the reference app sections: Summary, Content Inventory, WCAG Issues, Image Alt Text, Link Issues, and Files, with richer location/context columns and cached thumbnail embedding capped per workbook to control request-path load. Persisting generated workbooks to the `reports` table/R2 remains follow-up. |
| Edit history export | ✅ | First slice ships CSV from `content_revisions`; richer history report with Canvas push/apply events remains follow-up. |
| Full course content export (HTML zip) | ☐ | Browser print/save-as-PDF is live for printable course bodies; downloadable HTML zip remains a later artifact-generation slice. |

---

## Phase 7 — Platform Layer

**Goal:** Observability, archive lifecycle, and internal analytics in production.

| Task | Status | Notes |
|------|--------|-------|
| `platform_events` write on all tracked actions | ☐ | See PRD §5.6 event list |
| `error_logs` write on all backend exceptions | ☐ | |
| Frontend uncaught error → `/api/errors` endpoint | ☐ | |
| Correlation IDs across request → API → worker | ☐ | |
| Worker stale-job recovery and queue observability | ◐ | Worker can requeue or fail running jobs older than job-type-specific timeouts, defaults idle polling to 5 seconds, Documents surfaces per-document latest-failed PDF/TagFlow work, and system admins can view queue diagnostics by job type/status/user/session. Remaining work: alert on PDF/AI/Canvas/transfer/report backlogs before request latency degrades. |
| Soft delete UI — 30-day archive tray on dashboard | ☐ | |
| Cold storage migration job (30-day cron) | ☐ | Move blobs to R2 `archive/` prefix |
| Restore from soft delete | ☐ | |
| Admin analytics dashboard | ☐ | MAU/DAU, sessions by type, push volume |
| Admin error log viewer | ☐ | Filter by level, date, user, session |

---

## Phase 8 — Auth Migration Prep

**Goal:** Stubs ready for CAS/SAML and Canvas OAuth without blocking launch.

| Task | Status | Notes |
|------|--------|-------|
| `AuthProvider` interface — abstract Google OAuth behind it | ☐ | |
| CAS/SAML provider stub (no-op, documented) | ☐ | |
| Canvas OAuth token exchange stub | ☐ | Columns already in `user_canvas_credentials` |
| Migration runbook doc for both paths | ☐ | |

---

## Screen → Route Mapping

| Design file | Route |
|-------------|-------|
| `login_google_sign_in_only` | `/login` |
| `dashboard_final_navigation_refined` | `/dashboard` |
| `connect_updated_navigation` | `/sessions/new` |
| `course_health_fixed_logo_clipping` | `/sessions/[id]/health` |
| `content_inventory_aligned_header` | `/sessions/[id]/inventory` |
| `edit_editor_mode_refined_navigation` | `/sessions/[id]/edit` |
| `edit_enhanced_course_search_filters` | `/sessions/[id]/edit` (search panel) |
| `edit_identify_issue_modal_updated_navigation` | `/sessions/[id]/edit` (issue modal) |
| `images_final_navigation_refined` | `/sessions/[id]/images` |
| `links_final_navigation_refined` | `/sessions/[id]/links` |
| `documents_inventory_analysis` | `/sessions/[id]/documents` |
| `documents_file_remediation_detail` | `/sessions/[id]/documents/[docId]` |
| `course_creations` / `new_course` | `/sessions/[id]/create` |
| `transfer_main_options` | `/sessions/[id]/transfer` |
| `transfer_copy_to_target_modal` | `/sessions/[id]/transfer` (copy modal) |
| `transfer_push_to_target_modal` | `/sessions/[id]/transfer` (push modal) |
| `reports_and_downloads` | `/sessions/[id]/reports` |
