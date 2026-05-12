# Refactor Phase Plan

This plan turns the large-router and large-component cleanup into phased work.
It is intended to guide incremental refactors without changing public URLs or
shipping behavior all at once.

## Goals

- Keep working workflows stable while moving code into feature-owned modules.
- Stop adding new behavior to `backend/routers/canvas.py` and large frontend
  files in `frontend/src/components/ui`.
- Make Pending Review available from every active session route.
- Create a clear home for reusable design-system components before more UI is
  refactored.
- Add concise file-level ownership notes to new and significantly touched files.

## Phase 0: Baseline and Guardrails

Checklist:
- [x] Record current large-file targets and intended ownership.
- [x] Keep route paths, Supabase tables, and Canvas API behavior unchanged.
- [x] Add focused smoke checks around moved routes/components as each phase lands.

Primary files:
- `docs/BACKEND_STRUCTURE.md`
- `docs/FRONTEND_STRUCTURE.md`
- `docs/REFACTOR_PHASE_PLAN.md`

Exit criteria:
- [x] New code has a clear target folder.
- [ ] New feature work avoids `backend/routers/canvas.py` unless explicitly scoped.
- [ ] New feature UI avoids `frontend/src/components/ui` unless it is reusable UI.

## Phase 1: Session Shell and Pending Review

Checklist:
- [x] Move Pending Review out of `ContentEditorWorkspace`.
- [x] Mount a session-level Pending Review button/modal from the session shell,
  with the launcher in the sidebar utility area because it is tied to the
  active session.
- [x] Preserve the existing `canvascurate:pending-changes-updated` event contract
  so Links, Documents, Edit, Course Creation, and module tools keep refreshing
  review state.
- [x] Keep content push and module apply endpoints stable while frontend ownership
  moves.
- [x] Move Canvas token status out of the header and into the sidebar utility
  area.
- [x] Show a checkmark when Pending Review has no items and a count when items
  are ready to review.

Target frontend structure:

```text
frontend/src/modules/pending_review/
  api/pendingReviewClient.ts
  components/
    PendingReviewButton.tsx
    PendingReviewModal.tsx
    PendingContentChanges.tsx
    PendingModuleChanges.tsx
    PushHistoryPanel.tsx
    ModuleApplyHistoryPanel.tsx
  hooks/
    usePendingReview.ts
  types.ts
  utils.ts
```

Frontend progress:
- [x] Created `frontend/src/modules/pending_review/api/pendingReviewClient.ts`.
- [x] Created `frontend/src/modules/pending_review/components/PendingReviewWidget.tsx`.
- [x] Created `frontend/src/modules/pending_review/types.ts`.
- [x] Split `PendingReviewWidget.tsx` into smaller panel/list components.
- [x] Extract `usePendingReview.ts` once the widget has stabilized.

Target backend structure:

```text
backend/api/pending_review/
  router.py
  schemas.py
backend/services/pending_review/
  content_changes.py
  content_push.py
  module_operations.py
  push_history.py
```

Backend progress:
- [x] Move Pending Review routes out of `backend/routers/canvas.py`.
- [x] Move Pending Review service logic into `backend/services/pending_review/`.
- [x] Add focused backend checks for moved Pending Review endpoints.
- [x] Created `backend/api/pending_review/router.py` as the route owner while
  handler bodies are delegated to the legacy Canvas module during service
  extraction.
- [x] Moved push and module apply history read models into
  `backend/services/pending_review/push_history.py`.
- [x] Moved pending content change and pending diff read models into
  `backend/services/pending_review/content_changes.py`.
- [x] Moved active module operation list, stage, and discard paths into
  `backend/services/pending_review/module_operations.py`.
- [x] Removed legacy unregistered module operation handler bodies from
  `backend/routers/canvas.py`.
- [x] Added route registration coverage for the extracted Pending Review router.
- [x] Consolidated module operation response/discard helpers under
  `backend/services/pending_review/module_operations.py`.
