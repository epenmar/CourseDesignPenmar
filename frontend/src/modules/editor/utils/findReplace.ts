import type { Editor } from "@tiptap/react";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findReplacePattern(query: string, caseSensitive: boolean) {
  const normalized = query.trim();
  if (!normalized) return null;
  return new RegExp(escapeRegExp(normalized), caseSensitive ? "g" : "gi");
}

function textNodeWalker(doc: Document) {
  return doc.createTreeWalker(
    doc.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
}

export function replaceTextMatchesInHtml(htmlBody: string, query: string, replacement: string, caseSensitive: boolean) {
  if (typeof window === "undefined") return { html: htmlBody, count: 0 };
  const pattern = findReplacePattern(query, caseSensitive);
  if (!pattern) return { html: htmlBody, count: 0 };
  const doc = new DOMParser().parseFromString(htmlBody || "", "text/html");
  const walker = textNodeWalker(doc);
  let count = 0;
  let node = walker.nextNode();
  while (node) {
    const current = node.textContent ?? "";
    const matches = current.match(pattern)?.length ?? 0;
    if (matches > 0) {
      node.textContent = current.replace(pattern, replacement);
      count += matches;
    }
    node = walker.nextNode();
  }
  return { html: doc.body.innerHTML, count };
}

export function replaceNthTextMatchInHtml(htmlBody: string, query: string, replacement: string, caseSensitive: boolean, targetIndex: number) {
  if (typeof window === "undefined") return { html: htmlBody, replaced: false };
  const pattern = findReplacePattern(query, caseSensitive);
  if (!pattern || targetIndex < 0) return { html: htmlBody, replaced: false };
  const doc = new DOMParser().parseFromString(htmlBody || "", "text/html");
  const walker = textNodeWalker(doc);
  let currentIndex = 0;
  let node = walker.nextNode();
  while (node) {
    const current = node.textContent ?? "";
    const matches = Array.from(current.matchAll(pattern));
    for (const match of matches) {
      if (typeof match.index !== "number" || !match[0]) continue;
      if (currentIndex === targetIndex) {
        node.textContent = `${current.slice(0, match.index)}${replacement}${current.slice(match.index + match[0].length)}`;
        return { html: doc.body.innerHTML, replaced: true };
      }
      currentIndex += 1;
    }
    node = walker.nextNode();
  }
  return { html: htmlBody, replaced: false };
}

export function findStringMatches(value: string, query: string, caseSensitive: boolean) {
  const pattern = findReplacePattern(query, caseSensitive);
  if (!pattern) return [];
  const matches: Array<{ from: number; to: number }> = [];
  for (const match of value.matchAll(pattern)) {
    if (typeof match.index !== "number" || !match[0]) continue;
    matches.push({ from: match.index, to: match.index + match[0].length });
  }
  return matches;
}

export function ensureFindHighlightStyles() {
  if (typeof document === "undefined" || document.getElementById("canvas-curate-find-highlight-styles")) return;
  const style = document.createElement("style");
  style.id = "canvas-curate-find-highlight-styles";
  style.textContent = `
    ::highlight(canvas-curate-find-match) {
      background-color: #fde68a;
      color: #111827;
    }
    ::highlight(canvas-curate-find-active) {
      background-color: #fbbf24;
      color: #111827;
    }
  `;
  document.head.appendChild(style);
}

export function clearFindHighlights() {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
  const highlights = (CSS as typeof CSS & { highlights: HighlightRegistry }).highlights;
  highlights.delete("canvas-curate-find-match");
  highlights.delete("canvas-curate-find-active");
}

export function collectFindRanges(root: HTMLElement, query: string, caseSensitive: boolean) {
  const pattern = findReplacePattern(query, caseSensitive);
  if (!pattern) return [];
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  const ranges: Range[] = [];
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? "";
    for (const match of text.matchAll(pattern)) {
      if (typeof match.index !== "number" || !match[0]) continue;
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      ranges.push(range);
    }
    node = walker.nextNode();
  }
  return ranges;
}

export function countEditorDocumentMatches(editor: Editor | null, query: string, caseSensitive: boolean) {
  const pattern = findReplacePattern(query, caseSensitive);
  if (!editor || !pattern) return 0;
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.isText && node.text) {
      count += node.text.match(pattern)?.length ?? 0;
      return;
    }
    if (node.type.name === "htmlBlock" && typeof node.attrs.content === "string") {
      const doc = new DOMParser().parseFromString(node.attrs.content, "text/html");
      const text = doc.body.textContent ?? "";
      count += text.match(pattern)?.length ?? 0;
    }
  });
  return count;
}
