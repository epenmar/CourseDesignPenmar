import { mergeAttributes } from "@tiptap/react";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";

import { preservedAttributes } from "./extensionAttributes";

export const CanvasTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...preservedAttributes(),
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "table",
      mergeAttributes(
        { style: "border-collapse: collapse; width: 100%;" },
        HTMLAttributes,
      ),
      0,
    ];
  },
});

export const CanvasTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...preservedAttributes(),
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "td",
      mergeAttributes(
        { style: "border: 1px solid #d6d6d6; padding: 0.5rem;" },
        HTMLAttributes,
      ),
      0,
    ];
  },
});

export const CanvasTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...preservedAttributes(),
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "th",
      mergeAttributes(
        { style: "border: 1px solid #d6d6d6; padding: 0.5rem; text-align: left;" },
        HTMLAttributes,
      ),
      0,
    ];
  },
});