- [x] Moved the module operation apply request schema into
  `backend/api/pending_review/schemas.py`.
- [x] Moved regular module item apply behavior into
  `backend/services/pending_review/module_operations.py`.
- [x] Moved module item reorder apply behavior into
  `backend/services/pending_review/module_operations.py`.
- [x] Moved module rename/delete apply behavior into
  `backend/services/pending_review/module_operations.py`.
- [x] Moved module reorder apply behavior into
  `backend/services/pending_review/module_operations.py`.
- [x] Moved module create apply behavior into
  `backend/services/pending_review/module_operations.py`.
- [x] Moved module operation apply orchestration into
  `backend/services/pending_review/module_operations.py`.
- [x] Moved the module operation apply route wrapper into
  `backend/api/pending_review/router.py`.
- [x] Moved content push request schema, route wrapper, and service logic into
  Pending Review modules.

Exit criteria:
- [x] Pending Review is available from all active session routes.
- [x] `ContentEditorWorkspace` no longer owns Pending Review state or modal UI.
- [x] Existing content push and module operation workflows still pass manual smoke
  tests.

## Phase 2: Editor Module Extraction

Checklist:
- [x] Move the editor workspace from generic UI into `modules/editor`.
- [x] Extract Tiptap extensions, toolbar, slash commands, uploads, accessibility
  checks, source replacement, AI generation, and modal surfaces into separate
  files.
- [x] Keep the route-level import stable through a temporary re-export if needed.

Frontend progress:
- [x] Moved the main workspace implementation to
  `frontend/src/modules/editor/components/ContentEditorWorkspace.tsx`.
- [x] Added `frontend/src/components/ui/ContentEditorWorkspace.tsx` as a
  compatibility re-export for existing route imports.
- [x] Updated the edit route to import the editor module directly and removed
  the temporary `components/ui` compatibility re-export.
- [x] Added `frontend/src/modules/editor/README.md` to document the module
  boundary and staged extraction plan.
- [x] Extracted shared extension attribute helpers plus Canvas table/link
  extensions into `frontend/src/modules/editor/extensions/`.
- [x] Extracted style preservation, Canvas wrapper, callout, accordion,
  separator, and span/sub/sup extensions into `frontend/src/modules/editor/extensions/`.
- [x] Extracted `ResizableCanvasImage` into
  `frontend/src/modules/editor/extensions/ResizableCanvasImage.ts`.
- [x] Extracted `HtmlBlock` plus its HTML/LaTeX edit event payload types into
  `frontend/src/modules/editor/extensions/HtmlBlock.ts`.
- [x] Extracted reusable HTML escaping and content block markup builders into
  `frontend/src/modules/editor/utils/`.
- [x] Extracted accessibility issue detection and automatic HTML fix helpers
  into `frontend/src/modules/editor/utils/accessibility.ts`.
- [x] Extracted find/replace matching, HTML replacement, and browser highlight
  helpers into `frontend/src/modules/editor/utils/findReplace.ts`.
- [x] Extracted the Accessibility Check panel into
  `frontend/src/modules/editor/components/AccessibilityCheckPanel.tsx`.
- [x] Extracted the floating AI selection toolbar into
  `frontend/src/modules/editor/components/AISelectionToolbar.tsx`.
- [x] Extracted shared toolbar primitives into
  `frontend/src/modules/editor/components/ToolbarPrimitives.tsx`.
- [x] Extracted toolbar styling, block indent, pill badge, and styled table
  helpers into `frontend/src/modules/editor/utils/toolbar.ts`.
- [x] Extracted the main editor toolbar into
  `frontend/src/modules/editor/components/EditorToolbar.tsx`.
- [x] Extracted the slash command menu into
  `frontend/src/modules/editor/components/SlashCommandMenu.tsx`.
- [x] Extracted HTML block, video embed, and LaTeX modal surfaces into dedicated
  editor component files.
