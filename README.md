# Canvas Curate v2

Canvas Curate v2 is a split frontend/backend application for pulling Canvas
course content into a local remediation workflow. The current build supports
authenticated course sync, health scanning, inventory review, rich content
editing, Pending Review, Images and Links remediation, Documents/TagFlow PDF
workflows, Course Creation, Transfer, Reports, and background workers.

Current build status is tracked in [docs/PLAN.md](docs/PLAN.md). The data
model and migration source of truth live in [docs/DATA_MODEL.md](docs/DATA_MODEL.md)
and [docs/migration.sql](docs/migration.sql). Refactor progress is tracked in
[docs/REFACTOR_PHASE_PLAN.md](docs/REFACTOR_PHASE_PLAN.md).

## Repo Layout

- `frontend/`: Next.js 16 App Router UI with Supabase auth and feature modules
- `backend/`: FastAPI API, Canvas sync, workers, health scan, PDF/TagFlow, transfer/report services, image proxy, R2 integration
- `docs/`: build plan, schema docs, and SQL migration
- `Procfile` / `start.sh`: current Railway backend entrypoint from repo root

## Current Scope

Live now:
- Google login via Supabase Auth
- Session creation and Canvas PAT storage
- Background Canvas sync with progress UI
- Course health scans and findings
- Content inventory review with keep/delete/defer
- Tiptap editor with local revision history and Canvas push via Pending Review
- Links inventory
- Images inventory with review state, decorative toggle, alt text, long description, AI generation, and bulk actions
- Image proxying with optional R2 caching
- Documents inventory and detail workflow for PDF remediation/replacement work
- TagFlow page preview and visual zone editing for PDF structure review
- Course Creation draft generation into the Canvas Clean editor workflow
- Transfer readiness, same-course push, target transfer, Canvas course copy, and IMSCC backup
- Reports and downloads for inventory, faculty review, health summary, edit history, printable content, and latest transfer report

Still pending:
- Phase 5 design-system consolidation
- Deeper Documents/TagFlow component splitting, deferred to a later phase
- R2-backed persisted report artifacts for generated downloads
- New Quizzes transfer support and additional Canvas edge-case hardening
- Production queue/backlog alerting beyond the current admin diagnostics view

## Architecture

- `frontend` talks to Supabase for auth and to `backend` for application APIs.
- `backend` uses the Supabase service role for database access and stores encrypted Canvas PATs.
- Canvas sync writes metadata to `course_content_items` and bodies to `course_content_bodies`.
- Health runs write findings to `health_runs` and `health_findings`.
- Extracted images are indexed into `course_images`; extracted links are derived from stored HTML.
- Editor revisions, Pending Review drafts, module operations, and transfer/report jobs use Supabase tables plus `background_jobs`.
- PDF originals, previews, generated artifacts, image binaries, and report/archive payloads are stored or cached in Cloudflare R2 when configured.

## Local Development

### 1. Backend

From the repo root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8081
```

The frontend defaults to `http://localhost:8081` if `NEXT_PUBLIC_API_URL` is not set.

### 2. Frontend

From the repo root:

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:3000` by default.

### 3. Verification

Useful checks:

```bash
python3 -m compileall backend
cd frontend && npm run lint
cd frontend && npx tsc --noEmit
cd frontend && npm run build
```

Note: `npm run build` uses `next/font` with Google Fonts and may need network access in restricted environments.

## Environment Variables

### Frontend

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_API_URL=http://localhost:8081
```

`frontend/.env.local.example` currently includes the Supabase values only.

### Backend

