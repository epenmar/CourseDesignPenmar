# CanvasCurate v2 Release Checklist

Last updated: 2026-04-29

## Phase 4 Validated Flows

- Page restore from local application history creates a pending revision and pushes back to Canvas.
- Page restore from Canvas-native page revision creates a pending revision and pushes back to Canvas.
- Source-course page replacement works with images and files, copies referenced Canvas files into the active course, rewrites file references, preserves auto-opening page behavior, and pushes into a newly created module.
- Page, assignment, and discussion creation writes local drafts, appears in inventory/editor flows, stages module placement, pushes to Canvas, and repairs missed placements.
- Module creation writes a local module shell, appears immediately in By Module, stages a Pending Review module create operation, and applies to Canvas.
- Classic quiz question edit, add, delete, and push work through the parent quiz flow.
- Quiz-question images appear in the Images queue after resync, stay marked keep when deployed through a quiz, and push alt-text/decorative updates through the parent quiz flow.
- Classic quiz push is blocked when Canvas submissions exist.
- File upload supports supported document/spreadsheet/presentation formats and can hyperlink selected text.
- Inline editor accessibility checks identify and fix supported issues.
- Pending Review can push content changes and apply staged module operations.
- Source-course search supports paginated course access and token-based matching across course name, code, id, SIS id, and term.

## Known V1 Risks

- Source-course replacement copies up to 25 referenced Canvas files per page; pages above that limit require manual handling.
- Source-course files that are inaccessible, empty, or larger than 50 MB fail safely and require manual handling.
- Same-instance course links are rewritten from the source course id to the active course id, but deep validation is still needed for unusual Canvas link formats.
- Long-description rendering for images remains a follow-up.
- Deep document remediation and PDF tagging remain Phase 5.
- Quiz creation is deferred to v2.2/v2.3.
- Module duplicate and shift-date tools are post-launch candidates.
- Additional simple RCE block templates are post-launch candidates.

## Pre-Release Checks

- Confirm Railway backend is running the latest `main` commit.
- Confirm Vercel frontend is running the latest `main` commit.
- Confirm Supabase schema matches `docs/migration.sql`.
- Confirm required environment variables are present for Supabase, Canvas credential encryption, R2, and ASU AIML.
- Run `python3 -m py_compile backend/routers/canvas.py`.
- Run `npm run build` from `frontend/`.
- Run one smoke test against a non-production Canvas course before launch.

## Targeted Regression Checks

- Page, assignment, and discussion image alt/decorative updates create Pending Review revisions and push to Canvas.
- Quiz-question image alt/decorative updates create parent quiz Pending Review entries and push to Canvas without changing quizzes that have submissions.
- Bulk generated alt text and bulk decorative image actions still apply to content and surface in Pending Review.
- Image refresh/resync keeps deployed quiz-question images marked keep and only defaults truly orphaned top-level images to removal.
- Long-description-only image edits remain metadata-only until long-description rendering is implemented.
- New module creation appears immediately in the content queue, can be discarded safely, and applies to Canvas through Pending Review.
