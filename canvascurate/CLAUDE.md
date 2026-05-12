# CLAUDE.md - Rewrite Target Architecture (and Current Repo Notes)

This document is for AI-assisted development in this repository.

It has two purposes:
1. Help with work on the current codebase.
2. Define the agreed target architecture for the full rewrite.

## Operating Mode

Before making changes, classify the task:

1. `current-impl` mode
Work against the existing code as it runs today.

2. `rewrite-design` mode
Work on future-state docs, schemas, migration plans, and scaffolding for the rebuild.

If unclear, ask which mode the task is in.

## Current Implementation (Source of Truth for Code Changes)

This section describes the v2 rewrite codebase — the active working implementation.

### Stack
- Frontend: Next.js 15 (App Router) + TypeScript + Tailwind CSS
- Backend: FastAPI (Python) — deployed on Railway
- Database: Supabase Postgres (primary structured store)
- Storage: R2 (blobs only — PDFs, images, exports)
- Auth: Supabase (Google OAuth) — JWT validated server-side via supabase-py

### Run Commands

Frontend:
```bash
cd frontend
npm install
npm run dev      # Next.js dev server (default localhost:3000)
npm run build
npm run lint
```

Backend:
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8081 --reload
```

### Current Environment Files
- `backend/.env` — from `backend/.env.example`
- `frontend/.env.local` — from `frontend/.env.example`
- Frontend env vars use `NEXT_PUBLIC_*` prefix (not `VITE_*`)

### Frontend Layout Architecture

Next.js App Router nests layouts. Each route segment can have a `layout.tsx`.
**Rule: only one layout in a route hierarchy should render the page chrome (SideNav + header).**

Current layout ownership:
- `app/dashboard/layout.tsx` — renders chrome (SideNav, header) for dashboard routes
- `app/sessions/layout.tsx` — **passthrough only** (`return <>{children}</>`) — does NOT render chrome
- `app/sessions/new/layout.tsx` — renders chrome for the new session flow
- `app/sessions/[id]/layout.tsx` — renders chrome with session-specific SideNav for all session workspace routes

Never add SideNav or a top header to a layout that is a child of another layout that already has those elements. Adding chrome to `sessions/layout.tsx` caused a double-wrapped layout with duplicate headers and a squished workspace.

### Backend API Conventions

- **All DB writes go through the Python backend** using the service role key — never write to Supabase tables directly from the browser client.
- **Canvas PAT must be passed via `X-Canvas-Pat` header**, never in a JSON request body. Request bodies can appear in logs; headers are not logged by default.
- **Auth** — `get_current_user()` dependency validates the Supabase JWT on every protected route. Returns `{"sub": user_id, "email": ...}`.

### supabase-py Known Limitations (deployed version)

The deployed version of supabase-py does not support:
- `.select()` chained after `.upsert()` or `.insert()` — use `.execute()` then a separate `.select()` query
- `.maybe_single()` — returns `None` instead of a response object; use `.execute()` and check `result.data` as a list
- `.single()` is fine for explicit single-row selects

### Database Schema Conventions

**RLS is enabled on all tables.** Pattern:
- Backend uses service role key → bypasses RLS for all writes
- Frontend uses user JWT → subject to RLS for all reads

All user-owned tables have a `user_id uuid` column referencing `auth.users(id)`.
Tables confirmed as user-scoped (not shared): `sessions`, `courses`, `course_content_items`, `health_runs`, `user_canvas_credentials`.

**Known column state as of 2026-04-22:**
- `courses` — has `user_id`, `canvas_base_url`, `canvas_course_id`. Does NOT yet have `course_name` (populated by a Canvas API call, not yet implemented).
- `sessions` — has `user_id`, `type`, `status`, `name`, `source_course_id`, `updated_at`.
- `course_content_items` — has `user_id`, `session_id`, `content_type`, `is_orphaned`.
- `health_runs` — has `user_id`, `session_id`, `status`, `items_scanned`, `summary`, `created_at`, `finished_at`.
- `user_canvas_credentials` — has `user_id`, `canvas_base_url`, `credential_type`, `status`, `pat_token_enc`, `expires_at`.

**Do not add `courses(course_name)` FK joins to frontend queries** until `course_name` is populated by the backend. A join on a missing column silently returns null for the entire query result in supabase-js.

## Rewrite Goals (Confirmed)

### Product Scope to Keep
- Curate (course editing)
- Create (document upload to Canvas flow)
- Transfer
- Course Health (WCAG + orphan/duplicate detection)
- Content Inventory
- Edit/View with custom Tiptap editor features
- Images, links, documents/tagflow, find/replace
- Reports and downloads

### Scope Removed
- QA-specific workflow and UI are dropped.

### New Additions
- Archive UX for sessions/revisions/creations/documents
- Improved internal analytics and usage visibility
- Better centralized error logging (not Railway logs only)

## Rewrite Architecture Decisions (Confirmed)

### Tenancy and Identity
- Single tenant: ASU only.
- Auth path: Google OAuth first.
- Planned upgrade path: CAS/SAML SSO later.

### Data Layer
- Use Supabase Postgres as the canonical store for structured data.
- Use R2 for binary blobs only (PDFs, images, exports, archived payloads).
- Do not keep hot-path structured session/course content in R2.

### Canvas Auth Strategy
- Store per-user Canvas credentials with short lifetime policy.
- Weekly expiration for PATs.
- Never store plaintext tokens.
- Planned upgrade path: Canvas OAuth after value proof.

### Soft Delete and Archive
- Soft delete for 30 days.
- After 30 days, move to cold storage in R2.
- Keep restore support during soft-delete window.

### Heavy Processing
- Keep a Python service for PDF remediation, AI pipelines, and Canvas-heavy processing.
- Frontend framework choice does not replace backend job processing requirements.

## Target Modular Boundaries

Design modules as independently testable domains:

1. `auth`
2. `canvas-sync`
3. `course-health`
4. `content-inventory`
5. `editor`
6. `images`
7. `links`
8. `documents-tagflow`
9. `transfer`
10. `reports`
11. `archive`
12. `analytics-observability`

Each module should own:
- DB schema objects
- API contracts
- background jobs
- monitoring metrics

## Data Ownership (Target)

### Postgres (Primary Structured Store)
- users, roles, permissions
- sessions and session metadata
- course content metadata and bodies
- inventory decisions (keep/delete/deployed locations)
- health findings and trend snapshots
- revisions/history metadata
- events and error logs
- job records and statuses

### R2 (Blob Store)
- uploaded PDFs and generated artifacts
- proxied/downloaded image files and derivatives
- exported reports
- cold archive bundles

### Cache / Queue
- short-lived cache for expensive read paths
- background job queue for:
  - Canvas sync
  - image fetch/transform
  - AI alt text/link text/doc tagging
  - PDF remediation pipelines

## Performance and Latency Requirements (Target)

Define and track SLOs on key endpoints:
- dashboard/session list
- course data list endpoints
- image inventory/list
- document list/status

Initial target budgets:
- p50 under 800ms for list endpoints
- p95 under 3000ms
- p99 under 8000ms

Hard rules:
- cursor-based pagination for large collections
- lazy loading on heavy UI sections
- virtualized rendering for long lists
- avoid synchronous full-course fetches on request path
- local read model first, background refresh second

## Canvas Sync Model (Target)

- Use incremental sync with local persistence.
- Avoid fetch-on-every-view behavior.
- Prefer async reconciliation jobs.
- Track sync versions/hash to process deltas only.
- Separate "freshness" indicators from "blocking UI fetches".

## Deployment Topology (Target)

- Frontend app on Vercel (likely Next.js in rewrite).
- Python API/worker service for heavy workloads.
- Postgres + storage on Supabase/R2.
- Optional queue/redis component if needed for durable background execution.

## Security Requirements

- No plaintext Canvas token logging or storage.
- Encrypt sensitive credentials at rest.
- Enforce expiration and revocation paths.
- Add audit logs for privileged actions and destructive operations.
- Retention and archival policies must be explicit and testable.

## Observability Requirements

- Internal events table for product analytics in Supabase.
- Internal error log table with structured fields:
  - source
  - user/session identifiers
  - severity
  - error class/message
  - request/job correlation id
- Emit correlation ids across frontend request -> API -> worker job.

## Scalability Assumptions

Representative heavy usage:
- One instructional designer working across 10-15 courses.
- Heavier cleanup courses around:
  - up to ~100 pages
  - up to ~100 images before additional file processing

Design all list/query surfaces for this scale minimum.

## Rewrite Phasing (Recommended)

1. Foundation
- target schema, module interfaces, shared contracts, auth model

2. Data and Sync
- Canvas sync pipeline, local persistence, pagination-first APIs

3. Core Feature Parity
- dashboard, health, inventory, editor, images, links, find/replace

4. Documents and AI
- tagflow, PDF remediation, AI generation pipelines with queued execution

5. Transfer and Reporting
- migration flows, exports, download/report surfaces

6. Archive and Analytics
- lifecycle jobs, restore flows, product/admin analytics surfaces

7. Cutover
- migration tooling, verification, rollback plan, production hardening

## Agent Guardrails

- Do not assume rewrite docs describe the current running stack.
- When editing current code, follow the current implementation section above.
- When proposing rewrite changes, align with confirmed decisions in this file.
- Keep plans modular and migration-aware (no big-bang assumptions without explicit sign-off).
