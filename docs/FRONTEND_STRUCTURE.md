# Frontend Structure Direction

This document describes the frontend layout we want to move toward as the app
is refactored. It is a target architecture for new work and gradual extraction,
not a requirement to rewrite existing screens in one pass.

## Goals

- Keep route files and screen managers small enough to reason about quickly.
- Group UI, state, API clients, and helpers by product capability.
- Avoid adding more behavior to mega components such as document detail and
  TagFlow editor files.
- Make reference-app parity work easier by porting focused components instead
  of merging entire legacy screens.
- Preserve current URLs and workflows while extracting one feature slice at a
  time.

## Target Top-Level Shape

```text
frontend/src/
  app/
    sessions/
    api/
  components/
    ui/
    common/
    layout/
    design-system/
  modules/
    admin/
    course_creation/
    documents/
      api/
      components/
      hooks/
      types.ts
      utils.ts
    editor/
    health/
    images/
    links/
    pending_review/
    reports/
    tagflow/
      api/
      components/
      hooks/
      types.ts
      utils.ts
    transfer/
  lib/
```

## Folder Responsibilities

`frontend/src/app/`

Owns Next.js routing, server components, route handlers, and route-level data
loading. Route files should compose module components rather than owning large
interactive workflows directly.

`frontend/src/modules/<feature>/components/`

Owns feature-specific React components. Large workflows should be split by
clear interaction boundary: panels, modals, editors, lists, cards, toolbars,
and overlays.

`frontend/src/modules/<feature>/api/`

Owns frontend fetch helpers for feature endpoints. Components should avoid
duplicating endpoint strings and response parsing once a workflow has more than
one call site.

`frontend/src/modules/<feature>/hooks/`

Owns feature-specific client state and side effects that are reused across
components or large enough to obscure component rendering logic.

`frontend/src/modules/<feature>/types.ts`

Owns shared frontend types for a feature. Types that cross multiple features
can move to `frontend/src/lib/types/` later if needed.

`frontend/src/components/ui/`

Legacy generic UI and compatibility components. Do not add new feature
workflows here. When touching reusable UI, prefer moving it toward
`frontend/src/components/edplus/` or the owning feature module.

`frontend/src/components/layout/`

Owns app chrome and shell layout such as sidebar and header composition.

`frontend/src/components/edplus/`

Owns the local ASU EdPlus design-system implementation: reusable primitives,
feedback components, navigation helpers, data components, usage notes, and
migration rules. The source reference package is `CC_Claude_DesignSystem/`, and
the live component showcase is `/edplus-components`.

## Current Refactor Status

- Pending Review is session-level UI under `frontend/src/modules/pending_review`
  and is mounted from the session shell/sidebar.
- The editor workspace, API client, hooks, extensions, toolbar, modals, and
  helper utilities live under `frontend/src/modules/editor`.
- Documents list/detail UI and shared document types live under
  `frontend/src/modules/documents`.
- The main TagFlow structure preview lives under
  `frontend/src/modules/tagflow`.
- Transfer and Reports have module-owned API clients and workflow components.
- The EdPlus design-system layer lives under `frontend/src/components/edplus`
  with tokens in `frontend/src/app/globals.css`, assets in
  `frontend/public/edplus`, and usage guidance in
  `frontend/src/components/edplus/README.md`.
- `DocumentDetailManager` and `TagFlowStructurePreview` remain intentionally
  large for now; deeper panel/tool splits are deferred until a focused feature
  change or a later refactor phase.

## Migration Rules

1. New feature UI should go into `frontend/src/modules/<feature>/`.
2. New large modals, panels, and editors should be separate components from the
   screen manager that opens them.
3. Move existing mega-component code only when touching that workflow for a
   focused feature slice.
4. Keep route URLs and component exports stable while moving implementation
   files.
5. Prefer a small adapter around existing props over a broad state-management
   rewrite.
6. Add concise file header comments to new and touched frontend feature files
   so future handoff work can identify ownership quickly.
7. Run `npm run build` after moving components, types, or API helper imports.

## TagFlow Extraction Direction

The current TagFlow editor should be decomposed toward:

```text
frontend/src/modules/tagflow/
  api/
    tagflowClient.ts
  components/
    TagFlowEditor.tsx
    PageNavigator.tsx
    PageCanvas.tsx
    ZoneOverlay.tsx
    ZoneToolsPanel.tsx
    FigureReviewPanel.tsx
    FlowchartBuilderModal.tsx
    FlowchartVisualAnnotator.tsx
    LayoutHintPanel.tsx
    AISuggestionsPanel.tsx
  hooks/
    useTagFlowKeyboardShortcuts.ts
    useZoneEditing.ts
    useFlowchartBuilder.ts
  types.ts
  utils.ts
```

The first extraction should be the flowchart work, because it is already a
distinct modal/tool surface and should not make the existing TagFlow editor file
larger.

## Reference TagFlow Components To Mine

From the reference app `frontend/src/components/tagflow/`:

- `FlowchartAnnotator.tsx`: highest value. Port the interaction model for a
  visual flowchart builder: image crop, draggable/resizable nodes, connections,
  start/end/independent roles, zoom, and guidance generation. Adapt it to our
  current session/document/page/zone IDs and saved `flowchart` structure.
- `ZoneOverlay.tsx`: useful resize handles, multi-select, lasso behavior, and
  future table grid editing patterns.
- `PageViewer.tsx`: useful zoom controls, Ctrl/Cmd-scroll zoom, lasso
  selection, keyboard navigation, and image measurement patterns.
- `PropertiesPanel.tsx`: useful compact tag legend, shortcut list,
  Shift+number reading-order placement, and tighter control grouping.
- `DragDivider.tsx`: small utility worth reusing if we clean up rail resizing.
- `TagFlowEditor.tsx`: do not port wholesale. It is tied to the reference app
  router/store/API shape. Extract patterns only.

## Suggested Extraction Order

1. Phase 5: introduce shared buttons, dialogs, tabs, badges, inputs, empty
   states, loading states, tables, and variant recipes.
2. Move app shell/navigation pieces toward `components/layout` as they are
   touched.
3. Move generic repeated UI states out of feature components into
   `components/edplus`; keep workflow-specific state and Canvas payload logic in
   `modules/<feature>`.
4. Later phase: split `TagFlowStructurePreview` and `DocumentDetailManager` by
   panel/tool concern once design-system primitives are available.

This keeps Phase 5 focused on reusable frontend infrastructure before returning
to high-churn Documents/TagFlow decomposition.
