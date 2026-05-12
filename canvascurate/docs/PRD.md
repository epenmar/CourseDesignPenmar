# Product Requirements Document — Canvas Curate v2

**Status:** Living product baseline — implementation in stabilization/refactor

**Date:** 2026-05-11

**Owner:** Michael Arseneault
**Scope:** Full application rebuild; single-tenant (ASU)

---

## 1. Vision

Canvas Curate is an instructional design platform for ASU that bridges Canvas
LMS and content quality tooling. The v2 rebuild replaces an R2-only session
architecture with a proper relational database, adds platform analytics, and
delivers a modular Next.js frontend and FastAPI backend, improving latency,
developer experience, and long-term maintainability.

Implementation note: this PRD describes the product baseline. Detailed current
build status lives in `docs/PLAN.md`; refactor sequencing lives in
`docs/REFACTOR_PHASE_PLAN.md`.

---

## 2. Goals

| # | Goal |
|---|------|
| G1 | Eliminate latency caused by full-session R2 blob reads on every page load |
| G2 | Reduce Canvas API call volume via TTL-based content caching in Supabase |
| G3 | Ship a modular frontend (Next.js + internal design system) with lazy-loaded content |
| G4 | Add structured platform analytics and error logging (Supabase-native) |
| G5 | Introduce a 30-day soft-delete archive with cold storage migration |
| G6 | Maintain 100% feature parity with v1 on all retained tools |
| G7 | Prepare auth layer for Canvas OAuth and ASU CAS/SAML migration |

---

## 3. Non-Goals (v2)

- QA / Standards assessment workflows (dropped entirely)
- Canvas OAuth (designed for, not implemented in v2 — PAT with 7-day expiry for now)
- CAS/SAML SSO (Google OAuth first; SAML migration post-launch)
- Multi-tenant / multi-institution support
- Mobile-native app

---

## 4. User Personas

**Primary — Instructional Designer (ID)**  
Works on 10–15 Canvas courses simultaneously. Curate sessions are content-heavy (up to 100 pages, 100 images). Needs fast load times, batch editing, and clear health status at a glance.

**Secondary — Platform Administrator**  
Reviews platform usage analytics, monitors errors, manages user access. Needs internal dashboards, not external tools.

---

## 5. Feature Inventory

### 5.1 Dashboard

- Personal workspace listing all active sessions (curate, create, transfer, document)
- Session cards show: type, canvas course name, last modified, health score (if run), status
- Quick-create buttons for each session type
- Archive tray (soft-deleted sessions restored within 30 days)
- Analytics summary panel (own activity: courses touched, edits pushed, health runs)

### 5.2 Curate (Canvas Course Editing)

**Connect & Pull**
- Connect to a Canvas course via URL or course ID
- Canvas PAT entry with 7-day client-side expiry warning
- Pull all content types: pages, assignments, discussions, quizzes, files
- Progress indicator during pull; content cached in Supabase
  (`course_content_items` plus `course_content_bodies`)
- Incremental re-sync: diff against cached `content_hash`, only re-fetch changed items
- Paginated content lists (20 items/page) with infinite scroll option

**Course Health**
- WCAG 2.1 AA audit across all content types
- Issue categories: missing alt text, poor color contrast, missing heading structure, broken links, empty link text, ambiguous link text
- Orphaned content detection (published but not linked in any module)
- Duplicate content detection (title + body hash similarity)
- Summary dashboard with severity counts (critical / warning / info)
- Per-issue drill-down with affected item list and one-click navigation to editor

**Content Inventory**
- Full paginated list of all course content items
- Columns: type, title, module placement, last modified, health flags, word count, status
- Inline actions: keep, mark for deletion, view, open in Canvas
- Bulk select + bulk delete
- Filter by type, health status, module
- Export inventory to CSV/Excel

**Edit / View (Rich Text Editor)**
- Tiptap-based editor with all v1 custom extensions:
  - Accordion blocks
  - Callout / info blocks
  - Resizable images
  - HTML embed blocks
  - Tables
- Images tab: paginated gallery of all course images, lazy-loaded thumbnails, alt text display/edit, AI alt text generation per image or in batch
- Link text tab: list of all links with current text, AI suggestion, inline edit, flag ambiguous
- Documents tab: list of attached files, download, replace
- Find & Replace: regex-capable, scoped to current item or full course
- Revision history per content item (stored in `content_revisions`)
- Push to Canvas: single item or batch; status tracking per item

**Transfer**
- Same-course push for reviewed local edits, staged module operations, and
  explicit delete decisions
- Target-course transfer with readiness checks, target validation, optional
  IMSCC backup/erase-first flow, file migration, link remapping, and structured
  completion report
