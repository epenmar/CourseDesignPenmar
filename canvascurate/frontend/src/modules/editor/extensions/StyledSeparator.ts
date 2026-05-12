import { Node, mergeAttributes } from "@tiptap/react";

export const StyledSeparator = Node.create({
  name: "styledSeparator",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      variant: {
        default: "thin",
        parseHTML: (element: HTMLElement) => {
          const className = element.getAttribute("class") || "";
          const match = className.match(/separator-(\w+)/);
          return match?.[1] || "thin";
        },
        renderHTML: (attrs) => ({ class: `separator-${attrs.variant || "thin"}` }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: "hr.separator-thin", priority: 60 },
      { tag: "hr.separator-thick", priority: 60 },
      { tag: "hr.separator-dashed", priority: 60 },
      { tag: "hr.separator-dotted", priority: 60 },
      { tag: "hr.separator-double", priority: 60 },
      { tag: "hr.separator-gradient", priority: 60 },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["hr", mergeAttributes(HTMLAttributes)];
  },

  addCommands() {
    return {
      insertStyledSeparator: (variant = "thin") => ({ commands }) =>
        commands.insertContent({ type: "styledSeparator", attrs: { variant } }),
    };
  },
});
