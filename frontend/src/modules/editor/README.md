# Editor Module

Owns the Canvas content editing workspace and editor-specific API, hooks,
extensions, modal surfaces, and utilities.

## Boundaries

- `components/ContentEditorWorkspace.tsx` owns the editor shell: Tiptap setup,
  high-level layout, block insertion helpers, mode switching, and wiring between
  hooks/components.
- `api/editorClient.ts` owns editor-specific HTTP paths, response types, and
  request helpers. Feature hooks should call this client instead of building
  `/canvas/...` URLs directly.
- `hooks/` owns stateful editor workflows:
  - `useEditorContentSave.ts`: local save, revision history, restore,
    dirty-state events, and Canvas push orchestration.
  - `useEditorUploads.ts`: image/file upload, selected-text file linking, image
    review state, and reviewed image insertion.
  - `useEditorIdentifyIssue.ts`: issue flagging, Canvas revision recovery,
    source-course lookup, and source-page replacement.
  - `useEditorAI.ts`: selection rewrite, accessibility link-text improvement,
    and AI content generation.
  - `useEditorFindReplace.ts`: find/replace query state, match navigation,
    rich-editor highlights, and HTML textarea selection/scrolling.
- `components/` owns presentation surfaces such as toolbar, slash command menu,
  modal dialogs, revision history, find/replace controls, accessibility checks,
  and image review.
- `extensions/` owns editor-specific Tiptap behavior. Extension parser,
  rendering, and command type augmentation should stay with the extension file.
- `utils/` owns pure editor helpers such as HTML escaping, preview iframe
  rendering, content block markup, accessibility transforms, find/replace
  matching, and toolbar style helpers.

## Placement Rules

- Keep route-specific imports pointed at `@/modules/editor/...`.
- Keep network calls in `api/editorClient.ts`.
- Keep browser state, React state, and authenticated workflow orchestration in
  hooks, not utilities.
- Keep reusable modal/toolbar UI in components; pass callbacks in from hooks or
  the workspace.
- Keep the workspace focused on composition and editor setup. New workflow logic
  should generally start in a hook.

## Deferred

HTML-mode find navigation is tactically improved by scrolling the textarea to
the active match. Deeper selected-match context should be revisited with future
diff/compare work rather than expanded inside the workspace shell.