- Same-instance Canvas course copy using Canvas Content Migration API
- Status polling, progress events, completion report, and Canvas course link

**Reports & Downloads**
- Health report export (Excel)
- Content inventory export (Excel)
- Faculty Review workbook export/upload
- Latest transfer report export
- Edit history export (CSV)
- Printable course content view for browser print/save-as-PDF

### 5.3 Create (Document → Canvas Course)

- Upload Word (.docx) or PDF documents
- AI-powered content extraction, chunking, and tagging into Canvas content types
- Review extracted content in Tiptap editor before push
- Apply HTML theme templates (bmd_v1, gold_accent, tabbed_panels) per content type
- Push to new or existing Canvas course
- Template selector: overview, assignment, discussion, quiz, learning materials

### 5.4 Documents / TagFlow (PDF Remediation)

- Upload standalone PDF
- Visual zone-tagging editor: draw bounding boxes, assign structural roles (heading, paragraph, figure, table, list, artifact)
- AI-assisted zone suggestion
- AI alt text generation for tagged figure zones
- Export as tagged, accessible PDF
- Archive remediated PDFs to session archive

### 5.5 Archive

- All session types support soft-delete (30-day recovery window)
- After 30 days: session metadata stays in DB (deleted flag), blob data moves to R2 cold prefix (`archive/`)
- Archive tray on dashboard shows items within recovery window
- Restore returns session to active state

### 5.6 Analytics (Internal)

Events tracked in `platform_events` Supabase table:

| Event | Properties |
|-------|------------|
| `session_created` | type, user_id |
| `content_pulled` | session_id, item_count, duration_ms |
| `health_run` | session_id, issue_count |
| `content_edited` | session_id, content_type, content_id |
| `content_pushed` | session_id, item_count |
| `image_alt_generated` | session_id, image_count |
| `pdf_tagged` | document_id |
| `pdf_exported` | document_id |
| `transfer_completed` | session_id |
| `session_archived` | session_id, session_type |
| `page_viewed` | path, session_id |

Admin analytics direction:
- Current admin surface focuses on queue diagnostics and background-job
  observability.
- Platform-wide usage analytics can build on `platform_events` after launch
  stabilization.

### 5.7 Error Logging

- Structured `error_logs` table in Supabase (level, message, stack, context, user_id, session_id)
- Backend/platform events are persisted for key Canvas, document, transfer, and review actions
- Broader backend exception capture, frontend uncaught-error capture, and an admin error-log viewer remain hardening work

---

## 6. Technical Architecture

### 6.1 Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind CSS, internal design-system consolidation |
| Rich text | Tiptap + custom extensions (ported from v1) |
| Backend | Python 3.12 + FastAPI (separate Railway service) |
| Database | Supabase (PostgreSQL, free tier) |
| Blob storage | Cloudflare R2 |
| Auth | Google OAuth (v2 launch) → ASU CAS/SAML (post-launch) |
| Deployment | Vercel (frontend + Next.js API routes) + Railway (Python service) |
| AI | ASU AIML Platform |

### 6.2 Request Architecture

```
Browser
  └─► Next.js (Vercel)
        ├─ /app routes          — page rendering and Supabase direct reads (RLS)
        ├─ /api/session-*       — authorized media/document proxy routes
        └─ Supabase Auth        — Google OAuth session management

Python FastAPI (Railway)
  ├─ /canvas/*       — Canvas sessions, sync, editor, documents, TagFlow, transfer
  ├─ /health/*       — WCAG audit, orphan/duplicate detection
  ├─ /admin/*        — queue diagnostics and admin-only operations
  └─ /canvas/.../reports/* — Excel/CSV/printable exports and Canvas backup

Workers (Railway)
  └─ background_jobs — PDF, AI, Canvas, transfer, reports, and course creation jobs
```

### 6.3 Canvas Content Caching Strategy

1. On first pull, fetch all content from Canvas and write metadata to
   `course_content_items` and bodies to `course_content_bodies`, with hashes
   used for delta detection.
2. On re-pull, fetch Canvas content, compare hashes — only update rows where hash changed.
3. Cache TTL: 24 hours for metadata, no expiry for content body (user controls re-sync explicitly).
4. Canvas images: on first encounter, download to R2 at `images/canvas-cache/{session_id}/{canvas_image_id}`, serve via signed R2 URL (1-hour expiry). Thumbnail variant generated at ingest (max 400px wide). Editor-uploaded images are cached under `images/editor-uploads/{session_id}/{image_id}` after being uploaded to Canvas Files.

### 6.4 Image Proxy / Lazy Loading

