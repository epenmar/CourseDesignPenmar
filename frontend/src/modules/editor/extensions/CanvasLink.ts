import Link from "@tiptap/extension-link";

import { preservedAttributes } from "./extensionAttributes";

export const CanvasLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...preservedAttributes([
        "id",
        "class",
        "style",
        "title",
        "target",
        "rel",
        "download",
        "role",
        "aria-label",
        "aria-hidden",
        "data-api-endpoint",
        "data-api-returntype",
      ]),
    };
  },
});
