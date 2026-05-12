import { Node, mergeAttributes } from "@tiptap/react";

export const AccordionSummary = Node.create({
  name: "accordionSummary",
  content: "inline*",
  defining: true,
  selectable: false,

  addAttributes() {
    return {
      style: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("style"),
        renderHTML: (attrs) => (attrs.style ? { style: attrs.style } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "summary" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["summary", mergeAttributes(HTMLAttributes), 0];
  },
});

export const AccordionContent = Node.create({
  name: "accordionContent",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      style: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("style"),
        renderHTML: (attrs) => (attrs.style ? { style: attrs.style } : {}),
      },
    };
  },

  parseHTML() {
    return [
      { tag: "div.accordion-content" },
      { tag: "details > div" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "accordion-content" }), 0];
  },
});

export const AccordionBlock = Node.create({
  name: "accordionBlock",
  group: "block",
  content: "accordionSummary accordionContent",
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: () => true,
        renderHTML: () => ({ open: "" }),
      },
      style: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("style"),
        renderHTML: (attrs) => (attrs.style ? { style: attrs.style } : {}),
      },
    };
  },

  parseHTML() {
    return [{
      tag: "details",
      getAttrs: (element) => {
        const details = element as HTMLElement;
        const summary = details.querySelector(":scope > summary");
        const existingWrapper = details.querySelector(":scope > div.accordion-content");
        if (!summary || existingWrapper) return {};

        const wrapper = document.createElement("div");
        wrapper.className = "accordion-content";
        const children = Array.from(details.childNodes);
        let pastSummary = false;
        for (const child of children) {
          if (child === summary) {
            pastSummary = true;
            continue;
          }
          if (pastSummary) wrapper.appendChild(child);
        }
        if (!wrapper.childNodes.length) {
          const paragraph = document.createElement("p");
          paragraph.textContent = " ";
          wrapper.appendChild(paragraph);
        }
        details.appendChild(wrapper);
        return {};
      },
    }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["details", mergeAttributes(HTMLAttributes, { class: "accordion-block", open: "" }), 0];
  },

  addCommands() {
    return {
      insertAccordion: () => ({ commands }) =>
        commands.insertContent({
          type: "accordionBlock",
          attrs: { open: true },
          content: [
            { type: "accordionSummary", content: [{ type: "text", text: "Click to expand" }] },
            {
              type: "accordionContent",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Expandable content goes here..." }] }],
            },
          ],
        }),
    };
  },

  addNodeView() {
    return () => {
      const details = document.createElement("details");
      details.className = "accordion-block";
      details.setAttribute("open", "");
      details.addEventListener("toggle", () => {
        if (!details.hasAttribute("open")) details.setAttribute("open", "");
      });
      return { dom: details, contentDOM: details };
    };
  },
});