- Image gallery in editor: virtual scroll, load thumbnails in batches of 20
- Full-res image loaded on click/expand only
- Alt text editing stored in `course_images` table, written to Canvas body on push
- Broken Canvas image URLs detected during pull and flagged in health report

### 6.5 Auth & Token Model

- **Google OAuth**: Supabase Auth owns the browser session and access token used
  for frontend reads and FastAPI bearer auth.
- **Canvas PAT**: encrypted at rest in `user_canvas_credentials`,
  `expires_at = now() + 7 days`, prompted for re-entry on expiry. Never
  returned to frontend in plaintext.
- **Canvas OAuth roadmap**: table has `oauth_access_token` + `oauth_refresh_token` columns already; PAT path will be replaced by OAuth exchange once Canvas app is approved.
- **CAS/SAML**: auth service abstracted behind `AuthProvider` interface — swap Google for SAML without changing downstream code.

### 6.6 Modularity

Each major feature area is moving toward a self-contained frontend module plus
matching backend `api/<feature>` and `services/<feature>` boundaries:

```
/modules
  /auth          — providers, token management, middleware
  /sessions      — CRUD, archive, restore
  /canvas-sync   — pull, diff, cache
  /health        — WCAG audit, orphan/dupe detection
  /editor        — content editing, revisions, find-replace, Canvas recovery
  /images        — proxy, thumbnail, alt text
  /links         — link inventory and link text remediation
  /course_creation — doc upload, AI extraction, template render
  /documents     — PDF upload, zone tag, export
  /tagflow       — visual PDF structure review
  /pending_review — staged content/module changes before Canvas push
  /transfer      — Canvas content migration
  /reports       — export generators
  /analytics     — event tracking, admin dashboard
  /errors        — structured logging
```

---

## 7. Performance Requirements

| Metric | Target |
|--------|--------|
| Dashboard load (cold) | < 1.5s |
| Content list (100 items) | < 2s initial, lazy beyond 20 |
| Image gallery (100 images) | Thumbnails in < 3s, lazy beyond first 20 |
| Canvas pull (100 pages) | < 30s with progress indicator |
| Health run (100 pages) | < 60s with progress indicator |
| Push (single item) | < 5s |

---

## 8. Security Requirements

- Canvas PATs encrypted at rest (AES-256 via Supabase vault or app-level)
- No Canvas token returned to frontend in plaintext — backend-only access
- All routes behind JWT auth except `/login` and `/api/images/[id]` (capability URL)
- R2 blobs served via short-lived signed URLs, not public bucket
- CORS restricted to Vercel deployment domain
- Row-level security on Supabase tables (user_id filter on all user-owned tables)
- Error logs redact PII before storage

---

## 9. Migration Strategy

### Phase 1 — Foundation
- Set up Next.js project, connect Supabase, wire Google OAuth
- Implement Supabase schema (see DATA_MODEL.md)
- Port Python FastAPI service to Railway with health check

### Phase 2 — Core Curate
- Canvas sync (pull, cache, incremental re-sync)
- Content list with pagination
- Tiptap editor (port all v1 extensions)
- Push to Canvas

### Phase 3 — Health & Inventory
- WCAG audit engine
- Orphan/duplicate detection
- Content inventory with bulk actions
- Health report export

### Phase 4 — Supporting Tools
- Images (proxy, thumbnail, alt text, batch AI)
- Link text (list, AI suggestions)
- Find & Replace
- Documents / TagFlow (PDF remediation)

### Phase 5 — Create, Documents, Transfer, Reports
- Create workflow (doc upload → AI extract → template → Canvas Clean drafts)
- Documents / TagFlow remediation and Canvas replacement workflow
- Transfer (same-course push, target transfer, Canvas content migration)
- Reports & Downloads

### Phase 6 — Platform Layer / Hardening
- Analytics (events table, admin dashboard)
- Error logging (Supabase + admin viewer)
- Archive (soft delete, 30-day restore, cold storage migration)
- Design-system consolidation and deferred Documents/TagFlow component splits

### Phase 7 — Auth Migration Prep
- CAS/SAML provider stub
- Canvas OAuth token exchange stub
- Documentation for both migrations

---

## 10. Open Questions

| # | Question | Owner |
|---|----------|-------|
| OQ1 | Resolved: internal design system uses the checked-in `CC_Claude_DesignSystem/` reference package, Tailwind tokens in `frontend/src/app/globals.css`, production components in `frontend/src/components/edplus/`, and assets in `frontend/public/edplus/`. | Michael |
| OQ2 | Canvas OAuth — which Canvas app registration handles this for ASU? | Michael |
| OQ3 | R2 cold storage prefix naming convention — align with existing `sessions/` structure? | Michael |
| OQ4 | Admin role — is it a Supabase role flag on the user row, or separate auth? | Michael |
