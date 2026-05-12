import { Extension } from "@tiptap/react";

import { STYLE_PRESERVED_TYPES } from "./extensionAttributes";

export const PreserveStyles = Extension.create({
  name: "preserveStyles",

  addGlobalAttributes() {
    return [
      {
        types: STYLE_PRESERVED_TYPES,
        attributes: {
          id: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("id"),
            renderHTML: (attributes) => (attributes.id ? { id: attributes.id } : {}),
          },
          class: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("class"),
            renderHTML: (attributes) => (attributes.class ? { class: attributes.class } : {}),
          },
          style: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("style"),
            renderHTML: (attributes) => (attributes.style ? { style: attributes.style } : {}),
          },
        },
      },
    ];
  },
});