- [x] Extracted the uploaded image review modal into
  `frontend/src/modules/editor/components/ImageReviewModal.tsx`.
- [x] Extracted the AI content generation modal into
  `frontend/src/modules/editor/components/AIGenerateModal.tsx`.
- [x] Extracted the Identify Issue modal into
  `frontend/src/modules/editor/components/IdentifyIssueModal.tsx`.
- [x] Extracted the local revision history panel into
  `frontend/src/modules/editor/components/RevisionHistoryPanel.tsx`.
- [x] Extracted find/replace behavior into
  `frontend/src/modules/editor/hooks/useEditorFindReplace.ts`.
- [x] Extracted the find/replace control row into
  `frontend/src/modules/editor/components/FindReplaceBar.tsx`.
- [x] Created `frontend/src/modules/editor/api/editorClient.ts` and moved local
  revision, save, restore, and Canvas push editor API calls into it.
- [x] Extracted editor draft save, local revision history, restore, dirty-state,
  and Canvas push orchestration into
  `frontend/src/modules/editor/hooks/useEditorContentSave.ts`.
- [x] Moved Identify Issue recovery, source-course lookup, issue flag, and
  source-page replacement API calls into `frontend/src/modules/editor/api/editorClient.ts`.
- [x] Extracted Identify Issue modal state, Canvas revision recovery, source
  course replacement, and issue flag orchestration into
  `frontend/src/modules/editor/hooks/useEditorIdentifyIssue.ts`.
- [x] Moved editor image/file upload and image review generation/save API calls
  into `frontend/src/modules/editor/api/editorClient.ts`.
- [x] Extracted editor image/file upload orchestration and image review state into
  `frontend/src/modules/editor/hooks/useEditorUploads.ts`.
- [x] Moved editor AI rewrite and AI content generation API calls into
  `frontend/src/modules/editor/api/editorClient.ts`.
- [x] Extracted editor AI rewrite, accessibility link-text improvement, and AI
  content generation modal state into
  `frontend/src/modules/editor/hooks/useEditorAI.ts`.
- [x] Extracted preview iframe document rendering into
  `frontend/src/modules/editor/utils/preview.ts`.
- [x] Cleanup: improve HTML-mode find navigation so cycling matches scrolls the
  textarea to the active match.
- [x] Documented future diff/compare work as deferred rather than a Phase 2
  blocker.

Target structure:

```text
frontend/src/modules/editor/
  api/editorClient.ts
  components/
    ContentEditorWorkspace.tsx
    EditorToolbar.tsx
    SlashCommandMenu.tsx
    AccessibilityCheckPanel.tsx
    ImageReviewModal.tsx
    AIGenerateModal.tsx
    HtmlBlockModal.tsx
    LatexModal.tsx
    IdentifyIssueModal.tsx
    RevisionHistoryPanel.tsx
    FindReplaceBar.tsx
  extensions/
    AccordionBlock.ts
    CalloutBlock.ts
    HtmlBlock.ts
    PreserveStyles.ts
    ResizableCanvasImage.ts
    SpanStyle.ts
    StyledSeparator.ts
    CanvasLink.ts
    CanvasTable.ts
  hooks/
    useEditorAI.ts
    useEditorFindReplace.ts
    useEditorIdentifyIssue.ts
    useEditorUploads.ts
    useEditorContentSave.ts
  utils/
    accessibility.ts
    contentBlocks.ts
    findReplace.ts
    html.ts
    preview.ts
  types.ts
```

Exit criteria:
- [x] The workspace shell is small enough to read as composition and state wiring.
- [x] Tiptap extensions can be tested or changed without touching workspace UI.
- [x] Editor API paths are centralized in `editorClient.ts`.

## Phase 3: Legacy Canvas Router Split

