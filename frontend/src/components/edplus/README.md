# EdPlus Design System

This directory is the local Canvas Curator implementation of the ASU EdPlus
design system. The source reference package lives at
`CC_Claude_DesignSystem/`; production components live here and are showcased at
`/edplus-components`.

## Sources

- `CC_Claude_DesignSystem/colors_and_type.css`: token reference for brand
  color, typography, spacing, radius, and elevation.
- `CC_Claude_DesignSystem/assets/`: source logos and icons copied into
  `frontend/public/edplus/`.
- `CC_Claude_DesignSystem/COMPONENT_MIGRATION_GUIDE.md`: migration examples
  for replacing hand-authored UI with shared primitives.
- `CC_Claude_DesignSystem/DESIGN_SYSTEM_UPDATES.md`: visual/token rationale and
  EdPlus alignment notes.

## Tokens And Assets

- Tailwind theme tokens are currently defined in
  `frontend/src/app/globals.css`.
- Font loading is configured in `frontend/src/app/layout.tsx` with Inter Tight
  as the active fallback for Neue Haas Grotesk.
- Brand assets are served from `frontend/public/edplus/logos/` and
  `frontend/public/edplus/icons/`.
- Keep reusable class recipes inside individual components until at least two
  components need the same variant map. At that point, extract a small
  `variants.ts` helper.

## Components

Primitives:

- `Button`, `ButtonLink`: action buttons and button-styled internal links.
- `Input`: single-line fields with label, hint, error, icon, and full-width
  support.
- `Card`, `CardHeader`, `CardBody`, `CardFooter`: structured containers with
  optional semantic `as` rendering.
- `Modal`, `ModalBody`, `ModalFooter`: standard dialog frame.
- `Badge`, `StatusBadge`: compact labels and mapped workflow statuses.
- `Divider`: horizontal, vertical, and labeled rules.

Feedback:

- `Alert`: inline info, success, warning, and error messages.
- `ConfirmDialog`: destructive or confirmation dialog.
- `EmptyState`: no-data or no-results messages with optional actions.
- `Skeleton`: card and table loading placeholders.

Navigation and data:

- `Tabs`: accessible tab list with keyboard movement.
- `SearchInput`: debounced search with immediate local typing feedback.
- `FilterBar`: search, filter pills, sort controls, and active-filter clearing.
- `Pagination`: compact page navigation and optional jump-to-page input.
- `DataTable`: sortable/selectable table with row actions, empty/loading states,
  and optional resizable columns.
- `BulkActionBar`: selected-item actions with inline, sticky, or fixed
  placement.

## Usage Rules

- Prefer importing from `@/components/edplus` unless a direct component import is
  clearer for type exports.
- Use `Button` for commands and `ButtonLink` only when navigation is the primary
  action.
- Do not nest links inside buttons or buttons inside links.
- Use visible labels for unfamiliar icons. Icon-only controls need an
  `aria-label`, a stable hit target, and should be reserved for common actions
  such as close, previous, next, or delete in dense rows.
- Keep feature-specific data fetching, Canvas payload logic, session state, and
  workflow orchestration inside `frontend/src/modules/<feature>/`.
- Keep app chrome such as the side navigation and header in layout/chrome
  components, not in the design-system primitives.

## DataTable Versus Custom Layouts

Use `DataTable` when the user needs to scan rows, sort columns, select multiple
items, compare compact attributes, or perform repeated row actions.

Use a custom card/list/preview layout when rows need rich previews, side-by-side
before/after review, nested editing, document/page thumbnails, or feature
specific spatial context. In those cases, still use shared primitives inside the
custom layout.

Use `BulkActionBar` for multi-select workflows. Use `placement="fixed"` on long
inventory pages so selected actions remain reachable while scrolling.

## Accessibility Expectations

- Preserve semantic elements: use `Card as="section"` or native headings where
  the surrounding page structure needs it.
- Modals must have clear titles and should keep primary/destructive actions in
  `ModalFooter`.
- Search and filter controls must update visible results predictably and provide
  clear reset paths.
- Loading, empty, and error states should use `Skeleton`, `EmptyState`, `Alert`,
  or `ConfirmDialog` instead of one-off text blocks.
- Inputs need labels unless an adjacent visible label already names the field.

## Migration Notes

- Phase 5A installed the tokens, assets, app shell styling, and showcase route.
- Phase 5B completed the broad primitive pass across active workflows.
- Phase 5C should focus on feedback consistency: confirmations, retry/error
  copy, loading states, banners, and empty states.
- Phase 5D should focus on navigation/form patterns: tabs, search, filters,
  pagination, segmented controls, selects, and textareas.
- Phase 5E should continue data-component adoption where table behavior improves
  usability without replacing rich review layouts.