Create `backend/.env` or set vars in your process manager:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret
ALLOWED_ORIGINS=http://localhost:3000
ENCRYPTION_KEY=32-byte-hex-key
```

Optional R2 vars for image caching:

```env
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
```

Notes:
- `ENCRYPTION_KEY` is used for encrypted Canvas PAT storage.
- R2 is optional. Without it, image proxying still works as on-demand authenticated fetches.

## Database Setup

Apply the SQL in [docs/migration.sql](docs/migration.sql) to Supabase before running the app.

This migration includes:
- core course/session tables
- content, bodies, sync runs
- health runs and findings
- image inventory and review state
- module queue operations and Pending Review support
- background job ledger for workers
- reports/documents/archive scaffolding
- RLS policies
- `user_profiles` bootstrap trigger

If schema behavior looks wrong, check [docs/DATA_MODEL.md](docs/DATA_MODEL.md) first.

## Deployment Notes

### Current Railway setup

The current Railway service is started from repo root using:

- [Procfile](Procfile)
- [start.sh](start.sh)

`start.sh` changes into `backend/` and runs Uvicorn, but Railway currently installs Python dependencies from the repo-root [requirements.txt](requirements.txt).

That means:
- root `requirements.txt` must stay in sync with `backend/requirements.txt`, or
- Railway must be reconfigured to build from `backend/`

This matters because backend-only packages like `Pillow` and `boto3` are required for the image proxy path.

### Backend deploy expectations

- Health check path: `/health`
- CORS origins come from `ALLOWED_ORIGINS`
- R2 env vars belong on the backend service only
- Do not expose backend secrets as `NEXT_PUBLIC_*`

### Background worker deploy expectations

Long PDF, Canvas, report, transfer, and AI jobs are inserted into `background_jobs`.
When `CANVASCURATE_USE_WORKER=1` is set on the web service, FastAPI only queues
those rows and does not run them in-process.

Run a separate Railway worker service from the same repo with:

```bash
cd backend && python -m jobs.worker
```

The worker service needs the same backend secrets as the web service, including
Supabase, Canvas/R2, encryption, and AI env vars. Keep `CANVASCURATE_USE_WORKER=1`
on the web service. If the worker is not running, jobs will stay `queued` with
`attempts = 0`.

Useful worker env vars:

- `WORKER_JOB_TYPES`: comma-separated job types or groups for this worker pool. Leave empty to process all supported jobs. Supported groups: `pdf`, `ai`, `canvas`, `transfer`, `course_creation`, `reports`, and `all`.
- `WORKER_POLL_INTERVAL_SECONDS`: default `5`.
- `WORKER_STALE_CHECK_INTERVAL_SECONDS`: default `60`.
- `PDF_REMEDIATION_MAX_ACTIVE_JOBS_PER_USER`: default `3`.
- `TAGFLOW_PREVIEW_MAX_PAGES_PER_JOB`: default `12` for manual preview generation requests.
- `TAGFLOW_AUTO_PREVIEW_MAX_PAGES_PER_JOB`: default `0` to generate every page after PDF remediation. Set a positive value to cap automatic preview jobs.
- `TAGFLOW_AI_MAX_ACTIVE_JOBS_PER_USER`: default `2`.
- `IMAGE_TEXT_MAX_ACTIVE_JOBS_PER_USER`: default `4`.
- `IMAGE_TEXT_BULK_MAX_ACTIVE_JOBS_PER_USER`: default `1`.
- `PDF_FIGURE_TEXT_MAX_ACTIVE_JOBS_PER_USER`: default `4`.
- `LINK_TEXT_BULK_MAX_ACTIVE_JOBS_PER_USER`: default `1`.

Suggested launch split:

- PDF worker: `WORKER_JOB_TYPES=pdf`
- AI worker: `WORKER_JOB_TYPES=ai`
- Canvas/report worker: `WORKER_JOB_TYPES=canvas,transfer,reports`

The explicit equivalent of the first two split workers is:

- PDF worker: `document_analysis,document_remediation,document_structure_preview,pdf_export`
- AI worker: `tagflow_ai_suggestions,image_text_generate,image_text_bulk_generate,pdf_figure_text_generate,link_text_bulk_suggest,course_creation_outline,course_creation_draft`

For the current testing load, start with one web service plus `worker-pdf` and
`worker-ai`. Add the Canvas/report worker when Canvas pulls, transfers, and IMSCC
backup exports are competing with review work. The worker logs its effective job
types and polling interval on startup, which is the fastest way to confirm the
Railway service is claiming the intended queue.

### Frontend deploy expectations

- Needs `NEXT_PUBLIC_SUPABASE_URL`
- Needs `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Needs `NEXT_PUBLIC_API_URL` pointing at the deployed FastAPI service

## Common Workflows

### Create a session and sync a course

1. Sign in through the frontend.
2. Add or refresh the Canvas PAT.
3. Create a session from `/sessions/new`.
4. Start a sync.
5. Review results in Course Health, Inventory, Images, or Links.

### Image workflow

1. Sync the course.
2. Open `/sessions/[id]/images`.
3. Filter by deployed, broken, or orphaned.
4. Review keep/remove/defer state.
5. Edit decorative state, alt text, and long description.
6. Use preview modal to inspect the image and, when available, the content context.

### Documents / TagFlow workflow

1. Sync a Canvas course or upload a standalone document.
2. Open `/sessions/[id]/documents`.
3. Queue PDF review/remediation for a supported PDF.
4. Review document detail, figure metadata, findings, replacement readiness, and TagFlow page previews.
5. Open TagFlow to edit page zones and mark reviewed pages remediated.
6. Queue PDF export or Canvas replacement/deploy work when the document is ready.

### Transfer and reports workflow

1. Review Pending Review items and inventory decisions.
2. Open `/sessions/[id]/transfer` and confirm readiness.
3. Validate a target Canvas course or select same-course push.
4. Queue backup, course copy, target transfer, or same-course push as appropriate.
5. Open `/sessions/[id]/reports` for inventory, faculty review, health, edit-history, printable content, backup, and latest transfer outputs.

## Known Gaps

- Broken image detection is strongest after proxy fetch attempts or cross-course URL detection.
- Design-system primitives are still being consolidated; many feature screens still hand-author common UI states.
- `DocumentDetailManager` and `TagFlowStructurePreview` remain large module components and are planned for a later focused split.
- R2-backed report records are scaffolded, but several downloads are generated directly from current Supabase data.
- New Quizzes remain a transfer hardening item.

## Related Docs

- [docs/PLAN.md](docs/PLAN.md)
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md)
- [docs/migration.sql](docs/migration.sql)
- [docs/REFACTOR_PHASE_PLAN.md](docs/REFACTOR_PHASE_PLAN.md)