Checklist:
- [x] Move endpoint groups out of `backend/routers/canvas.py` one feature at a time.
- [x] Route prefixes remain `/canvas/...` for compatibility.
- [x] Shared business logic moves to services before or during route moves.
- [x] Phase 3 is complete; `backend/routers/canvas.py` is now a compatibility
  router with only the `/canvas/ping` endpoint.

Suggested extraction order:
- [x] Pending Review and module operations.
- [x] Editor content save, revisions, source replacement, and Canvas push.
- [x] Images and image text generation.
- [x] Links and link text generation.
- [x] Inventory decisions.
- [x] Remaining document/TagFlow helpers not already covered by existing modules.

Backend progress:
- [x] Created `backend/api/editor/router.py` as the route owner for editor
  content save, local revisions, Canvas revision recovery, source-course
  replacement, and issue flag routes while handler bodies delegate to the legacy
  Canvas module pending service extraction.
- [x] Confirmed editor content push remains owned by
  `backend/api/pending_review/router.py`.
- [x] Added route registration coverage for the extracted editor router.
- [x] Created `backend/api/images/router.py` as the route owner for image
  inventory, editor image uploads, image review updates, apply-to-content, image
  asset reads, and AI image text generation.
- [x] Added route registration coverage for the extracted Images router.
- [x] Moved image accessibility generation/apply schemas into
  `backend/api/images/schemas.py`.
- [x] Moved image AI text generation, bulk image text jobs, get-image hydration,
  and apply-to-content behavior into `backend/services/images/text.py`.
- [x] Moved image inventory, bulk review updates, editor image uploads, image
  review updates, and asset reads into `backend/services/images/inventory.py`.
- [x] Moved shared Canvas course file upload helpers into
  `backend/services/canvas_uploads.py` for image uploads, editor file uploads,
  and source-course asset remapping.
- [x] Moved session-wide Find/Replace schemas, visible-text matching, and apply
  behavior into `backend/api/editor/` and `backend/services/editor/`.
- [x] Moved editor AI rewrite/generate schemas and service behavior into
  `backend/api/editor/` and `backend/services/editor/`.
- [x] Moved editor file upload route behavior into
  `backend/services/editor/file_upload.py` and moved the shared lightweight PDF
  probe into `backend/services/documents/pdf_probe.py`.
- [x] Created `backend/api/links/router.py` as the route owner for link
  inventory, AI link text suggestions, and link text apply-to-review routes.
- [x] Added route registration coverage for the extracted Links router.
- [x] Moved link text request schemas into `backend/api/links/schemas.py`.
- [x] Moved link inventory, AI suggestion orchestration/job runner, text
  replacement, and apply-to-review behavior into
  `backend/services/links/text.py`.
- [x] Moved shared content revision helpers into
  `backend/services/content_revisions.py`.
- [x] Created `backend/api/inventory/router.py` as the route owner for the
  content inventory feed and keep/remove/defer inventory decision routes while
  handler bodies delegate to the legacy Canvas module pending service
  extraction.
- [x] Added route registration coverage for the extracted Inventory router.
- [x] Moved inventory decision request schemas into
  `backend/api/inventory/schemas.py`.
- [x] Moved inventory listing, default decision seeding, linked assignment/quiz
  decision expansion, file-reference reconciliation, and keep/remove/defer
  write behavior into `backend/services/inventory/decisions.py`.
- [x] Moved generated TagFlow page preview asset delivery into
  `backend/api/tagflow/router.py`.
- [x] Added route registration coverage for the extracted TagFlow preview asset
  routes.
- [x] Moved TagFlow preview response signing/compaction into
  `backend/services/tagflow_assets.py`.
- [x] Moved the TagFlow document summary route into
  `backend/api/tagflow/router.py`.
- [x] Moved TagFlow preview and AI suggestion queue route wrappers into
  `backend/api/tagflow/router.py`.
- [x] Moved TagFlow page zone update route into
  `backend/api/tagflow/router.py`.
- [x] Moved PDF figure asset, review, and text generation route wrappers into
  `backend/api/pdf_figures/router.py`.
