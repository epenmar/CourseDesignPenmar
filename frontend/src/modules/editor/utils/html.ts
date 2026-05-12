import type { Editor } from "@tiptap/react";

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

export function serializeHtmlBlocks(rawHtml: string) {
  if (typeof window === "undefined" || !rawHtml.includes("data-html-block")) return rawHtml;
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  doc.querySelectorAll("div[data-html-block]").forEach((wrapper) => {
    const storedContent = wrapper.getAttribute("data-content") || "";
    const replacement = doc.createElement("div");
    replacement.innerHTML = storedContent;
    while (replacement.firstChild) {
      wrapper.parentNode?.insertBefore(replacement.firstChild, wrapper);
    }
    wrapper.remove();
  });
  return doc.body.innerHTML;
}

export function editorPlainText(editor: Editor | null, limit = 5000) {
  if (!editor || typeof window === "undefined") return "";
  const doc = new DOMParser().parseFromString(serializeHtmlBlocks(editor.getHTML()), "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim().slice(0, limit);
}
