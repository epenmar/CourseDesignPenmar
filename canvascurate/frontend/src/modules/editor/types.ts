/**
 * Shared editor feature types.
 *
 * Keep route payload shapes here when multiple editor hooks/components need the
 * same content item contract.
 */

import type { ManagedImageInsertMode } from "@/modules/editor/utils/contentBlocks";

export type ContentEditorItem = {
  id: string;
  title: string | null;
  content_type: string;
  canvas_url: string | null;
  published: boolean | null;
  module_name: string | null;
};

export type EditorImageReviewState = {
  imageId: string;
  src: string;
  title: string;
  canvasFileId: string | null;
  insertMode: ManagedImageInsertMode;
};