- [x] Added route registration coverage for extracted PDF figure routes.
- [x] Moved TagFlow selected-zone figure text generation route wrapper into
  `backend/api/tagflow/router.py`.
- [x] Moved document analysis, remediation, and analysis status route wrappers
  into `backend/api/documents/router.py`.
- [x] Moved document inventory list and detail route wrappers into
  `backend/api/documents/router.py`.
- [x] Moved document replacement upload, reference review, deploy queue, and
  archive queue route wrappers into `backend/api/documents/router.py`.
- [x] Added route registration coverage for extracted document routes.
- [x] Created `backend/api/sync/router.py` as the route owner for Canvas course
  preview, Canvas pull queueing, job lookup, and sync status routes.
- [x] Added route registration coverage for extracted Canvas sync routes.
- [x] Created `backend/api/modules/router.py` as the route owner for module
  graph and local module creation routes.
- [x] Added route registration coverage for extracted module routes.
- [x] Moved read-only editor content preview, detail, and list behavior into
  `backend/services/editor/content_read.py`.
- [x] Added route registration coverage for extracted read-only editor content
  routes.
- [x] Moved local editor content creation into
  `backend/services/editor/content_create.py`.
- [x] Added route registration coverage for the extracted local content creation
  route.
- [x] Moved editor content save, local revision list/restore, and issue flag
  behavior into `backend/services/editor/content_save.py`.
- [x] Moved Canvas page revision recovery, source-course lookup, source page
  replacement, and source asset remapping into
  `backend/services/editor/canvas_recovery.py`.
- [x] Moved classic quiz question list/create/update/delete behavior into
  `backend/services/editor/quiz_questions.py`.
- [x] Added route registration coverage for extracted classic quiz question
  routes.
- [x] Moved Canvas content push payload, created-item metadata, and new-content
  module placement helpers into `backend/services/pending_review/content_push_helpers.py`.
- [x] Moved Pending Review content change helpers into
  `backend/services/pending_review/content_helpers.py`.
- [x] Removed the Pending Review route wrapper dependency on
  `backend/routers/canvas.py` for session ownership and Canvas course lookup.
- [x] Moved document inventory lookup helpers and document asset storage/source
  byte helpers into `backend/services/documents/`.
- [x] Moved document replacement candidate persistence, deployment, selected
  reference rewrite, and original archive jobs into
  `backend/services/documents/replacements.py`.
- [x] Moved document analysis metadata updates and analysis job execution into
  `backend/services/documents/analysis.py`.
- [x] Moved TagFlow AI suggestion job wrappers into
  `backend/services/documents/tagflow_jobs.py`.
- [x] Moved TagFlow preview rendering, preview status updates, asset application,
  and preview job orchestration into
  `backend/services/documents/tagflow_previews.py`.
- [x] Moved PDF figure AI text generation payload handling and job execution into
  `backend/services/pdf_figure_text.py`.
- [x] Moved PDF remediation planning, figure asset caching, and remediation job
  execution into `backend/services/documents/remediation.py`.
- [x] Moved document detail work-history read-model helpers into
  `backend/services/documents/work_history.py`.

Follow-up behavior cleanup:
- [ ] Sync PDF figure decorative state with linked TagFlow artifact state after
  route extraction is stable.
- [ ] Preserve the previous TagFlow tag before automatically switching a linked
  figure zone to `Artifact`.
- [ ] Decide and test whether manually marking a TagFlow zone as `Artifact`
  should also mark the linked PDF figure decorative.

Exit criteria:
- [x] `canvas.py` becomes a compatibility router or disappears.
- [x] New backend tests target feature services/routes, not one giant router.

## Phase 4: Documents, TagFlow, Transfer

Checklist:
- [x] Move document detail UI out of `components/ui`.
- [x] Move TagFlow structure preview into `modules/tagflow`.
- [x] Split transfer job orchestration into services for same-course push, target
  transfer, course copy, backup, content remap, and file migration.

