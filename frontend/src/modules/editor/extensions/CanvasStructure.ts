import { Node, mergeAttributes } from "@tiptap/react";

import { attrsFromElement, preservedAttributes } from "./extensionAttributes";

export const CanvasDiv = Node.create({
  name: "canvasDiv",
  group: "block",
  content: "block*",
  defining: true,

  addAttributes() {
    return preservedAttributes();
  },

  parseHTML() {
    return [{ tag: "div", getAttrs: (element) => attrsFromElement(element as HTMLElement) }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes), 0];
  },
});

export const CanvasAnchor = Node.create({
  name: "canvasAnchor",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return preservedAttributes();
  },

  parseHTML() {
    return [
      {
        tag: "a[id]:not([href])",
        getAttrs: (element) => attrsFromElement(element as HTMLElement),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["a", mergeAttributes(HTMLAttributes)];
  },
});
