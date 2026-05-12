export const CANVAS_ATTRS = [
  "id",
  "class",
  "style",
  "title",
  "role",
  "aria-label",
  "aria-hidden",
  "data-api-endpoint",
  "data-api-returntype",
  "data-ally-user-updated-alt",
  "data-canvas-file-id",
  "data-decorative",
  "data-course-type",
  "data-published",
  "data-mce-fragment",
];

export const STYLE_PRESERVED_TYPES = [
  "heading",
  "paragraph",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "horizontalRule",
  "tableCell",
  "tableHeader",
  "tableRow",
  "table",
  "image",
  "accordionBlock",
  "accordionSummary",
  "accordionContent",
  "styledSeparator",
  "canvasDiv",
];

export function attrsFromElement(element: HTMLElement, names = CANVAS_ATTRS) {
  return Object.fromEntries(names.map((name) => [name, element.getAttribute(name)]));
}

export function preservedAttributes(names = CANVAS_ATTRS) {
  return Object.fromEntries(
    names.map((name) => [
      name,
      {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute(name),
      },
    ]),
  );
}