Target frontend moves:
- [x] `DocumentDetailManager` -> `frontend/src/modules/documents/components`
- [x] `DocumentsManager` -> `frontend/src/modules/documents/components`
- [x] `TagFlowStructurePreview` -> `frontend/src/modules/tagflow/components`

Target backend moves:
- [x] `backend/jobs/transfer.py` remains the stable worker/API job entry point.
- [x] Transfer domain logic moves into `backend/services/transfer/*.py`.

Backend progress:
- [x] Extracted target-course content link discovery/remapping into
  `backend/services/transfer/content_remap.py`.
- [x] Extracted referenced Canvas file migration into
  `backend/services/transfer/file_migration.py`.
- [x] Moved target-course IMSCC backup job behavior into
  `backend/services/transfer/target_backup.py`.
- [x] Extracted Canvas course-copy API helpers into
  `backend/services/transfer/course_copy.py`.
- [x] Moved the remaining Transfer job orchestration body from
  `backend/jobs/transfer.py` into
  `backend/services/transfer/job_orchestration.py`, leaving the job module as a
  short compatibility entry point.
- [x] Extracted shared Transfer job helpers/constants into
  `backend/services/transfer/shared.py`.
- [x] Moved same-course push orchestration into
  `backend/services/transfer/same_course_push.py`.
- [x] Moved target-course push orchestration into
  `backend/services/transfer/target_transfer.py`.
- [x] Moved course-copy job orchestration into
  `backend/services/transfer/course_copy_job.py`.
- [x] Reduced `backend/services/transfer/job_orchestration.py` to a short
  service-level compatibility entry point.

Exit criteria:
- [x] Document, TagFlow, and Transfer ownership boundaries are clear enough to
  move forward. Deeper `DocumentDetailManager` and `TagFlowStructurePreview`
  component splits are deferred to a later frontend phase after design-system
  primitives land.
- [x] Background job entry points are short orchestration functions.

## Phase 5: Design System Consolidation

Checklist:
- [x] Introduce a reusable design-system layer that feature modules can consume.
- [x] Add ASU EdPlus brand tokens, font fallback, shell styling, and brand assets.
- [x] Add an EdPlus component showcase route for implementation review.
- [ ] Move generic primitives out of feature components as they are touched.
- [ ] Migrate reusable feedback, navigation, and data-display patterns into the
  design-system layer instead of recreating them in feature modules.
- [ ] Keep product-specific workflow components in `modules/<feature>`.
- [x] Reserve bottom-right floating placement for future global tools such as user
  feedback. Session-specific controls such as Pending Review should live in the
  session shell/sidebar or a coordinated app dock instead of competing for the
  same viewport corner.

Current target structure:

```text
frontend/src/components/
  edplus/
    Alert.tsx
    Badge.tsx
    BulkActionBar.tsx
    Button.tsx
    Card.tsx
    ConfirmDialog.tsx
    DataTable.tsx
    Divider.tsx
    EmptyState.tsx
    FilterBar.tsx
    Input.tsx
    Modal.tsx
    Pagination.tsx
    SearchInput.tsx
    Skeleton.tsx
    StatusBadge.tsx
    Tabs.tsx
    index.ts
  layout/
    AppHeader.tsx
    SideNav.tsx
    SessionShell.tsx
frontend/src/app/edplus-components/page.tsx
frontend/public/edplus/
  icons/
  logos/
```

CSS and token guidance:
- [x] Keep Tailwind theme tokens in `frontend/src/app/globals.css` until a stronger
  token pipeline is needed.
- [ ] Keep reusable class recipes and variant maps inside the EdPlus components
  for now; extract to `frontend/src/components/edplus/variants.ts` only when
  multiple components share the same recipe.
- [x] Put usage rules, component states, accessibility expectations, migration
  notes, and `DataTable` versus custom layout guidance in
  `frontend/src/components/edplus/README.md`.

