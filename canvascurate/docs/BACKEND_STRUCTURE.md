# Backend Structure Direction

This document describes the backend layout we want to move toward as the
application is refactored. It is intentionally a target architecture, not a
requirement to move every existing file at once.

## Goals

- Keep HTTP route handlers small and grouped by product capability.
- Move reusable business logic out of large routers and into services that can
  be called by routes, background jobs, scripts, and future export workflows.
- Make new feature work easier to place without adding more behavior to
  `backend/routers/canvas.py`.
- Preserve working behavior while extracting one feature area at a time.

## Target Top-Level Shape

```text
backend/
  api/
    admin/
    canvas/
    course_creation/
    documents/
    editor/
    health/
    images/
    inventory/
    links/
    modules/
    pdf_export/
    pdf_figures/
    pending_review/
    reports/
    sync/
    tagflow/
    transfer/
  integrations/
    aiml/
    canvas/
    r2/
    supabase/
  jobs/
  models/
  services/
    admin/
    course_creation/
    documents/
    editor/
    images/
    inventory/
    links/
    pdf_export/
    pending_review/
    reports/
    transfer/
    storage/
    ai/
  scripts/
```

## Folder Responsibilities

`backend/api/<feature>/`

Owns the FastAPI boundary for one feature area. Route modules should handle
authentication dependencies, request validation, response shaping, status codes,
and calls into services. They should not own long-running business logic,
storage orchestration, AI prompt construction, or background job internals.

Suggested files:

```text
backend/api/tagflow/
  router.py
  schemas.py
  dependencies.py
```

`backend/services/<feature>/`

Owns reusable domain logic for one feature area. Services should be callable
from API routes, background jobs, and scripts. They should avoid depending on
FastAPI request objects unless there is a narrow reason.

Examples:

```text
backend/services/documents/
  records.py
  metadata.py
  analysis.py

backend/services/tagflow/
  state.py
  ai.py
  previews.py
  export_readiness.py

backend/services/pdf_export/
  adapter.py
  validator.py
  readiness.py
  exporter.py
```

`backend/models/`

Owns shared Pydantic/domain models that cross feature boundaries. If a schema
is only used by one API feature, prefer placing it in that feature's
`api/<feature>/schemas.py` during future refactors.

`backend/integrations/`

Owns wrappers around external systems such as Canvas, Supabase, R2, and ASU
AIML. Feature services should call integration helpers instead of duplicating
client-specific details.

`backend/jobs/`

Owns background job orchestration, queue handlers, job status updates, and
worker entry points. Jobs should call feature services for domain behavior.

## Current Refactor Status

- `backend/routers/canvas.py` is now a compatibility router with only
  `/canvas/ping`.
- Feature route ownership has moved under `backend/api/` for editor, images,
  inventory, links, modules, pending review, sync, documents, PDF figures,
  TagFlow, PDF export, course creation, transfer, reports, and admin
  diagnostics. Small compatibility/core routers remain under `backend/routers/`
  for health, credentials, sessions, and `/canvas/ping`.
- Long-running PDF, Canvas, AI, transfer, reports, and course-creation work is
  coordinated through `background_jobs` and `backend/jobs/worker.py`.
- Transfer job entry points stay stable in `backend/jobs/transfer.py`, while
  same-course push, target transfer, course copy, backup, content remap, and
  file migration logic lives under `backend/services/transfer/`.

## Migration Rules

1. New HTTP endpoints should go into `backend/api/<feature>/router.py` unless
   they must stay in an existing router for compatibility.
2. New reusable logic should go into `backend/services/<feature>/`.
3. Avoid adding new behavior to `backend/routers/canvas.py` unless the route is
   tightly coupled to existing Canvas behavior and cannot be moved safely yet.
4. Move existing `canvas.py` routes only when we are already touching that
   feature or have a focused extraction task.
5. Keep old public route paths stable while moving implementation files.
6. Add concise module docstrings or file header comments to new and touched
   backend files so future handoff work can identify ownership quickly.
7. Run focused backend syntax checks and the frontend build after moving route
   registrations or shared request models.

## Follow-Up Extraction Direction

1. Keep new backend feature work out of `backend/routers/canvas.py`.
2. Keep background job files as stable entry points and move reusable domain
   behavior into `backend/services/<feature>/`.
3. Continue splitting large document/TagFlow service helpers only when a focused
   behavior change needs that area.
4. Add focused tests around route registration and service behavior when moving
   a route or job boundary.

The large-router split is complete. The next refactor phase is primarily
frontend design-system consolidation, with deeper Documents/TagFlow component
splits deferred to a later phase.
