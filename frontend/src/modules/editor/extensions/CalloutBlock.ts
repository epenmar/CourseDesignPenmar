import { Node, mergeAttributes } from "@tiptap/react";

const CALLOUT_STYLES: Record<string, { background: string; border: string }> = {
  info: { background: "#eff6ff", border: "#3b82f6" },
  warning: { background: "#fffbeb", border: "#f59e0b" },
  tip: { background: "#ecfdf5", border: "#10b981" },
  note: { background: "#f5f3ff", border: "#8b5cf6" },
};

function calloutStyle(type: string) {
  const style = CALLOUT_STYLES[type] ?? CALLOUT_STYLES.info;
  return [
    "border-radius: 8px",
    "padding: 12px 16px",
    "margin: 16px 0",
    `border-left: 4px solid ${style.border}`,
    `background: ${style.background}`,
  ].join("; ");
}

export const CalloutBlock = Node.create({
  name: "calloutBlock",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      type: {
        default: "info",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-callout-type") || "info",
        renderHTML: (attrs) => ({ "data-callout-type": attrs.type }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div.callout-box" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const type = node.attrs.type || "info";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: "callout-box",
        "data-callout-type": type,
        style: calloutStyle(type),
      }),
      0,
    ];
  },

  addCommands() {
    return {
      insertCallout: (type = "info") => ({ commands }) => commands.insertContent({
        type: "calloutBlock",
        attrs: { type },
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Type your note here..." }],
          },
        ],
      }),
      setCalloutType: (type: string) => ({ commands }) => commands.updateAttributes("calloutBlock", { type }),
    };
  },
});