Rollout plan:
- [x] Phase 5A - Foundation: install brand tokens, font fallback, app shell
  refresh, assets under `frontend/public/edplus/`, and the
  `/edplus-components` showcase route.
- [x] Phase 5B - Primitives: standardize `Button`, `Input`, `Card`, `Modal`,
  `Badge`, `Divider`, and `StatusBadge`; replace hand-authored buttons, inputs,
  badges, card shells, and modal frames when touching feature modules.
- [ ] Phase 5C - Feedback components: standardize `Alert`, `ConfirmDialog`,
  `EmptyState`, `Skeleton`, toast/banner patterns, loading states, destructive
  confirmations, and retry/error copy. Start with Documents, Transfer, Pending
  Review, and Course Creation because those screens duplicate the most feedback
  UI.
- [ ] Phase 5D - Navigation components: standardize `Tabs`, `SearchInput`,
  `FilterBar`, pagination controls, segmented controls, and app-shell placement
  rules. Keep route-level chrome in layout components, but move reusable tab,
  search, filter, and pagination behavior into `components/edplus`.
- [ ] Phase 5E - Data components: standardize `DataTable`, `BulkActionBar`,
  row-action menus, selectable rows, sortable columns, table skeletons, and
  empty states. `DataTable` and `BulkActionBar` exist, are represented in the
  `/edplus-components` showcase, and `DataTable` is used in Admin Diagnostics,
  but broad adoption across inventory-like screens is still in progress.
- [ ] Phase 5F - Migration cleanup: remove duplicated styling utilities after
  consumers move to EdPlus components, document remaining exceptions, and keep
  product-specific API/state logic inside `modules/<feature>`.

Migration order:
- [x] Inventory and dashboard list/card surfaces.
- [x] Documents, images, and links manager filters, empty states, and tables.
- [x] Pending Review modal internals and Transfer review lists.
- [x] Editor modal frames, toolbar controls, and feedback panels.
- [x] Course Creation and Reports workspaces.
- [x] Admin diagnostics tables and status surfaces.

Primitive adoption notes:
- [x] Added semantic rendering support to the shared `Card` primitive so route
  sections can use shared card styling without losing section semantics.
- [x] Added `ButtonLink` for button-styled internal navigation, keeping route
  actions on the shared `Button` variants without invalid button/link nesting.
- [x] Migrated Course Health alerts, status cards, summary cards, and severity
  pills to shared `Alert`, `ButtonLink`, `Card`, `CardHeader`, and `Badge`
  primitives.
- [x] Migrated Dashboard primary action links and Course Creation exported-state
  navigation to `ButtonLink`.
- [x] Migrated Course Creation outline title/module text fields to the shared
  `Input` primitive while leaving textareas/selects for a dedicated form-control
  pass.
- [x] Migrated the Canvas token dialog to shared `Modal`, `Input`, `Alert`, and
  `Button` primitives while preserving the custom sidebar status trigger.
- [x] Migrated session route stubs to shared `Card` and `ButtonLink`.
- [x] Migrated reusable Canvas sync and Health scan controls to the shared
  `Button` primitive while preserving their polling/status behavior.
- [x] Migrated the TagFlow preview generation prompt to shared `Card`, `Button`,
  and `Alert` primitives.
- [x] Migrated create-content and create-module dialogs to shared `Modal`,
  `Input`, `Alert`, and `Button` primitives while preserving their local
  pending-review staging behavior.
- [x] Migrated editor workspace header actions and AI selection toolbar actions
  to the shared `Button` primitive.
- [x] Migrated Identify Issue footer actions and Accessibility Check panel
  controls to shared `Button`/`ButtonLink` primitives.
- [x] Migrated Find/Replace navigation and close controls to the shared `Button`
  primitive.
- [x] Migrated document remediation/export, replacement deployment, and PDF
  metadata save actions to the shared `Button` primitive.
