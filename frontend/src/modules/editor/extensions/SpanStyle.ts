import { Mark, mergeAttributes } from "@tiptap/react";

import { attrsFromElement, preservedAttributes } from "./extensionAttributes";

export const SpanStyle = Mark.create({
  name: "spanStyle",
  priority: 90,

  addAttributes() {
    return preservedAttributes();
  },

  parseHTML() {
    return [
      {
        tag: "span",
        getAttrs: (element) => attrsFromElement(element as HTMLElement),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});

export const SubscriptMark = Mark.create({
  name: "subscript",

  parseHTML() {
    return [{ tag: "sub" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sub", mergeAttributes(HTMLAttributes), 0];
  },
});

export const SuperscriptMark = Mark.create({
  name: "superscript",

  parseHTML() {
    return [{ tag: "sup" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes), 0];
  },
});