- [x] Migrated TagFlow page actions and document inventory row actions to shared
  `Button`/`ButtonLink` primitives.
- [x] Migrated TagFlow preview modal navigation and close controls to the shared
  `Button` primitive.
- [x] Migrated Images and Links item-level actions to shared `Button` and
  `ButtonLink` primitives.
- [x] Migrated original-file cleanup controls and inventory table row actions to
  shared `Button`/`ButtonLink` primitives.
- [x] Migrated quiz question panel shell, feedback messages, action buttons, and
  editable answer fields to shared `Card`, `Alert`, `Button`, and `Input`
  primitives; updated the quiz rich-text toolbar and answer actions to use
  visible labels instead of ambiguous icon-only controls.
- [x] Migrated module queue action menus, staged-state pills, and rename/delete
  dialogs to shared `Button`, `Badge`, `Input`, and `Modal` primitives.
- [x] Completed broad primitive pass. Remaining hand-authored links are mostly
  breadcrumbs, inline Canvas/source links, or feature-specific preview controls;
  convert those only when they become action-style links or when their parent
  surfaces are touched in 5C-5F.

Data component adoption backlog:
- [x] Build shared `DataTable` with loading, empty state, row actions,
  selectable rows, sorting hooks, and resizable columns.
- [x] Build shared `BulkActionBar` with selected count, clear selection,
  primary/secondary actions, destructive action styling, and loading states.
- [x] Add `BulkActionBar` placement modes so inventory-like pages can opt into a
  viewport-fixed action bar for long scrolling lists.
- [x] Add `DataTable` and `BulkActionBar` examples to `/edplus-components`.
- [x] Adopt `DataTable` in Admin Diagnostics for Active Job Types and Recent
  Jobs.
- [x] Adopt `BulkActionBar` in `ImagesManager` for selected image review,
  generation, decorative-state, and apply-to-content actions.
- [x] Adopt `BulkActionBar` in `LinksManager` for selected link suggestion and
  Pending Review submission actions.
- [x] Adopt `BulkActionBar` in `InventoryTable` for selected keep/delete/defer
  decisions.
- [x] Evaluate `DataTable` adoption in `InventoryTable`; converted because the shared
  table can preserve preview, decision controls, pagination, and bulk-selection
  behavior without reducing usability.
- [ ] Evaluate `DataTable` adoption in Documents, Images, Links, Reports, and
  Transfer list surfaces; convert true tabular lists and leave custom review
  cards/previews as feature-specific components when they are more usable.
- [x] Document when a feature should use `DataTable` versus a custom card/list
  layout in `frontend/src/components/edplus/README.md`.

Placement rule:
- [ ] If a component is generic and reusable across features, it belongs in
  `components/edplus`.
- [ ] If a component knows about sessions, Canvas content, documents, TagFlow,
  Transfer, reports, or API payloads, it belongs under `modules/<feature>`.
- [ ] If a component owns app chrome, navigation, or shell layout, it belongs under
  `components/layout`.

Exit criteria:
- [ ] New screens use shared buttons, dialogs, tabs, badges, inputs, and empty
  states.
- [ ] Feedback, navigation, and data-display components have first-class shared
  implementations and are represented on `/edplus-components`.
- [ ] Feature modules stop hand-authoring common UI states.
- [ ] Design updates can be made centrally without editing every workflow.
- [ ] `npm run build` passes after each migration slice.

## Verification Pattern

For backend route/service moves:
- [ ] `python3 -m compileall backend`
- [ ] Focused API smoke test for the moved endpoint.

For frontend component moves:
- [x] `npm run build`
- [x] Manual route smoke test for the affected session route.

For design-system updates:
- [x] Check collapsed and expanded sidebar states.
- [ ] Check mobile and desktop widths for dialogs and toolbar-heavy screens.
- [ ] Confirm keyboard focus and disabled states remain visible.
