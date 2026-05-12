"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorContent, Extension, Mark, Node, mergeAttributes, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlertTriangle,
  Bold,
  ChevronDown,
  ChevronUp,
  Code2,
  Eraser,
  FileUp,
  FileText,
  Flag,
  GraduationCap,
  ImageIcon,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Info,
  Italic,
  LinkIcon,
  Lightbulb,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Minus,
  Palette,
  PanelTopOpen,
  Quote,
  Redo2,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  StickyNote,
  Strikethrough,
  Subscript,
  Superscript,
  Table2,
  Terminal,
  Text,
  Underline as UnderlineIcon,
  Undo2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { QuizQuestionsPanel } from "@/components/ui/QuizQuestionsPanel";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    calloutBlock: {
      insertCallout: (type?: string) => ReturnType;
      setCalloutType: (type: string) => ReturnType;
    };
    accordionBlock: {
      insertAccordion: () => ReturnType;
    };
    htmlBlock: {
      insertHtmlBlock: (html: string) => ReturnType;
      updateHtmlBlock: (content: string) => ReturnType;
    };
    styledSeparator: {
      insertStyledSeparator: (variant?: string) => ReturnType;
    };
    resizableImage: {
      setImageSize: (attrs: Record<string, unknown>) => ReturnType;
    };
  }
}

const TEXT_COLORS = [
  "#000000", "#8c1d40", "#ffc627", "#dc2626", "#2563eb", "#16a34a", "#ea580c", "#7c3aed",
  "#374151", "#b83260", "#ffd966", "#ef4444", "#3b82f6", "#22c55e", "#f97316", "#8b5cf6",
  "#6b7280", "#d97098", "#fff3b0", "#fca5a5", "#93c5fd", "#86efac", "#fdba74", "#c4b5fd",
  "#9ca3af", "#d1d5db", "#e5e7eb", "#f3f4f6", "#f9fafb", "#ffffff", "#fef3c7", "#ecfdf5",
];

const HIGHLIGHT_COLORS = [
  "#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", "#e9d5ff", "#fed7aa", "#f3f4f6", "#ffc627",
];

const PILL_COLORS: Array<{ label: string; value: string }> = [
  { label: "Maroon", value: "#8c1d40" },
  { label: "Gold", value: "#775a00" },
  { label: "Blue", value: "#2563eb" },
  { label: "Green", value: "#16a34a" },
  { label: "Orange", value: "#ea580c" },
  { label: "Purple", value: "#7c3aed" },
  { label: "Slate", value: "#374151" },
  { label: "Red", value: "#dc2626" },
];

const LATEX_OPERATION_GROUPS = [
  {
    label: "Basic",
    items: [
      { label: "Fraction", symbol: "a/b", value: "\\frac{}{}" },
      { label: "Square root", symbol: "√", value: "\\sqrt{}" },
      { label: "Power", symbol: "xⁿ", value: "^{}" },
      { label: "Subscript", symbol: "xₙ", value: "_{}" },
      { label: "Plus/minus", symbol: "±", value: "\\pm" },
      { label: "Times", symbol: "×", value: "\\times" },
      { label: "Divide", symbol: "÷", value: "\\div" },
      { label: "Dot", symbol: "⋅", value: "\\cdot" },
    ],
  },
  {
    label: "Calculus",
    items: [
      { label: "Integral", symbol: "∫", value: "\\int" },
      { label: "Double integral", symbol: "∬", value: "\\iint" },
      { label: "Sum", symbol: "∑", value: "\\sum" },
      { label: "Product", symbol: "∏", value: "\\prod" },
      { label: "Limit", symbol: "lim", value: "\\lim_{x \\to 0}" },
      { label: "Derivative", symbol: "d/dx", value: "\\frac{d}{dx}" },
      { label: "Partial", symbol: "∂", value: "\\partial" },
      { label: "Gradient", symbol: "∇", value: "\\nabla" },
    ],
  },
  {
    label: "Relations",
    items: [
      { label: "Less/equal", symbol: "≤", value: "\\le" },
      { label: "Greater/equal", symbol: "≥", value: "\\ge" },
      { label: "Not equal", symbol: "≠", value: "\\ne" },
      { label: "Approx", symbol: "≈", value: "\\approx" },
      { label: "Equivalent", symbol: "≡", value: "\\equiv" },
      { label: "Proportional", symbol: "∝", value: "\\propto" },
      { label: "Infinity", symbol: "∞", value: "\\infty" },
      { label: "Angle", symbol: "∠", value: "\\angle" },
    ],
  },
  {
    label: "Sets & Logic",
    items: [
      { label: "Element", symbol: "∈", value: "\\in" },
      { label: "Not element", symbol: "∉", value: "\\notin" },
      { label: "Subset", symbol: "⊆", value: "\\subseteq" },
      { label: "Union", symbol: "∪", value: "\\cup" },
      { label: "Intersect", symbol: "∩", value: "\\cap" },
      { label: "For all", symbol: "∀", value: "\\forall" },
      { label: "Exists", symbol: "∃", value: "\\exists" },
      { label: "Empty set", symbol: "∅", value: "\\emptyset" },
    ],
  },
  {
    label: "Greek",
    items: [
      { label: "alpha", symbol: "α", value: "\\alpha" },
      { label: "beta", symbol: "β", value: "\\beta" },
      { label: "gamma", symbol: "γ", value: "\\gamma" },
      { label: "delta", symbol: "δ", value: "\\delta" },
      { label: "theta", symbol: "θ", value: "\\theta" },
      { label: "lambda", symbol: "λ", value: "\\lambda" },
      { label: "pi", symbol: "π", value: "\\pi" },
      { label: "sigma", symbol: "σ", value: "\\sigma" },
      { label: "omega", symbol: "ω", value: "\\omega" },
      { label: "Delta", symbol: "Δ", value: "\\Delta" },
      { label: "Sigma", symbol: "Σ", value: "\\Sigma" },
      { label: "Omega", symbol: "Ω", value: "\\Omega" },
    ],
  },
];

const AI_REWRITE_ACTIONS = [
  { id: "rewrite", label: "Rewrite", instruction: "Rewrite this text in a different way while preserving the meaning:" },
  { id: "simplify", label: "Simplify", instruction: "Simplify this text for easier reading:" },
  { id: "expand", label: "Expand", instruction: "Expand this text with more detail:" },
  { id: "formal", label: "Formal", instruction: "Rewrite this text in a more formal, professional tone:" },
  { id: "concise", label: "Concise", instruction: "Make this text more concise without losing meaning:" },
  { id: "fix", label: "Fix Grammar", instruction: "Fix any grammar, spelling, or punctuation errors in this text:" },
];

const AI_GENERATE_PRESETS = [
  { label: "Learning Objectives", prompt: "Write 3-5 measurable learning objectives for this module using action verbs from Bloom's taxonomy. Format as a bulleted list." },
  { label: "Discussion Prompt", prompt: "Create an engaging discussion prompt that encourages critical thinking and peer interaction. Include a brief context paragraph and 2-3 guiding questions." },
  { label: "Module Overview", prompt: "Write a brief module overview paragraph that tells students what they will learn, why it matters, and what they will do." },
  { label: "Assignment Instructions", prompt: "Write clear assignment instructions with purpose, requirements, deliverables, and grading criteria." },
  { label: "Welcome Message", prompt: "Write a warm, professional welcome message for the start of this course module." },
];

const AI_SMART_PROMPTS = [
  { label: "Summarize this page", prompt: "Based on the current page content, write a concise summary paragraph of 2-3 sentences that captures the key points." },
  { label: "Add review questions", prompt: "Based on the current page content, create 3-5 review or comprehension questions that test understanding of the key concepts. Format as a numbered list." },
  { label: "Suggest next steps", prompt: "Based on the current page content, write a What's Next section with 2-3 bullet points guiding students to the next learning activities." },
  { label: "Make it more engaging", prompt: "Based on the current page content, suggest ways to make this more engaging, such as a discussion prompt, reflection activity, or real-world application example. Write the suggested additions as HTML." },
];

const CANVAS_ATTRS = [
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

const STYLE_PRESERVED_TYPES = [
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

function attrsFromElement(element: HTMLElement, names = CANVAS_ATTRS) {
  return Object.fromEntries(names.map((name) => [name, element.getAttribute(name)]));
}

function preservedAttributes(names = CANVAS_ATTRS) {
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

function serializeHtmlBlocks(rawHtml: string) {
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

function replaceTextMatchesInHtml(htmlBody: string, query: string, replacement: string, caseSensitive: boolean) {
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

function replaceNthTextMatchInHtml(htmlBody: string, query: string, replacement: string, caseSensitive: boolean, targetIndex: number) {
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

function findStringMatches(value: string, query: string, caseSensitive: boolean) {
  const pattern = findReplacePattern(query, caseSensitive);
  if (!pattern) return [];
  const matches: Array<{ from: number; to: number }> = [];
  for (const match of value.matchAll(pattern)) {
    if (typeof match.index !== "number" || !match[0]) continue;
    matches.push({ from: match.index, to: match.index + match[0].length });
  }
  return matches;
}

function ensureFindHighlightStyles() {
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

function clearFindHighlights() {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
  const highlights = (CSS as typeof CSS & { highlights: HighlightRegistry }).highlights;
  highlights.delete("canvas-curate-find-match");
  highlights.delete("canvas-curate-find-active");
}

function collectFindRanges(root: HTMLElement, query: string, caseSensitive: boolean) {
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

function countEditorDocumentMatches(editor: Editor | null, query: string, caseSensitive: boolean) {
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

function editorPlainText(editor: Editor | null, limit = 5000) {
  if (!editor || typeof window === "undefined") return "";
  const doc = new DOMParser().parseFromString(serializeHtmlBlocks(editor.getHTML()), "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function parseCssColor(raw: string): [number, number, number] | null {
  const value = raw.trim().toLowerCase();
  const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex.split("").map((char) => `${char}${char}`).join("");
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  const rgbMatch = value.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  if (rgbMatch) {
    return [
      Number.parseInt(rgbMatch[1], 10),
      Number.parseInt(rgbMatch[2], 10),
      Number.parseInt(rgbMatch[3], 10),
    ];
  }
  const named: Record<string, [number, number, number]> = {
    black: [0, 0, 0],
    white: [255, 255, 255],
    gray: [128, 128, 128],
    grey: [128, 128, 128],
    red: [255, 0, 0],
    orange: [255, 165, 0],
    yellow: [255, 255, 0],
    green: [0, 128, 0],
    blue: [0, 0, 255],
    purple: [128, 0, 128],
  };
  return named[value] ?? null;
}

function relativeLuminance([r, g, b]: [number, number, number]) {
  const [rs, gs, bs] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function colorContrastRatio(foreground: [number, number, number], background: [number, number, number]) {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function styleProperty(style: string, property: string) {
  const match = style.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i"));
  return match?.[1]?.trim() ?? "";
}

function normalizedUrlText(value: string) {
  return value.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

function linkTextLooksLikeUrl(text: string, href: string) {
  const normalizedText = normalizedUrlText(text);
  const normalizedHref = normalizedUrlText(href);
  return (
    /^https?:\/\//i.test(text.trim())
    || /^www\./i.test(text.trim())
    || (normalizedHref && normalizedText === normalizedHref)
  );
}

function textLooksLikeFileName(text: string) {
  return /^[^/\\]+\.(pdf|docx?|pptx?|xlsx?|csv)$/i.test(text.trim());
}

function linkLooksLikeCanvasFile(anchor: HTMLAnchorElement, href: string) {
  return (
    anchor.getAttribute("data-api-returntype")?.toLowerCase() === "file"
    || /\/files\/\d+(?:\/|$|\?)/i.test(href)
  );
}

function runAccessibilityChecks(htmlBody: string): AccessibilityIssue[] {
  if (typeof window === "undefined") return [];
  const doc = new DOMParser().parseFromString(htmlBody || "", "text/html");
  const issues: AccessibilityIssue[] = [];

  doc.body.querySelectorAll("img").forEach((img, index) => {
    const alt = img.getAttribute("alt");
    const decorative = img.getAttribute("role") === "presentation" || img.getAttribute("aria-hidden") === "true" || img.getAttribute("data-decorative") === "true";
    if (decorative) return;
    if (alt === null) {
      issues.push({
        id: `img-alt-${index}`,
        severity: "error",
        rule: "Image alt text",
        code: "img-alt",
        message: "Image missing alt text",
        fix: "Add alt text or mark the image decorative.",
        context: img.getAttribute("src") || undefined,
        index,
      });
      return;
    }
    if (!alt.trim()) {
      issues.push({
        id: `img-empty-alt-${index}`,
        severity: "warning",
        rule: "Image alt text",
        code: "img-alt",
        message: "Image has empty alt text",
        fix: "Confirm it is decorative or add alt text.",
        context: img.getAttribute("src") || undefined,
        index,
      });
      return;
    }
    if (/\.(jpe?g|png|gif|webp|svg|bmp)$/i.test(alt.trim())) {
      issues.push({
        id: `img-filename-alt-${index}`,
        severity: "error",
        rule: "Image alt text",
        code: "filename-alt",
        message: `Alt text looks like a filename: "${alt.trim()}"`,
        fix: "Replace filename-style alt text with a meaningful description.",
        context: img.getAttribute("src") || undefined,
        index,
      });
    }
  });

  let previousHeadingLevel = 0;
  doc.body.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading, index) => {
    const level = Number.parseInt(heading.tagName.slice(1), 10);
    const text = (heading.textContent || "").trim();
    if (!text) {
      issues.push({
        id: `empty-heading-${index}`,
        severity: "error",
        rule: "Heading structure",
        code: "empty-heading",
        message: `${heading.tagName} is empty`,
        fix: "Remove the empty heading or add heading text.",
        index,
      });
    }
    if (previousHeadingLevel && level > previousHeadingLevel + 1) {
      issues.push({
        id: `heading-skip-${index}`,
        severity: "warning",
        rule: "Heading structure",
        code: "heading-skip",
        message: `Heading skips from H${previousHeadingLevel} to H${level}`,
        fix: `Change this heading to H${previousHeadingLevel + 1} or add an intermediate heading.`,
        context: text || undefined,
        index,
        previousLevel: previousHeadingLevel,
        currentLevel: level,
      });
    }
    previousHeadingLevel = level;
  });

  const vagueLinkText = new Set(["click here", "here", "link", "read more", "more", "learn more", "this", "view"]);
  doc.body.querySelectorAll("a").forEach((anchor, index) => {
    const text = (anchor.textContent || "").replace(/\s+/g, " ").trim();
    const href = anchor.getAttribute("href") || "";
    const normalized = text.toLowerCase();
    if (!text) {
      issues.push({
        id: `empty-link-${index}`,
        severity: "error",
        rule: "Link text",
        code: "empty-link",
        message: "Link has no readable text",
        fix: "Add descriptive link text.",
        context: href || undefined,
        index,
        text,
        href,
      });
      return;
    }
    if (vagueLinkText.has(normalized) || linkTextLooksLikeUrl(text, href)) {
      issues.push({
        id: `vague-link-${index}`,
        severity: "warning",
        rule: "Link text",
        code: "vague-link",
        message: `Non-descriptive link text: "${text}"`,
        fix: "Use link text that describes the destination.",
        context: href || undefined,
        index,
        text,
        href,
      });
      return;
    }
    if (linkLooksLikeCanvasFile(anchor, href) && textLooksLikeFileName(text)) {
      issues.push({
        id: `file-link-${index}`,
        severity: "warning",
        rule: "File links",
        code: "file-link",
        message: `File link uses filename as link text: "${text}"`,
        fix: "Use descriptive link text that explains what students will open.",
        context: href || undefined,
        index,
        text,
        href,
      });
    }
  });

  doc.body.querySelectorAll("table").forEach((table, index) => {
    if (!table.querySelector("th")) {
      issues.push({
        id: `table-header-${index}`,
        severity: "warning",
        rule: "Tables",
        code: "table-header",
        message: "Table has no header cells",
        fix: "Use header cells for row or column labels.",
        index,
      });
    }
  });

  doc.body.querySelectorAll<HTMLElement>("[style]").forEach((element, index) => {
    const style = element.getAttribute("style") || "";
    const color = styleProperty(style, "color");
    if (!color) return;
    const foreground = parseCssColor(color);
    if (!foreground) return;
    const backgroundValue = styleProperty(style, "background-color") || styleProperty(style, "background") || "white";
    const background = parseCssColor(backgroundValue) ?? [255, 255, 255];
    const ratio = colorContrastRatio(foreground, background);
    if (ratio < 4.5) {
      issues.push({
        id: `contrast-${index}`,
        severity: ratio < 3 ? "error" : "warning",
        rule: "Color contrast",
        code: "color-contrast",
        message: `Low contrast text (${ratio.toFixed(1)}:1)`,
        fix: "Use text and background colors with at least 4.5:1 contrast.",
        context: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) || color,
        index,
      });
    }
  });

  return issues;
}

function fixAccessibilityIssueInHtml(htmlBody: string, issue: AccessibilityIssue, replacementText?: string) {
  if (typeof window === "undefined") return { html: htmlBody, fixed: false };
  const doc = new DOMParser().parseFromString(htmlBody || "", "text/html");

  if (issue.code === "empty-heading") {
    const heading = doc.body.querySelectorAll("h1, h2, h3, h4, h5, h6")[issue.index ?? -1];
    if (!heading) return { html: htmlBody, fixed: false };
    heading.remove();
    return { html: doc.body.innerHTML, fixed: true };
  }

  if (issue.code === "heading-skip") {
    const heading = doc.body.querySelectorAll("h1, h2, h3, h4, h5, h6")[issue.index ?? -1];
    const nextLevel = Math.max(1, Math.min(6, (issue.previousLevel ?? 1) + 1));
    if (!heading) return { html: htmlBody, fixed: false };
    const replacement = doc.createElement(`h${nextLevel}`);
    Array.from(heading.attributes).forEach((attr) => replacement.setAttribute(attr.name, attr.value));
    replacement.innerHTML = heading.innerHTML;
    heading.replaceWith(replacement);
    return { html: doc.body.innerHTML, fixed: true };
  }

  if (issue.code === "table-header") {
    const table = doc.body.querySelectorAll("table")[issue.index ?? -1];
    const firstRow = table?.querySelector("tr");
    if (!firstRow) return { html: htmlBody, fixed: false };
    firstRow.querySelectorAll("td").forEach((cell) => {
      const header = doc.createElement("th");
      Array.from(cell.attributes).forEach((attr) => header.setAttribute(attr.name, attr.value));
      header.innerHTML = cell.innerHTML;
      cell.replaceWith(header);
    });
    return { html: doc.body.innerHTML, fixed: true };
  }

  if (issue.code === "color-contrast") {
    const styledElements = Array.from(doc.body.querySelectorAll<HTMLElement>("[style]"));
    const element = styledElements[issue.index ?? -1];
    if (!element) return { html: htmlBody, fixed: false };
    const style = element.getAttribute("style") || "";
    const cleaned = style.replace(/(?:^|;)\s*color\s*:[^;]+;?/gi, ";").replace(/;{2,}/g, ";").replace(/^;|;$/g, "").trim();
    if (cleaned) element.setAttribute("style", cleaned);
    else element.removeAttribute("style");
    return { html: doc.body.innerHTML, fixed: true };
  }

  if ((issue.code === "empty-link" || issue.code === "vague-link" || issue.code === "file-link") && replacementText?.trim()) {
    const anchor = doc.body.querySelectorAll("a")[issue.index ?? -1];
    if (!anchor) return { html: htmlBody, fixed: false };
    anchor.textContent = replacementText.trim();
    return { html: doc.body.innerHTML, fixed: true };
  }

  return { html: htmlBody, fixed: false };
}

const PreserveStyles = Extension.create({
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

const CanvasDiv = Node.create({
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

const CanvasAnchor = Node.create({
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

const CalloutBlock = Node.create({
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

const AccordionSummary = Node.create({
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

const AccordionContent = Node.create({
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

const AccordionBlock = Node.create({
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

const StyledSeparator = Node.create({
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

const HtmlBlock = Node.create({
  name: "htmlBlock",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      content: {
        default: "",
        parseHTML: (element: HTMLElement) => (
          element.hasAttribute("data-html-block")
            ? element.getAttribute("data-content") || element.innerHTML
            : element.outerHTML
        ),
      },
    };
  },

  parseHTML() {
    return [
      { tag: "div[data-html-block]", priority: 90 },
      { tag: "div.enhanceable_content", priority: 85 },
      {
        tag: "div[style]",
        priority: 70,
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const style = el.getAttribute("style") || "";
          if ((style.includes("display:flex") || style.includes("display: flex")) && el.children.length >= 2) return {};
          if (style.includes("linear-gradient")) return {};
          if ((style.includes("background") || style.includes("border-left")) && style.includes("padding")) return {};
          if ((style.includes("text-align:center") || style.includes("text-align: center")) && el.querySelector("a[style]")) return {};
          return false;
        },
      },
      { tag: "figure[style]", priority: 70 },
      {
        tag: "iframe",
        priority: 75,
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const parent = el.parentElement;
          if (parent?.tagName === "DIV" && parent.querySelector("iframe")) return false;
          return { content: el.outerHTML };
        },
      },
      {
        tag: "div",
        priority: 65,
        getAttrs: (element) => ((element as HTMLElement).querySelector("iframe") ? {} : false),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-html-block": "",
        "data-content": node.attrs.content || "",
      }),
    ];
  },

  addCommands() {
    return {
      insertHtmlBlock: (html: string) => ({ commands }) =>
        commands.insertContent({ type: "htmlBlock", attrs: { content: html } }),
      updateHtmlBlock: (content: string) => ({ commands }) => commands.updateAttributes("htmlBlock", { content }),
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let currentNode = node;
      const wrapper = document.createElement("div");
      wrapper.className = "html-block-wrapper";
      wrapper.setAttribute("data-html-block", "");

      const content = document.createElement("div");
      content.className = "html-block-content";
      content.innerHTML = node.attrs.content || "";
      wrapper.appendChild(content);

      function cleanContentHtml() {
        const clone = content.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("[data-html-block-editable]").forEach((editable) => {
          editable.removeAttribute("contenteditable");
          editable.removeAttribute("spellcheck");
        });
        return clone.innerHTML;
      }

      function updateHtmlBlockContent() {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos === null || pos === undefined) return;
        const nextContent = cleanContentHtml();
        if (nextContent === currentNode.attrs.content) return;
        currentNode = currentNode.type.create({ ...currentNode.attrs, content: nextContent }, currentNode.content, currentNode.marks);
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { content: nextContent }));
      }

      function duplicateHtmlBlock() {
        updateHtmlBlockContent();
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos === null || pos === undefined) return;
        const duplicate = currentNode.type.create(currentNode.attrs, currentNode.content, currentNode.marks);
        editor.view.dispatch(editor.view.state.tr.insert(pos + currentNode.nodeSize, duplicate));
      }

      function deleteHtmlBlock() {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos === null || pos === undefined) return;
        editor.view.dispatch(editor.view.state.tr.delete(pos, pos + currentNode.nodeSize));
      }

      function setHtmlBlockContent(nextContent: string) {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos === null || pos === undefined) return;
        currentNode = currentNode.type.create({ ...currentNode.attrs, content: nextContent }, currentNode.content, currentNode.marks);
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { content: nextContent }));
      }

      function showHtmlBlockEditor() {
        updateHtmlBlockContent();
        window.dispatchEvent(new CustomEvent<HtmlBlockEditRequest>("canvascurate:edit-html-block", {
          detail: {
            content: String(currentNode.attrs.content || ""),
            update: setHtmlBlockContent,
          },
        }));
      }

      function latexBlockElement() {
        return content.querySelector<HTMLElement>("[data-latex-block]");
      }

      function showLatexBlockEditor() {
        const latexBlock = latexBlockElement();
        if (!latexBlock) return;
        updateHtmlBlockContent();
        window.dispatchEvent(new CustomEvent<LatexBlockEditRequest>("canvascurate:edit-latex-block", {
          detail: {
            latex: latexBlock.getAttribute("data-latex-source") || "",
            displayMode: latexBlock.getAttribute("data-latex-display-mode") !== "inline",
            update: setHtmlBlockContent,
          },
        }));
      }

      function showSourceEditor() {
        if (latexBlockElement()) {
          showLatexBlockEditor();
          return;
        }
        showHtmlBlockEditor();
      }

      function showDeleteConfirmation() {
        if (document.querySelector(".html-block-delete-confirm")) return;
        const confirmation = document.createElement("div");
        confirmation.className = "html-block-delete-confirm";
        confirmation.setAttribute("role", "dialog");
        confirmation.setAttribute("aria-modal", "true");
        confirmation.setAttribute("aria-label", "Delete block confirmation");
        confirmation.innerHTML = `
          <div class="html-block-delete-dialog">
            <p class="html-block-delete-eyebrow">Delete block</p>
            <h2>Delete this content block?</h2>
            <p>This removes the block from the draft. You can still use undo after deleting.</p>
            <div class="html-block-delete-actions">
              <button type="button" data-action="cancel">Cancel</button>
              <button type="button" data-action="delete">Delete Block</button>
            </div>
          </div>
        `;
        function removeConfirmation() {
          confirmation.remove();
          document.removeEventListener("keydown", handleConfirmationKeyDown);
        }
        function handleConfirmationKeyDown(event: KeyboardEvent) {
          if (event.key === "Escape") {
            removeConfirmation();
          }
        }
        confirmation.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const action = target.dataset.action;
          if (action === "cancel") {
            removeConfirmation();
          }
          if (action === "delete") {
            removeConfirmation();
            deleteHtmlBlock();
          }
          if (target === confirmation) {
            removeConfirmation();
          }
        });
        document.body.appendChild(confirmation);
        document.addEventListener("keydown", handleConfirmationKeyDown);
      }

      let editableRegions: HTMLElement[] = [];
      function setupEditableRegions() {
        editableRegions = Array.from(content.querySelectorAll<HTMLElement>("[data-html-block-editable]"));
        editableRegions.forEach((editableRegion) => {
          editableRegion.contentEditable = "true";
          editableRegion.spellcheck = true;
          editableRegion.addEventListener("blur", updateHtmlBlockContent);
        });
      }
      setupEditableRegions();

      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "html-block-edit";
      editButton.textContent = latexBlockElement() ? "Edit Equation" : "Edit HTML";
      editButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showSourceEditor();
      });
      if (editableRegions.length === 0) {
        wrapper.appendChild(editButton);
      } else {
        const controls = document.createElement("div");
        controls.className = "html-block-controls";

        const editSourceButton = document.createElement("button");
        editSourceButton.type = "button";
        editSourceButton.textContent = latexBlockElement() ? "Edit Equation" : "Edit HTML";
        editSourceButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          showSourceEditor();
        });

        const duplicateButton = document.createElement("button");
        duplicateButton.type = "button";
        duplicateButton.textContent = "Duplicate";
        duplicateButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          duplicateHtmlBlock();
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          showDeleteConfirmation();
        });

        controls.appendChild(editSourceButton);
        controls.appendChild(duplicateButton);
        controls.appendChild(deleteButton);
        wrapper.appendChild(controls);
      }

      return {
        dom: wrapper,
        ignoreMutation: (mutation) => editableRegions.some((region) => region.contains(mutation.target)),
        stopEvent: (event) => {
          const target = event.target;
          return target instanceof globalThis.Node && editableRegions.some((region) => region.contains(target));
        },
        update: (updatedNode) => {
          if (updatedNode.type.name !== currentNode.type.name) return false;
          currentNode = updatedNode;
          if (document.activeElement && editableRegions.some((region) => region.contains(document.activeElement))) {
            return true;
          }
          content.innerHTML = updatedNode.attrs.content || "";
          setupEditableRegions();
          return true;
        },
      };
    };
  },
});

const SpanStyle = Mark.create({
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

const SubscriptMark = Mark.create({
  name: "subscript",

  parseHTML() {
    return [{ tag: "sub" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sub", mergeAttributes(HTMLAttributes), 0];
  },
});

const SuperscriptMark = Mark.create({
  name: "superscript",

  parseHTML() {
    return [{ tag: "sup" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes), 0];
  },
});

const CanvasImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...preservedAttributes([
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
      ]),
    };
  },
});

function imageSrcMatches(attrSrc: string | null, domSrc: string) {
  if (!attrSrc) return false;
  if (attrSrc === domSrc) return true;
  try {
    return new URL(attrSrc, window.location.origin).href === domSrc;
  } catch {
    return domSrc.endsWith(attrSrc);
  }
}

const IMAGE_ALIGN_STYLES: Record<string, string> = {
  left: "",
  center: "display:block;margin-left:auto;margin-right:auto;",
  right: "display:block;margin-left:auto;margin-right:0;",
  "float-left": "float:left;margin:0 12px 8px 0;",
  "float-right": "float:right;margin:0 0 8px 12px;",
};

const ResizableCanvasImage = CanvasImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("width") || element.style.width?.replace("px", "") || null,
      },
      height: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("height") || element.style.height?.replace("px", "") || null,
      },
      align: {
        default: "left",
        parseHTML: (element: HTMLElement) => {
          const style = element.getAttribute("style") || "";
          if (style.includes("float:right") || style.includes("float: right")) return "float-right";
          if (style.includes("float:left") || style.includes("float: left")) return "float-left";
          if (style.includes("margin-left:auto") && style.includes("margin-right:auto")) return "center";
          if (style.includes("margin-left:auto") || style.includes("margin-left: auto")) return "right";
          return "left";
        },
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const { align, style, width, height, ...rest } = HTMLAttributes;
    const widthStyle = width ? `width:${String(width)}${String(width).includes("%") ? "" : "px"};` : "";
    const nextStyle = [style, IMAGE_ALIGN_STYLES[String(align || "left")] || "", widthStyle].filter(Boolean).join("");
    return ["img", mergeAttributes(rest, width ? { width } : {}, height ? { height } : {}, nextStyle ? { style: nextStyle } : {})];
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setImageSize: (attrs: Record<string, unknown>) => ({ commands }) => commands.updateAttributes("image", attrs),
    };
  },

  addProseMirrorPlugins() {
    let overlayEl: HTMLElement | null = null;
    let selectedImgPos: number | null = null;
    let selectedImgDom: HTMLImageElement | null = null;
    let resizeState: {
      pos: number;
      startX: number;
      startWidth: number;
      startHeight: number;
      aspectRatio: number;
      newWidth?: number;
      newHeight?: number;
    } | null = null;
    const editor = this.editor;

    function removeOverlay() {
      overlayEl?.remove();
      overlayEl = null;
      selectedImgPos = null;
      selectedImgDom = null;
    }

    function positionOverlay(viewDom: HTMLElement) {
      if (!overlayEl || !selectedImgDom) return;
      const wrapper = viewDom.parentElement;
      if (!wrapper) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const imageRect = selectedImgDom.getBoundingClientRect();
      overlayEl.style.top = `${imageRect.top - wrapperRect.top + wrapper.scrollTop}px`;
      overlayEl.style.left = `${imageRect.left - wrapperRect.left + wrapper.scrollLeft}px`;
      overlayEl.style.width = `${imageRect.width}px`;
      overlayEl.style.height = `${imageRect.height}px`;
    }

    function showOverlay(pos: number, imgDom: HTMLImageElement) {
      removeOverlay();
      const wrapper = editor.view.dom.parentElement as HTMLElement | null;
      if (!wrapper) return;
      selectedImgPos = pos;
      selectedImgDom = imgDom;
      if (window.getComputedStyle(wrapper).position === "static") wrapper.style.position = "relative";

      overlayEl = document.createElement("div");
      overlayEl.className = "image-resize-overlay";

      const handle = document.createElement("div");
      handle.className = "image-resize-handle";
      handle.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const startWidth = imgDom.offsetWidth;
        const startHeight = imgDom.offsetHeight || startWidth;
        resizeState = {
          pos,
          startX: event.clientX,
          startWidth,
          startHeight,
          aspectRatio: startWidth / startHeight,
        };

        function onMove(moveEvent: MouseEvent) {
          if (!resizeState) return;
          const cellEl = imgDom.closest("td, th") as HTMLElement | null;
          const maxWidth = cellEl ? Math.max(80, cellEl.clientWidth - 16) : 1200;
          const nextWidth = Math.min(maxWidth, Math.max(50, resizeState.startWidth + moveEvent.clientX - resizeState.startX));
          const nextHeight = Math.round(nextWidth / resizeState.aspectRatio);
          imgDom.style.width = `${nextWidth}px`;
          imgDom.style.height = `${nextHeight}px`;
          if (overlayEl) {
            overlayEl.style.width = `${nextWidth}px`;
            overlayEl.style.height = `${nextHeight}px`;
          }
          resizeState.newWidth = nextWidth;
          resizeState.newHeight = nextHeight;
        }

        function onUp() {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          if (resizeState?.newWidth) {
            const node = editor.view.state.doc.nodeAt(resizeState.pos);
            if (node?.type.name === "image") {
              editor.view.dispatch(editor.view.state.tr.setNodeMarkup(resizeState.pos, undefined, {
                ...node.attrs,
                width: resizeState.newWidth,
                height: resizeState.newHeight,
              }));
            }
          }
          resizeState = null;
        }

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
      overlayEl.appendChild(handle);
      wrapper.appendChild(overlayEl);
      positionOverlay(editor.view.dom);
    }

    return [
      new Plugin({
        key: new PluginKey("resizableCanvasImage"),
        view(editorView) {
          function onClick(event: MouseEvent) {
            const target = event.target as HTMLElement;
            if (target.closest(".image-resize-overlay")) return;
            if (target.tagName !== "IMG") {
              removeOverlay();
              return;
            }
            let found = false;
            editorView.state.doc.descendants((child, pos) => {
              if (found) return false;
              if (child.type.name === "image" && imageSrcMatches(child.attrs.src, (target as HTMLImageElement).src)) {
                showOverlay(pos, target as HTMLImageElement);
                found = true;
                return false;
              }
            });
          }

          function onScroll() {
            positionOverlay(editorView.dom);
          }

          editorView.dom.addEventListener("click", onClick);
          window.addEventListener("scroll", onScroll, true);
          return {
            update() {
              if (resizeState) return;
              if (selectedImgPos !== null && (!editorView.state.doc.nodeAt(selectedImgPos) || !selectedImgDom?.isConnected)) {
                removeOverlay();
              } else {
                positionOverlay(editorView.dom);
              }
            },
            destroy() {
              editorView.dom.removeEventListener("click", onClick);
              window.removeEventListener("scroll", onScroll, true);
              removeOverlay();
            },
          };
        },
      }),
    ];
  },
});

const CanvasTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...preservedAttributes(),
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "table",
      mergeAttributes(
        { style: "border-collapse: collapse; width: 100%;" },
        HTMLAttributes,
      ),
      0,
    ];
  },
});

const CanvasTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...preservedAttributes(),
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "td",
      mergeAttributes(
        { style: "border: 1px solid #d6d6d6; padding: 0.5rem;" },
        HTMLAttributes,
      ),
      0,
    ];
  },
});

const CanvasTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...preservedAttributes(),
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "th",
      mergeAttributes(
        { style: "border: 1px solid #d6d6d6; padding: 0.5rem; text-align: left;" },
        HTMLAttributes,
      ),
      0,
    ];
  },
});

const CanvasLink = Link.extend({
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

type RevisionRow = {
  id: string;
  revision_number: number;
  before_title: string | null;
  after_title: string | null;
  change_summary: string | null;
  created_at: string;
};

type PendingContentChange = {
  change_type: "content_edit";
  review_status: string;
  content_item_id: string;
  content_type: string;
  title: string | null;
  module_name: string | null;
  revision_count: number;
  latest_revision_number: number;
  latest_changed_at: string;
  change_summary: string | null;
  diff_summary: string;
  has_changes: boolean;
  title_changed: boolean;
  body_changed: boolean;
  affected_fields: string[];
  before_title: string | null;
  after_title: string | null;
  before_word_count: number;
  after_word_count: number;
  word_delta: number;
};

type PendingDiffResponse = PendingContentChange & {
  unified_diff: string;
};

type PendingModuleChange = {
  id: string;
  change_type: "module_operation";
  review_status: string;
  operation_type: string;
  content_item_id: string | null;
  title: string | null;
  action_label: string;
  detail: string | null;
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  updated_at: string;
};

type PendingChangesResponse = {
  content_changes: PendingContentChange[];
  module_changes: PendingModuleChange[];
  counts: {
    content: number;
    modules: number;
    total: number;
  };
};

type BatchPushState = {
  status: "queued" | "pushing" | "pushed" | "failed";
  message?: string;
};

type PushHistoryItem = {
  id: string;
  created_at: string;
  batch_id: string | null;
  content_item_id: string | null;
  canvas_id: string | null;
  canvas_response_id: string | null;
  content_type: string | null;
  title: string | null;
  canvas_url: string | null;
  published: boolean | null;
  revision_count: number;
  first_revision_number: number | null;
  latest_revision_number: number | null;
  first_changed_at: string | null;
  latest_changed_at: string | null;
  latest_change_summary: string | null;
  change_summaries: string[];
};

type ModuleApplyHistoryOperation = {
  id: string;
  module_id?: string;
  module_item_id?: string;
  title?: string | null;
  operation_type?: string;
  after_state?: Record<string, unknown>;
  canvas_response_id?: string | number | null;
};

type ModuleApplyHistoryItem = {
  id: string;
  created_at: string;
  applied_count: number;
  failed_count: number;
  operation_ids: string[];
  operations: ModuleApplyHistoryOperation[];
  failed: Array<Record<string, unknown>>;
};

type SaveResponse = {
  id: string;
  title: string | null;
  canvas_url?: string | null;
  published: boolean | null;
  html_body: string;
  plain_text: string;
  revision_count: number;
  saved?: boolean;
  revision_number?: number;
  pushed?: boolean;
};

type CanvasRevisionRow = {
  revision_id: number;
  updated_at: string | null;
  latest?: boolean | null;
  edited_by?: {
    id?: number | string | null;
    display_name?: string | null;
  } | null;
  title?: string | null;
};

type CanvasRevisionPreview = CanvasRevisionRow & {
  body: string;
};

type SourceCourse = {
  course_id: string;
  name: string;
  course_code?: string | null;
  workflow_state?: string | null;
  term_name?: string | null;
};

type SourcePageMatch = {
  page_url: string;
  title: string;
  html_url?: string | null;
  updated_at?: string | null;
  published?: boolean | null;
};

type SourcePagePreview = SourcePageMatch & {
  body: string;
};

type ManagedImageInsertMode = "image" | "imageText" | "imageCard" | "profileCard" | "fullWidthImage" | "testimonial";
type ManagedContentBlockMode = "moduleHeader" | "pullQuote" | "stepIndicator";

type EditorImageUploadResponse = {
  image: {
    id: string;
    canvas_url: string;
    edited_alt_text: string | null;
    long_description: string | null;
    is_decorative: boolean;
  };
  insert: {
    src: string;
    alt?: string | null;
    title?: string | null;
    canvas_file_id?: string | null;
  };
};

type EditorFileUploadResponse = {
  file: {
    content_item_id: string | null;
    canvas_file_id: string;
    canvas_url: string;
    filename: string;
    title: string;
    content_type: string;
    size: number;
    document_id: string | null;
    stored_in_r2: boolean;
    initial_accessibility_review?: {
      status: string;
      issues: Array<{ code: string; message: string }>;
      page_count?: number | null;
    } | null;
  };
  insert: {
    href: string;
    text: string;
    canvas_file_id: string;
  };
};

type EditorImageReviewState = {
  imageId: string;
  src: string;
  title: string;
  canvasFileId: string | null;
  insertMode: ManagedImageInsertMode;
};

type ImageReviewGenerateResponse = {
  job_id?: string;
  status?: string;
  edited_alt_text?: string | null;
  long_description?: string | null;
  is_decorative?: boolean;
};

type HtmlBlockEditRequest = {
  content: string;
  update: (nextContent: string) => void;
};

type LatexBlockEditRequest = {
  latex: string;
  displayMode: boolean;
  update: (nextContent: string) => void;
};

type AccessibilityIssue = {
  id: string;
  severity: "error" | "warning";
  rule: string;
  code: "img-alt" | "filename-alt" | "empty-heading" | "heading-skip" | "empty-link" | "vague-link" | "file-link" | "table-header" | "color-contrast";
  message: string;
  fix: string;
  context?: string;
  index?: number;
  previousLevel?: number;
  currentLevel?: number;
  text?: string;
  href?: string;
};

export type ContentEditorItem = {
  id: string;
  title: string | null;
  content_type: string;
  canvas_url: string | null;
  published: boolean | null;
  module_name: string | null;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function managedImageBlockLabel(mode: ManagedImageInsertMode) {
  if (mode === "imageText") return "Image + Text";
  if (mode === "imageCard") return "Image Card";
  if (mode === "profileCard") return "Profile Card";
  if (mode === "fullWidthImage") return "Full Width Image";
  if (mode === "testimonial") return "Testimonial";
  return "image";
}

function buildManagedImageAttrs({
  alt,
  canvasFileId,
  decorative,
  src,
  style,
  title,
}: {
  alt: string;
  canvasFileId: string | null;
  decorative: boolean;
  src: string;
  style: string;
  title: string;
}) {
  return [
    `src="${escapeAttribute(src)}"`,
    `alt="${decorative ? "" : escapeAttribute(alt)}"`,
    title ? `title="${escapeAttribute(title)}"` : "",
    canvasFileId ? `data-canvas-file-id="${escapeAttribute(canvasFileId)}"` : "",
    decorative ? 'role="presentation"' : "",
    decorative ? 'data-decorative="true"' : "",
    `style="${escapeAttribute(style)}"`,
  ].filter(Boolean).join(" ");
}

function buildManagedImageBlockHtml({
  alt,
  canvasFileId,
  decorative,
  mode,
  src,
  title,
}: {
  alt: string;
  canvasFileId: string | null;
  decorative: boolean;
  mode: ManagedImageInsertMode;
  src: string;
  title: string;
}) {
  if (mode === "imageCard") {
    const imgAttrs = buildManagedImageAttrs({
      alt,
      canvasFileId,
      decorative,
      src,
      title,
      style: "width:100%;height:200px;object-fit:cover;",
    });
    return `<div style="border:1px solid #e0e0e0;border-radius:12px;overflow:hidden;margin:16px 0;max-width:360px;"><img ${imgAttrs} /><div data-html-block-editable="true" style="padding:16px;"><p style="font-weight:600;margin:0;">Card Title</p><p style="margin:8px 0 0;color:#555;font-size:14px;">Card description text.</p></div></div>`;
  }
  if (mode === "profileCard") {
    const imgAttrs = buildManagedImageAttrs({
      alt,
      canvasFileId,
      decorative,
      src,
      title,
      style: "width:80px;height:80px;border-radius:50%;object-fit:cover;flex-shrink:0;",
    });
    return `<div style="display:flex;gap:16px;align-items:center;border:1px solid #e0e0e0;border-radius:12px;padding:20px;margin:16px 0;flex-wrap:wrap;"><img ${imgAttrs} /><div data-html-block-editable="true" style="min-width:220px;flex:1;"><p style="font-weight:600;margin:0;">Full Name</p><p style="color:#8C1D40;font-size:14px;margin:4px 0;">Role / Title</p><p style="color:#555;font-size:14px;margin:0;">Short bio.</p></div></div>`;
  }
  if (mode === "fullWidthImage") {
    const imgAttrs = buildManagedImageAttrs({
      alt,
      canvasFileId,
      decorative,
      src,
      title,
      style: "width:100%;border-radius:8px;",
    });
    return `<figure style="margin:16px 0;"><img ${imgAttrs} /><figcaption data-html-block-editable="true" style="text-align:center;font-size:13px;color:#666;margin-top:8px;">Image caption goes here</figcaption></figure>`;
  }
  if (mode === "testimonial") {
    const imgAttrs = buildManagedImageAttrs({
      alt,
      canvasFileId,
      decorative,
      src,
      title,
      style: "width:48px;height:48px;border-radius:50%;object-fit:cover;flex-shrink:0;",
    });
    return `<div style="display:flex;gap:16px;align-items:flex-start;background:#f8f5ef;border-radius:12px;padding:20px;margin:16px 0;flex-wrap:wrap;"><img ${imgAttrs} /><div data-html-block-editable="true" style="min-width:220px;flex:1;"><p style="font-style:italic;margin:0;line-height:1.5;">"Replace this with the testimonial text."</p><p style="font-weight:600;margin:8px 0 0;color:#8C1D40;">- Name, Title</p></div></div>`;
  }

  const imgAttrs = buildManagedImageAttrs({
    alt,
    canvasFileId,
    decorative,
    src,
    title,
    style: "width:40%;min-width:220px;border-radius:8px;object-fit:cover;align-self:stretch;max-height:320px;",
  });
  return `<div style="display:flex;gap:20px;align-items:flex-start;margin:16px 0;flex-wrap:wrap;"><img ${imgAttrs} /><div data-html-block-editable="true" style="flex:1;min-width:240px;"><p style="font-weight:600;margin:0;">Title Here</p><p style="margin:8px 0 0;">Description text goes here.</p></div></div>`;
}

function buildManagedContentBlockHtml(mode: ManagedContentBlockMode) {
  if (mode === "moduleHeader") {
    return `<div data-html-block-editable="true" style="background:linear-gradient(to right,#8C1D40,#5C0F2D);color:#fff;padding:24px 28px;border-radius:10px;margin:16px 0;"><p style="font-size:.85em;text-transform:uppercase;letter-spacing:1px;margin:0;opacity:.85;">Module 1</p><p style="font-size:1.6em;font-weight:700;margin:6px 0 0;">Module Title Here</p><p style="margin:8px 0 0;opacity:.9;font-size:.95em;">Brief module description.</p></div>`;
  }
  if (mode === "pullQuote") {
    return `<div data-html-block-editable="true" style="text-align:center;margin:32px 0;padding:20px;"><p style="font-size:1.5em;font-style:italic;color:#333;line-height:1.5;margin:0;">"Replace this with a meaningful quote."</p><p style="color:#8C1D40;font-weight:600;margin:12px 0 0;">- Attribution Name</p></div>`;
  }
  if (mode === "stepIndicator") {
    return `<div style="display:flex;gap:0;align-items:flex-start;margin:16px 0;flex-wrap:wrap;"><div data-html-block-editable="true" style="text-align:center;flex:1;min-width:140px;"><div style="width:40px;height:40px;background:#8C1D40;color:#fff;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:700;">1</div><p style="font-size:13px;margin:8px 0 0;font-weight:600;">Step One</p></div><div style="flex:0 0 40px;height:2px;background:#8C1D40;margin-top:20px;"></div><div data-html-block-editable="true" style="text-align:center;flex:1;min-width:140px;"><div style="width:40px;height:40px;background:#FFC627;color:#1a1a1a;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:700;">2</div><p style="font-size:13px;margin:8px 0 0;font-weight:600;">Step Two</p></div><div style="flex:0 0 40px;height:2px;background:#ddd;margin-top:20px;"></div><div data-html-block-editable="true" style="text-align:center;flex:1;min-width:140px;"><div style="width:40px;height:40px;background:#e0e0e0;color:#666;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:700;">3</div><p style="font-size:13px;margin:8px 0 0;font-weight:600;">Step Three</p></div></div>`;
  }
  return "";
}

function buildColumnLayoutHtml(columns: 2 | 3) {
  const columnWidth = columns === 2 ? "50%" : "33.3333%";
  const cells = Array.from({ length: columns }, (_, index) => (
    `<td style="width:${columnWidth};border:none;padding:${columns === 2 ? "16px" : "12px"};vertical-align:top;background:#f9f9f9;"><p>Column ${index + 1}${columns === 2 ? " content" : ""}</p></td>`
  )).join("");
  return `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:${columns === 2 ? "24px" : "16px"};margin:16px 0;"><tbody><tr>${cells}</tr></tbody></table>`;
}

function buildCtaButtonHtml(url: string, label: string) {
  return `<div style="text-align:center;margin:24px 0;"><a data-html-block-editable="true" href="${escapeAttribute(url)}" style="display:inline-block;padding:14px 32px;background:#8C1D40;color:#fff;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;box-shadow:0 2px 8px rgba(140,29,64,0.3);">${escapeHtml(label)}</a></div>`;
}

function normalizeCtaUrl(url: string) {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return "";
  if (/^(#|\/|[a-z][a-z0-9+.-]*:)/i.test(trimmedUrl)) return trimmedUrl;
  return `https://${trimmedUrl}`;
}

function parseVideoEmbedUrl(url: string) {
  const trimmed = url.trim();
  let match = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (match) return { provider: "YouTube", embedUrl: `https://www.youtube.com/embed/${match[1]}` };
  match = trimmed.match(/vimeo\.com\/(\d+)/);
  if (match) return { provider: "Vimeo", embedUrl: `https://player.vimeo.com/video/${match[1]}` };
  if (/^https?:\/\//i.test(trimmed)) return { provider: "URL", embedUrl: trimmed };
  return null;
}

function buildVideoEmbedHtml(embedUrl: string) {
  return `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;margin:16px 0;border-radius:8px;"><iframe src="${escapeAttribute(embedUrl)}" title="Embedded video" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
}

const LATEX_DISPLAY_REPLACEMENTS: Record<string, string> = {
  "\\alpha": "α",
  "\\beta": "β",
  "\\gamma": "γ",
  "\\delta": "δ",
  "\\theta": "θ",
  "\\lambda": "λ",
  "\\pi": "π",
  "\\sigma": "σ",
  "\\omega": "ω",
  "\\Delta": "Δ",
  "\\Sigma": "Σ",
  "\\Omega": "Ω",
  "\\pm": "±",
  "\\times": "×",
  "\\div": "÷",
  "\\cdot": "⋅",
  "\\le": "≤",
  "\\ge": "≥",
  "\\ne": "≠",
  "\\approx": "≈",
  "\\equiv": "≡",
  "\\propto": "∝",
  "\\infty": "∞",
  "\\angle": "∠",
  "\\int": "∫",
  "\\iint": "∬",
  "\\sum": "∑",
  "\\prod": "∏",
  "\\partial": "∂",
  "\\nabla": "∇",
  "\\in": "∈",
  "\\notin": "∉",
  "\\subseteq": "⊆",
  "\\cup": "∪",
  "\\cap": "∩",
  "\\forall": "∀",
  "\\exists": "∃",
  "\\emptyset": "∅",
  "\\to": "→",
};

function renderLatexDisplay(latex: string) {
  let display = ` ${escapeHtml(latex.trim())} `;
  display = display.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '<span style="display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;line-height:1.05;margin:0 3px;"><span>$1</span><span style="border-top:1px solid currentColor;padding:1px 3px 0;">$2</span></span>');
  display = display.replace(/\\sqrt\{([^{}]*)\}/g, '√<span style="border-top:1px solid currentColor;padding:0 2px;">$1</span>');
  display = display.replace(/\^\{([^{}]*)\}/g, "<sup>$1</sup>");
  display = display.replace(/_\{([^{}]*)\}/g, "<sub>$1</sub>");
  display = display.replace(/\\lim/g, "lim");
  Object.entries(LATEX_DISPLAY_REPLACEMENTS)
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([source, replacement]) => {
      display = display.replaceAll(source, replacement);
    });
  display = display
    .replaceAll("\\left", "")
    .replaceAll("\\right", "")
    .replaceAll("\\,", " ")
    .replaceAll("\\;", " ")
    .replaceAll("\\", "");
  return display.trim() || escapeHtml(latex.trim());
}

function buildLatexHtml(latex: string, displayMode: boolean) {
  const source = latex.trim();
  const rendered = renderLatexDisplay(source);
  return `<div data-latex-block="true" data-latex-source="${escapeAttribute(source)}" data-latex-display-mode="${displayMode ? "display" : "inline"}" style="margin:16px 0;padding:14px 16px;border:1px solid #ddbfc3;border-radius:8px;background:#fff;"><p style="margin:0;font-family:Georgia,serif;font-size:${displayMode ? "1.35em" : "1.05em"};text-align:${displayMode ? "center" : "left"};">${rendered}</p></div>`;
}

function tableContextMenuPosition(clientX: number, clientY: number) {
  const menuWidth = 224;
  const menuHeight = 330;
  const margin = 8;
  const maxX = window.innerWidth - menuWidth - margin;
  const maxY = window.innerHeight - menuHeight - margin;
  return {
    x: Math.max(margin, Math.min(clientX, maxX)),
    y: Math.max(margin, Math.min(clientY, maxY)),
  };
}

function buildStyledTableHtml() {
  return `<table style="width:100%;border-collapse:collapse;margin:16px 0;"><thead><tr><th style="background:#8C1D40;color:#fff;padding:10px 12px;text-align:left;font-weight:600;">Header 1</th><th style="background:#8C1D40;color:#fff;padding:10px 12px;text-align:left;font-weight:600;">Header 2</th><th style="background:#8C1D40;color:#fff;padding:10px 12px;text-align:left;font-weight:600;">Header 3</th></tr></thead><tbody><tr style="background:#fff;"><td style="padding:10px 12px;border-bottom:1px solid #e0e0e0;">Cell 1</td><td style="padding:10px 12px;border-bottom:1px solid #e0e0e0;">Cell 2</td><td style="padding:10px 12px;border-bottom:1px solid #e0e0e0;">Cell 3</td></tr><tr style="background:#f8f5ef;"><td style="padding:10px 12px;border-bottom:1px solid #e0e0e0;">Cell 4</td><td style="padding:10px 12px;border-bottom:1px solid #e0e0e0;">Cell 5</td><td style="padding:10px 12px;border-bottom:1px solid #e0e0e0;">Cell 6</td></tr></tbody></table>`;
}

function previewDocument(htmlBody: string, plainText: string, baseHref: string) {
  const baseTag = baseHref ? `<base href="${escapeAttribute(baseHref)}" target="_blank">` : "";
  const body = htmlBody || `<pre>${escapeHtml(plainText || "No saved body content was found for this item.")}</pre>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${baseTag}
  <style>
    :root { color: #0b1c30; background: #ffffff; font-family: Inter, Arial, sans-serif; }
    body { margin: 0; padding: 28px; line-height: 1.55; font-size: 15px; }
    h1, h2, h3, h4, h5, h6 { font-family: Manrope, Arial, sans-serif; line-height: 1.2; margin: 1.2em 0 0.45em; }
    h1 { font-size: 1.8rem; } h2 { font-size: 1.45rem; } h3 { font-size: 1.2rem; }
    p, ul, ol, table, blockquote, pre { margin: 0.75rem 0; }
    blockquote { border-left: 4px solid #8c1d40; margin-left: 0; padding: 0.25rem 0 0.25rem 1rem; color: #564145; background: #eff4ff; }
    a { color: #8c1d40; text-decoration: underline; overflow-wrap: anywhere; }
    img, video, iframe, embed, object { max-width: 100%; }
    img { height: auto; }
    iframe { width: 100%; min-height: 320px; border: 1px solid #ddbfc3; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddbfc3; padding: 0.5rem; vertical-align: top; }
    th { background: #eff4ff; text-align: left; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #eff4ff; padding: 1rem; border-radius: 8px; }
    .callout-box { border-radius: 8px; padding: 12px 16px; margin: 16px 0; border-left: 4px solid #94a3b8; background: #f8fafc; }
    .callout-box[data-callout-type="info"] { border-left-color: #3b82f6; background: #eff6ff; }
    .callout-box[data-callout-type="warning"] { border-left-color: #f59e0b; background: #fffbeb; }
    .callout-box[data-callout-type="tip"] { border-left-color: #10b981; background: #ecfdf5; }
    .callout-box[data-callout-type="note"] { border-left-color: #8b5cf6; background: #f5f3ff; }
    details.accordion-block, details:not([style*="border"]) { border: 1px solid #ddbfc3; border-radius: 8px; overflow: hidden; background: #fff; }
    details > summary { cursor: pointer; padding: 12px 16px; font-weight: 700; background: #eff4ff; }
    details > summary::-webkit-details-marker { display: none; }
    details > summary::before { content: "▸"; display: inline-block; margin-right: 8px; color: #8c1d40; }
    details[open] > summary::before { transform: rotate(90deg); }
    details .accordion-content, details > :not(summary) { padding: 12px 16px; }
    .separator-thin { border: none; border-top: 1px solid #cbd5e1; }
    .separator-thick { border: none; border-top: 4px solid #cbd5e1; }
    .separator-dashed { border: none; border-top: 2px dashed #cbd5e1; }
    .separator-dotted { border: none; border-top: 2px dotted #cbd5e1; }
    .separator-double { border: none; border-top: 4px double #cbd5e1; }
    .separator-gradient { height: 4px; border: none; background: linear-gradient(90deg, #8c1d40, #ffc627); }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusBadgeClass(status: string) {
  if (status === "ready to push") return "bg-primary/10 text-primary";
  if (status === "staged module change") return "bg-secondary-container text-on-secondary-container";
  if (status === "pushed") return "bg-surface-container-high text-on-surface-variant";
  return "bg-surface-container-low text-on-surface-variant";
}

function formatFieldList(fields: string[]) {
  return fields.map((field) => field.replaceAll("_", " ")).join(" + ");
}

function batchStatusLabel(state?: BatchPushState) {
  if (!state) return null;
  if (state.status === "queued") return "Queued";
  if (state.status === "pushing") return "Pushing";
  if (state.status === "pushed") return "Pushed";
  return "Failed";
}

function batchStatusClass(state?: BatchPushState) {
  if (!state) return "";
  if (state.status === "pushed") return "bg-primary/10 text-primary";
  if (state.status === "failed") return "bg-error-container text-error";
  if (state.status === "pushing") return "bg-secondary-container text-on-secondary-container";
  return "bg-surface-container-high text-on-surface-variant";
}

function formatModuleValue(value: unknown, fallback = "-") {
  if (typeof value === "boolean") return value ? "Published" : "Unpublished";
  if (typeof value === "number") return value.toString();
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

function moduleOperationToneClass(operationType: string) {
  if (["module_delete", "item_remove"].includes(operationType)) {
    return "border-error/25 bg-error/5";
  }
  if (operationType === "module_create") {
    return "border-primary/25 bg-primary/5";
  }
  if (operationType === "item_publish") {
    return "border-secondary-container/70 bg-secondary-container/15";
  }
  return "border-outline-variant/30 bg-surface-container-low";
}

function moduleOperationBadgeClass(operationType: string) {
  if (["module_delete", "item_remove"].includes(operationType)) {
    return "bg-error-container text-error";
  }
  if (operationType === "module_create") {
    return "bg-primary/10 text-primary";
  }
  if (operationType === "item_publish") {
    return "bg-secondary-container text-on-secondary-container";
  }
  return "bg-surface-container-high text-on-surface-variant";
}

function canApplyModuleOperationIndividually(operationType: string) {
  return operationType === "module_create" || operationType === "module_rename" || operationType === "item_rename";
}

function moduleOperationCompareRows(change: PendingModuleChange) {
  const before = change.before_state ?? {};
  const after = change.after_state ?? {};

  switch (change.operation_type) {
    case "module_create":
      return [
        { label: "Module", before: "Not in Canvas", after: after.name ?? change.title },
        { label: "Module position", before: "-", after: after.position },
      ];
    case "module_rename":
      return [{ label: "Module name", before: before.name, after: after.name }];
    case "module_position":
      return [{ label: "Module position", before: before.position, after: after.position }];
    case "module_delete":
      return [
        { label: "Module", before: before.name ?? change.title, after: "Deleted" },
        { label: "Module items", before: before.items_count, after: "Removed from module structure" },
      ];
    case "item_rename":
      return [{ label: "Item title", before: before.title ?? change.title, after: after.title }];
    case "item_publish":
      return [{ label: "Status", before: before.published, after: after.published }];
    case "item_indent":
      return [{ label: "Indent", before: before.indent, after: after.indent }];
    case "item_position":
      return [{ label: "Position", before: before.position, after: after.position }];
    case "item_move":
      return [
        { label: "Module", before: before.module_name, after: after.module_name },
        { label: "Position", before: before.position, after: after.position },
      ];
    case "item_remove":
      return [
        { label: "Module", before: before.module_name, after: "Removed" },
        { label: "Position", before: before.position, after: "-" },
      ];
    default:
      return [];
  }
}

function contentTypeLabel(value: string | null) {
  if (!value) return "Content";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function pushRevisionLabel(historyItem: PushHistoryItem) {
  if (!historyItem.revision_count) return null;
  const noun = historyItem.revision_count === 1 ? "revision" : "revisions";
  if (historyItem.first_revision_number && historyItem.latest_revision_number) {
    if (historyItem.first_revision_number === historyItem.latest_revision_number) {
      return `Revision ${historyItem.latest_revision_number} pushed`;
    }
    return `Revisions ${historyItem.first_revision_number}-${historyItem.latest_revision_number} pushed`;
  }
  return `${historyItem.revision_count} ${noun} pushed`;
}

function moduleOperationTypeLabel(value?: string) {
  if (!value) return "Module update";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function getAccessToken() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return body.detail ?? fallback;
}

async function fetchJson<T>(path: string, token: string, fallback: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(await parseApiError(res, fallback));
  }
  return res.json() as Promise<T>;
}

function ToolbarButton({
  active,
  children,
  disabled,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-semibold transition-colors ${
        active
          ? "bg-secondary-container text-on-secondary-container"
          : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function AISelectionToolbar({ editor, sessionId }: { editor: Editor | null; sessionId: string }) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ text: string; from: number; to: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<{ from: number; to: number } | null>(null);

  function closeAIOverlay() {
    setVisible(false);
    setMenuOpen(false);
    setPreview(null);
    setError(null);
    selectionRef.current = null;
  }

  useEffect(() => {
    if (!editor) return;

    function updateSelection() {
      if (!editor || loadingAction || preview || menuOpen) return;
      const { from, to, empty } = editor.state.selection;
      if (empty || to - from < 2) {
        setVisible(false);
        setMenuOpen(false);
        setError(null);
        selectionRef.current = null;
        return;
      }
      const selectedText = editor.state.doc.textBetween(from, to, " ");
      if (!selectedText.trim()) {
        setVisible(false);
        setMenuOpen(false);
        setError(null);
        selectionRef.current = null;
        return;
      }
      try {
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        setCoords({ x: (start.left + end.left) / 2, y: Math.min(start.top, end.top) - 8 });
        selectionRef.current = { from, to };
        setVisible(true);
      } catch {
        setVisible(false);
      }
    }

    function handleBlur() {
      window.setTimeout(() => {
        if (toolbarRef.current?.contains(document.activeElement)) return;
        if (menuOpen || preview || loadingAction) return;
        setVisible(false);
      }, 150);
    }

    editor.on("selectionUpdate", updateSelection);
    editor.on("blur", handleBlur);
    return () => {
      editor.off("selectionUpdate", updateSelection);
      editor.off("blur", handleBlur);
    };
  }, [editor, loadingAction, menuOpen, preview]);

  useEffect(() => {
    if (!visible && !preview && !error && !menuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof globalThis.Node && toolbarRef.current?.contains(target)) return;
      if (loadingAction) return;
      closeAIOverlay();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (loadingAction) return;
      event.preventDefault();
      closeAIOverlay();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [error, loadingAction, menuOpen, preview, visible]);

  async function runAction(action: typeof AI_REWRITE_ACTIONS[number]) {
    if (!editor || !selectionRef.current || loadingAction) return;
    const { from, to } = selectionRef.current;
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    if (!selectedText.trim()) return;
    setLoadingAction(action.id);
    setMenuOpen(false);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/ai-rewrite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: selectedText,
          instruction: action.instruction,
          context: editorPlainText(editor, 3000),
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to rewrite selection"));
      }
      const data = await res.json() as { result?: string };
      const result = data.result?.trim();
      if (!result) throw new Error("AI returned an empty response.");
      setPreview({ text: result, from, to });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rewrite selection");
    } finally {
      setLoadingAction(null);
    }
  }

  function applyPreview() {
    if (!editor || !preview) return;
    editor.chain().focus().deleteRange({ from: preview.from, to: preview.to }).insertContentAt(preview.from, preview.text).run();
    setPreview(null);
    setVisible(false);
    selectionRef.current = null;
  }

  function discardPreview() {
    if (editor && preview) {
      editor.commands.setTextSelection({ from: preview.from, to: preview.to });
    }
    setPreview(null);
    setError(null);
  }

  if (!visible && !preview && !error) return null;

  return (
    <div
      ref={toolbarRef}
      className="fixed z-[70] -translate-x-1/2 -translate-y-full rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-1.5 shadow-2xl"
      style={{ left: coords.x, top: coords.y }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {preview ? (
        <div className="w-[min(420px,calc(100vw-32px))] p-2">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">AI Suggestion</p>
          <div className="max-h-36 overflow-y-auto rounded-lg bg-surface-container-low p-3 text-sm text-on-surface">
            {preview.text}
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={discardPreview} className="rounded-lg bg-surface-container-low px-3 py-1.5 text-xs font-semibold text-on-surface hover:bg-surface-container-high">
              Dismiss
            </button>
            <button type="button" onClick={applyPreview} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary hover:bg-primary-container">
              Replace Selection
            </button>
          </div>
        </div>
      ) : error ? (
        <div className="flex max-w-sm items-center gap-2 px-2 py-1 text-xs font-semibold text-error">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="rounded-md p-1 hover:bg-error-container">
            <X size={12} />
          </button>
        </div>
      ) : (
        <div className="relative flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-semibold text-on-primary hover:bg-primary-container"
          >
            <Sparkles size={14} />
            {loadingAction ? "Generating..." : "AI"}
          </button>
          {menuOpen ? (
            <div className="absolute left-0 top-10 w-44 rounded-xl border border-outline-variant/40 bg-white p-1.5 shadow-xl">
              {AI_REWRITE_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => void runAction(action)}
                  disabled={Boolean(loadingAction)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-50"
                >
                  <Sparkles size={12} />
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function AccessibilityCheckPanel({
  currentHtml,
  editor,
  editorMode,
  onClose,
  onApplyHtml,
  sessionId,
}: {
  currentHtml: string;
  editor: Editor | null;
  editorMode: "rich" | "html";
  onClose: () => void;
  onApplyHtml: (html: string) => void;
  sessionId: string;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const htmlBody = editorMode === "html" ? currentHtml : editor ? serializeHtmlBlocks(editor.getHTML()) : currentHtml;
  const issues = runAccessibilityChecks(htmlBody);
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof globalThis.Node && panelRef.current?.contains(target)) return;
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (!editor || editorMode !== "rich") return;
    function handleUpdate() {
      setRefreshKey((value) => value + 1);
    }
    editor.on("update", handleUpdate);
    return () => {
      editor.off("update", handleUpdate);
    };
  }, [editor, editorMode]);

  function canFixIssue(issue: AccessibilityIssue) {
    return ["empty-heading", "heading-skip", "table-header", "color-contrast", "empty-link", "vague-link", "file-link"].includes(issue.code);
  }

  function shouldRouteToImages(issue: AccessibilityIssue) {
    return issue.code === "img-alt" || issue.code === "filename-alt";
  }

  function fixLabel(issue: AccessibilityIssue) {
    if (issue.code === "empty-heading") return "Remove";
    if (issue.code === "heading-skip") return "Fix Level";
    if (issue.code === "table-header") return "Add Headers";
    if (issue.code === "color-contrast") return "Remove Color";
    if (issue.code === "empty-link" || issue.code === "vague-link" || issue.code === "file-link") return "Improve Text";
    return "Fix";
  }

  async function fixIssue(issue: AccessibilityIssue) {
    if (!canFixIssue(issue) || fixingId) return;
    setFixingId(issue.id);
    setFixError(null);
    try {
      let replacementText: string | undefined;
      if (issue.code === "empty-link" || issue.code === "vague-link" || issue.code === "file-link") {
        const token = await getAccessToken();
        const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/ai-rewrite`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            text: issue.text || "link",
            instruction: `This course link text is inaccessible, vague, or only a filename. Destination URL: ${issue.href || "unknown"}. Generate concise, descriptive replacement link text in 3-8 words. Return only the replacement text.`,
            context: editorPlainText(editor, 3000),
          }),
        });
        if (!res.ok) {
          throw new Error(await parseApiError(res, "Failed to improve link text"));
        }
        const data = await res.json() as { result?: string };
        replacementText = data.result?.trim().replace(/^["']|["']$/g, "");
        if (!replacementText) throw new Error("AI returned an empty response.");
      }
      const result = fixAccessibilityIssueInHtml(htmlBody, issue, replacementText);
      if (!result.fixed) throw new Error("Could not apply this fix automatically.");
      onApplyHtml(result.html);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setFixError(err instanceof Error ? err.message : "Failed to apply fix");
    } finally {
      setFixingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-end bg-on-surface/30 px-4 py-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="accessibility-check-title"
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant/30 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Tools</p>
            <h2 id="accessibility-check-title" className="mt-1 font-headline text-xl font-bold text-on-surface">
              Accessibility Check
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Re-check"
              onClick={() => setRefreshKey((value) => value + 1)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant transition-colors hover:bg-surface-container-high"
            >
              <RefreshCw size={15} />
            </button>
            <button
              type="button"
              title="Close"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant transition-colors hover:bg-surface-container-high"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 border-b border-outline-variant/20 px-5 py-3">
          <span className="rounded-full bg-error-container px-2.5 py-1 text-xs font-bold text-error">
            {errors.length} error{errors.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-full bg-secondary-container px-2.5 py-1 text-xs font-bold text-on-secondary-container">
            {warnings.length} warning{warnings.length === 1 ? "" : "s"}
          </span>
          {refreshKey > 0 ? (
            <span className="ml-auto text-xs font-semibold text-on-surface-variant">Rechecked</span>
          ) : null}
        </div>
        {fixError ? (
          <div className="border-b border-error/20 bg-error-container px-5 py-3 text-sm font-semibold text-error">
            {fixError}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {issues.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-low text-primary">
                <Sparkles size={18} />
              </div>
              <p className="font-semibold text-on-surface">No issues found</p>
              <p className="mt-1 text-sm text-on-surface-variant">Draft checks passed.</p>
            </div>
          ) : (
            <div className="divide-y divide-outline-variant/20">
              {issues.map((issue) => (
                <div key={issue.id} className="px-5 py-4">
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-full ${
                      issue.severity === "error"
                        ? "bg-error-container text-error"
                        : "bg-secondary-container text-on-secondary-container"
                    }`}>
                      <AlertTriangle size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-on-surface">{issue.message}</p>
                        <span className="rounded-full bg-surface-container-low px-2 py-0.5 text-[11px] font-semibold text-on-surface-variant">
                          {issue.rule}
                        </span>
                      </div>
                      {issue.context ? (
                        <p className="mt-1 truncate text-xs text-on-surface-variant">{issue.context}</p>
                      ) : null}
                      <p className="mt-2 text-sm text-on-surface-variant">{issue.fix}</p>
                      {canFixIssue(issue) ? (
                        <button
                          type="button"
                          disabled={Boolean(fixingId)}
                          onClick={() => void fixIssue(issue)}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {fixingId === issue.id ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
                          {fixingId === issue.id ? "Fixing..." : fixLabel(issue)}
                        </button>
                      ) : null}
                      {shouldRouteToImages(issue) ? (
                        <a
                          href={`/sessions/${sessionId}/images`}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-surface-container-low px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-surface-container-high"
                        >
                          Review in Images
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolbarDivider() {
  return <div className="mx-1 h-6 w-px bg-outline-variant/50" aria-hidden="true" />;
}

function ToolbarCluster({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-between border-r border-outline-variant/40 px-3 py-2 last:border-r-0">
      <div className="flex flex-col gap-1.5">{children}</div>
      <p className="pt-2 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface-variant">{label}</p>
    </div>
  );
}

function ToolbarLevel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-center gap-1 ${className}`}>{children}</div>;
}

function ColorSwatchPopover({
  colors,
  columns = 8,
  onClear,
  onSelect,
}: {
  colors: string[];
  columns?: number;
  onClear: () => void;
  onSelect: (color: string) => void;
}) {
  return (
    <div
      className="absolute left-0 top-10 z-[75] w-[278px] rounded-xl border border-outline-variant/40 bg-white p-3 shadow-2xl"
      onMouseDown={(event) => event.preventDefault()}
    >
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${columns}, 24px)` }}
      >
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            aria-label={color}
            onClick={() => onSelect(color)}
            className="h-6 w-6 rounded border border-outline-variant/50 transition-transform hover:scale-110"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="mt-2 w-full rounded-md bg-surface-container-low px-2 py-1 text-left text-xs font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high"
      >
        Clear
      </button>
    </div>
  );
}

function ToolbarDropdownItem({
  children,
  icon,
  onClick,
}: {
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
    >
      <span className="flex h-6 w-6 items-center justify-center text-on-surface-variant">{icon}</span>
      <span>{children}</span>
    </button>
  );
}

type SlashCommandItem = {
  id: string;
  label: string;
  category: string;
  description?: string;
  icon: string;
  action?: (editor: Editor) => void;
  imageMode?: ManagedImageInsertMode;
  opensCtaModal?: boolean;
};

const SLASH_COMMANDS: SlashCommandItem[] = [
  { id: "h2", label: "Heading 2", category: "Format", icon: "H2", action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: "h3", label: "Heading 3", category: "Format", icon: "H3", action: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: "h4", label: "Heading 4", category: "Format", icon: "H4", action: (editor) => editor.chain().focus().toggleHeading({ level: 4 }).run() },
  { id: "bullet", label: "Bullet List", category: "Format", icon: "UL", action: (editor) => editor.chain().focus().toggleBulletList().run() },
  { id: "numbered", label: "Numbered List", category: "Format", icon: "OL", action: (editor) => editor.chain().focus().toggleOrderedList().run() },
  { id: "quote", label: "Blockquote", category: "Format", icon: "QT", action: (editor) => editor.chain().focus().toggleBlockquote().run() },
  { id: "superscript", label: "Superscript", category: "Inline", icon: "X2", action: (editor) => editor.chain().focus().toggleMark("superscript").run() },
  { id: "subscript", label: "Subscript", category: "Inline", icon: "X_", action: (editor) => editor.chain().focus().toggleMark("subscript").run() },
  { id: "text-maroon", label: "Maroon Text", category: "Color", icon: "Aa", action: (editor) => updateInlineStyle(editor, "color", "#8c1d40") },
  { id: "text-gold", label: "Gold Text", category: "Color", icon: "Aa", action: (editor) => updateInlineStyle(editor, "color", "#775a00") },
  { id: "highlight-yellow", label: "Yellow Highlight", category: "Color", icon: "HL", action: (editor) => updateInlineStyle(editor, "background-color", "#fef08a") },
  { id: "highlight-gold", label: "Gold Highlight", category: "Color", icon: "HL", action: (editor) => updateInlineStyle(editor, "background-color", "#ffc627") },
  { id: "indent-increase", label: "Increase Indent", category: "Format", icon: ">>", action: (editor) => updateBlockIndent(editor, 1) },
  { id: "indent-decrease", label: "Decrease Indent", category: "Format", icon: "<<", action: (editor) => updateBlockIndent(editor, -1) },
  { id: "table", label: "Table", category: "Insert", icon: "TB", description: "3 by 3 table with header row", action: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: "styled-table", label: "Styled Table", category: "Layout", icon: "ST", description: "ASU-styled table with header row", action: (editor) => editor.chain().focus().insertContent(buildStyledTableHtml()).run() },
  { id: "two-column", label: "2-Column Layout", category: "Layout", icon: "2C", description: "Editable two-column layout table", action: (editor) => editor.chain().focus().insertContent(buildColumnLayoutHtml(2)).run() },
  { id: "three-column", label: "3-Column Layout", category: "Layout", icon: "3C", description: "Editable three-column layout table", action: (editor) => editor.chain().focus().insertContent(buildColumnLayoutHtml(3)).run() },
  { id: "module-header", label: "Module Header", category: "Block", icon: "MH", action: (editor) => editor.commands.insertHtmlBlock(buildManagedContentBlockHtml("moduleHeader")) },
  { id: "pull-quote", label: "Pull Quote", category: "Block", icon: "PQ", action: (editor) => editor.commands.insertHtmlBlock(buildManagedContentBlockHtml("pullQuote")) },
  { id: "step-indicator", label: "Step Indicator", category: "Block", icon: "123", action: (editor) => editor.commands.insertHtmlBlock(buildManagedContentBlockHtml("stepIndicator")) },
  { id: "cta-button", label: "CTA Button", category: "Block", icon: "CTA", description: "Button with custom text and URL", opensCtaModal: true },
  { id: "image-text", label: "Image + Text", category: "Image", icon: "IT", description: "Upload reviewed image beside editable text", imageMode: "imageText" },
  { id: "full-width-image", label: "Full Width Image", category: "Image", icon: "FW", description: "Upload reviewed image with editable caption", imageMode: "fullWidthImage" },
  { id: "image-card", label: "Image Card", category: "Image", icon: "IC", description: "Upload reviewed image above editable card text", imageMode: "imageCard" },
  { id: "profile-card", label: "Profile Card", category: "Image", icon: "PC", description: "Upload reviewed image for a profile card", imageMode: "profileCard" },
  { id: "testimonial", label: "Testimonial", category: "Image", icon: "TM", description: "Upload reviewed avatar with editable quote", imageMode: "testimonial" },
  { id: "accordion", label: "Accordion", category: "Block", icon: "AC", description: "Expandable details section", action: (editor) => editor.commands.insertAccordion() },
  { id: "callout-info", label: "Info Callout", category: "Block", icon: "IN", action: (editor) => editor.commands.insertCallout("info") },
  { id: "callout-warning", label: "Warning Callout", category: "Block", icon: "WR", action: (editor) => editor.commands.insertCallout("warning") },
  { id: "callout-tip", label: "Tip Callout", category: "Block", icon: "TP", action: (editor) => editor.commands.insertCallout("tip") },
  { id: "separator-thin", label: "Thin Separator", category: "Separator", icon: "--", action: (editor) => editor.commands.insertStyledSeparator("thin") },
  { id: "separator-dashed", label: "Dashed Separator", category: "Separator", icon: "- -", action: (editor) => editor.commands.insertStyledSeparator("dashed") },
  { id: "separator-gradient", label: "Gradient Separator", category: "Separator", icon: "AS", action: (editor) => editor.commands.insertStyledSeparator("gradient") },
  {
    id: "html-embed",
    label: "HTML Embed",
    category: "Embed",
    icon: "<>",
    description: "Placeholder block for iframe or custom HTML",
    action: (editor) => editor.commands.insertHtmlBlock('<div style="padding:16px;border:1px solid #ddbfc3;border-radius:8px;">Custom HTML block</div>'),
  },
];

function SlashCommandMenu({
  coords,
  editor,
  onClose,
  uploadImage,
}: {
  coords: { x: number; y: number };
  editor: Editor;
  onClose: () => void;
  uploadImage: (insertMode?: ManagedImageInsertMode) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [ctaModalOpen, setCtaModalOpen] = useState(false);
  const [ctaUrl, setCtaUrl] = useState("");
  const [ctaLabel, setCtaLabel] = useState("Call to Action");
  const [ctaError, setCtaError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter((item) =>
      `${item.label} ${item.category} ${item.description || ""}`.toLowerCase().includes(normalized),
    );
  }, [query]);

  const executeItem = useCallback((item: SlashCommandItem) => {
    const { from } = editor.state.selection;
    const textBefore = editor.state.doc.textBetween(Math.max(0, from - 40), from);
    const slashIndex = textBefore.lastIndexOf("/");
    if (slashIndex >= 0) {
      const deleteFrom = from - (textBefore.length - slashIndex);
      editor.chain().focus().deleteRange({ from: deleteFrom, to: from }).run();
    }
    if (item.imageMode) {
      uploadImage(item.imageMode);
      onClose();
      return;
    }
    if (item.opensCtaModal) {
      setCtaUrl("");
      setCtaLabel("Call to Action");
      setCtaError(null);
      setCtaModalOpen(true);
      return;
    }
    editor.commands.focus();
    item.action?.(editor);
    onClose();
  }, [editor, onClose, uploadImage]);

  function insertSlashCtaButton() {
    const normalizedUrl = normalizeCtaUrl(ctaUrl);
    if (!normalizedUrl) {
      setCtaError("Enter a URL for the button.");
      return;
    }
    editor.commands.focus();
    editor.commands.insertHtmlBlock(buildCtaButtonHtml(normalizedUrl, ctaLabel.trim() || "Call to Action"));
    onClose();
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (ctaModalOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => Math.min(current + 1, filtered.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => Math.max(current - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (filtered[activeIndex]) executeItem(filtered[activeIndex]);
        return;
      }
      if (event.key === "Backspace") {
        if (!query) onClose();
        else {
          setActiveIndex(0);
          setQuery((current) => current.slice(0, -1));
        }
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setActiveIndex(0);
        setQuery((current) => current + event.key);
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [activeIndex, ctaModalOpen, executeItem, filtered, onClose, query]);

  useEffect(() => {
    menuRef.current?.querySelector(".slash-active")?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const adjustedY = typeof window !== "undefined" && coords.y + 340 > window.innerHeight
    ? Math.max(8, coords.y - 330)
    : coords.y;

  if (ctaModalOpen) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-on-surface/50 px-4 py-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="slash-cta-button-title"
          className="w-full max-w-md overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4 border-b border-outline-variant/30 px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Insert</p>
              <h2 id="slash-cta-button-title" className="mt-1 font-headline text-xl font-bold text-on-surface">
                CTA Button
              </h2>
            </div>
            <button
              type="button"
              title="Close"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant transition-colors hover:bg-surface-container-high"
            >
              <X size={16} />
            </button>
          </div>
          <div className="space-y-4 px-5 py-4">
            {ctaError ? (
              <div className="rounded-xl border border-error/30 bg-error-container px-4 py-3 text-sm font-semibold text-error">
                {ctaError}
              </div>
            ) : null}
            <label className="block text-sm font-semibold text-on-surface">
              Button text
              <input
                type="text"
                value={ctaLabel}
                onChange={(event) => setCtaLabel(event.target.value)}
                className="mt-2 h-10 w-full rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm font-normal text-on-surface outline-none focus:border-primary"
                autoFocus
              />
            </label>
            <label className="block text-sm font-semibold text-on-surface">
              URL
              <input
                type="text"
                value={ctaUrl}
                onChange={(event) => {
                  setCtaUrl(event.target.value);
                  setCtaError(null);
                }}
                placeholder="https://example.edu"
                className="mt-2 h-10 w-full rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm font-normal text-on-surface outline-none focus:border-primary"
              />
            </label>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-outline-variant/30 px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-surface-container-low px-3 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={insertSlashCtaButton}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container"
            >
              Insert Button
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[70] w-80 overflow-hidden rounded-xl border border-outline-variant/40 bg-white shadow-2xl"
      style={{ left: Math.min(coords.x, typeof window === "undefined" ? coords.x : window.innerWidth - 340), top: adjustedY }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="border-b border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs font-semibold text-on-surface-variant">
        /{query}
      </div>
      <div className="max-h-80 overflow-y-auto py-1">
        {filtered.length ? filtered.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
              index === activeIndex ? "slash-active bg-primary/10 text-primary" : "text-on-surface hover:bg-surface-container-low"
            }`}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => executeItem(item)}
          >
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-surface-container-low font-mono text-[11px] font-bold">
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{item.label}</span>
              {item.description ? <span className="block truncate text-xs text-on-surface-variant">{item.description}</span> : null}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-on-surface-variant">{item.category}</span>
          </button>
        )) : (
          <div className="px-3 py-6 text-center text-sm text-on-surface-variant">No commands found.</div>
        )}
      </div>
    </div>
  );
}

function styleValue(style: unknown, property: string) {
  if (typeof style !== "string") return "";
  const match = style
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith(`${property.toLowerCase()}:`));
  return match?.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g, "") ?? "";
}

function updateInlineStyle(editor: Editor | null, property: string, value: string) {
  if (!editor) return;
  const currentStyle = String(editor.getAttributes("spanStyle").style ?? "");
  const nextStyle = updateStyleDeclaration(currentStyle, property, value);
  if (nextStyle) editor.chain().focus().setMark("spanStyle", { style: nextStyle }).run();
  else editor.chain().focus().unsetMark("spanStyle").run();
}

function updateStyleDeclaration(style: string, property: string, value: string) {
  const styles = style
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.toLowerCase().startsWith(`${property.toLowerCase()}:`));
  if (value) styles.push(`${property}: ${value}`);
  return styles.join("; ");
}

function blockIndentLevel(style: string) {
  const raw = styleValue(style, "margin-left");
  const match = raw.match(/^(\d+(?:\.\d+)?)(px|rem|em)?$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = match[2] || "px";
  if (unit === "rem" || unit === "em") return Math.round(amount / 1.5);
  return Math.round(amount / 24);
}

function updateBlockIndent(editor: Editor | null, direction: 1 | -1) {
  if (!editor) return;
  if (editor.isActive("listItem")) {
    const command = direction > 0
      ? editor.chain().focus().sinkListItem("listItem")
      : editor.chain().focus().liftListItem("listItem");
    if (command.run()) return;
  }

  const blockType = editor.isActive("heading") ? "heading" : "paragraph";
  const currentStyle = String(editor.getAttributes(blockType).style ?? "");
  const nextLevel = Math.max(0, Math.min(8, blockIndentLevel(currentStyle) + direction));
  const nextStyle = updateStyleDeclaration(currentStyle, "margin-left", nextLevel ? `${nextLevel * 24}px` : "");
  editor.chain().focus().updateAttributes(blockType, { style: nextStyle || null }).run();
}

function applyPillStyle(editor: Editor | null, color: string) {
  if (!editor) return;
  const { from, to } = editor.state.selection;
  if (from === to) return;
  const selectedText = editor.state.doc.textBetween(from, to);
  if (!selectedText.trim()) return;
  const foreground = color === "#ffc627" || color === "#775a00" ? "#ffffff" : "#ffffff";
  const style = [
    `background-color:${color}`,
    `color:${foreground}`,
    "padding:2px 10px",
    "border-radius:12px",
    "font-weight:700",
    "font-size:11px",
    "display:inline-block",
    "line-height:1.6",
    "vertical-align:middle",
    "margin-right:4px",
    "letter-spacing:0.5px",
    "text-transform:uppercase",
  ].join(";");
  editor.chain().focus().deleteSelection().insertContent(`<span style="${escapeAttribute(style)}">${escapeHtml(selectedText)}</span>`).run();
}

function EditorToolbar({
  editor,
  editorMode,
  insertAccordion,
  insertStyledSeparator,
  insertTable,
  mode,
  openHtmlBlockInsert,
  openLatexInsert,
  openAIGenerate,
  openAccessibilityCheck,
  openVideoEmbedInsert,
  setLink,
  setMode,
  switchEditorMode,
  openFindReplace,
  uploadFile,
  uploadImage,
  uploadingFile,
  uploadingImage,
}: {
  editor: Editor | null;
  editorMode: "rich" | "html";
  insertAccordion: () => void;
  insertStyledSeparator: (variant?: string) => void;
  insertTable: (rows?: number, cols?: number) => void;
  mode: "preview" | "edit" | "split";
  openHtmlBlockInsert: () => void;
  openLatexInsert: () => void;
  openAIGenerate: () => void;
  openAccessibilityCheck: () => void;
  openVideoEmbedInsert: () => void;
  setLink: () => void;
  setMode: (mode: "preview" | "edit" | "split") => void;
  switchEditorMode: (mode: "rich" | "html") => void;
  openFindReplace: () => void;
  uploadFile: () => void;
  uploadImage: (insertMode?: ManagedImageInsertMode) => void;
  uploadingFile: boolean;
  uploadingImage: boolean;
}) {
  const [colorPicker, setColorPicker] = useState<"text" | "highlight" | "pill" | null>(null);
  const [blocksMenuOpen, setBlocksMenuOpen] = useState(false);
  const blocksMenuRef = useRef<HTMLSpanElement>(null);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const tablePickerRef = useRef<HTMLSpanElement>(null);
  const [tablePickerSize, setTablePickerSize] = useState({ rows: 3, cols: 3 });
  const [ctaModalOpen, setCtaModalOpen] = useState(false);
  const [ctaUrl, setCtaUrl] = useState("");
  const [ctaLabel, setCtaLabel] = useState("Call to Action");
  const [ctaError, setCtaError] = useState<string | null>(null);
  const [, setSelectionVersion] = useState(0);
  const spanStyle = editor?.getAttributes("spanStyle").style;
  const headingLevel = editor?.isActive("heading") ? Number(editor.getAttributes("heading").level) : 0;
  const blockValue = headingLevel >= 2 && headingLevel <= 4 ? `h${headingLevel}` : "p";

  useEffect(() => {
    if (!editor) return;
    function bumpSelectionVersion() {
      setSelectionVersion((value) => value + 1);
    }
    editor.on("selectionUpdate", bumpSelectionVersion);
    editor.on("transaction", bumpSelectionVersion);
    return () => {
      editor.off("selectionUpdate", bumpSelectionVersion);
      editor.off("transaction", bumpSelectionVersion);
    };
  }, [editor]);

  useEffect(() => {
    if (!blocksMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof globalThis.Node && blocksMenuRef.current?.contains(target)) return;
      setBlocksMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setBlocksMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [blocksMenuOpen]);

  useEffect(() => {
    if (!tablePickerOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof globalThis.Node && tablePickerRef.current?.contains(target)) return;
      setTablePickerOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setTablePickerOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [tablePickerOpen]);

  function setBlockFormat(value: string) {
    if (!editor) return;
    if (value === "p") editor.chain().focus().setParagraph().run();
    if (value === "h2") editor.chain().focus().toggleHeading({ level: 2 }).run();
    if (value === "h3") editor.chain().focus().toggleHeading({ level: 3 }).run();
    if (value === "h4") editor.chain().focus().toggleHeading({ level: 4 }).run();
  }

  function insertHtmlBlockContent(html: string) {
    if (!editor) return false;
    editor.commands.focus();
    return editor.commands.insertHtmlBlock(html);
  }

  function insertCalloutBlock(type: string) {
    if (!editor) return;
    editor.commands.focus();
    editor.commands.insertCallout(type);
  }

  function insertManagedContentBlock(mode: ManagedContentBlockMode) {
    insertHtmlBlockContent(buildManagedContentBlockHtml(mode));
    setBlocksMenuOpen(false);
  }

  function insertColumnLayout(columns: 2 | 3) {
    if (!editor) return;
    editor.chain().focus().insertContent(buildColumnLayoutHtml(columns)).run();
    setBlocksMenuOpen(false);
  }

  function insertCtaButtonBlock() {
    if (!editor) return;
    const normalizedUrl = normalizeCtaUrl(ctaUrl);
    if (!normalizedUrl) {
      setCtaError("Enter a URL for the button.");
      return;
    }
    const trimmedLabel = ctaLabel.trim() || "Call to Action";
    insertHtmlBlockContent(buildCtaButtonHtml(normalizedUrl, trimmedLabel));
    setCtaUrl("");
    setCtaLabel("Call to Action");
    setCtaError(null);
    setCtaModalOpen(false);
    setBlocksMenuOpen(false);
  }

  function openCtaButtonModal() {
    setCtaUrl("");
    setCtaLabel("Call to Action");
    setCtaError(null);
    setCtaModalOpen(true);
    setBlocksMenuOpen(false);
  }

  function insertStyledTableBlock() {
    if (!editor) return;
    editor.chain().focus().insertContent(buildStyledTableHtml()).run();
    setBlocksMenuOpen(false);
  }

  function chooseTableSize(rows: number, cols: number) {
    insertTable(rows, cols);
    setTablePickerOpen(false);
    setTablePickerSize({ rows: 3, cols: 3 });
  }

  return (
    <>
    <div className="rounded-t-lg border border-outline-variant/30 bg-surface-container-lowest">
      <div className="grid items-stretch xl:grid-cols-[minmax(0,1fr)_minmax(0,270px)_minmax(0,180px)]">
        <ToolbarCluster label="Format">
          <ToolbarLevel className="gap-2">
            <select
              aria-label="Block format"
              value={blockValue}
              onChange={(event) => setBlockFormat(event.target.value)}
              className="h-8 w-36 rounded-md border border-outline-variant/50 bg-white px-2 text-sm text-on-surface"
            >
              <option value="p">Paragraph</option>
              <option value="h2">Heading 2</option>
              <option value="h3">Heading 3</option>
              <option value="h4">Heading 4</option>
            </select>
            <select
              aria-label="Font family"
              value={styleValue(spanStyle, "font-family")}
              onChange={(event) => updateInlineStyle(editor, "font-family", event.target.value)}
              className="h-8 w-24 rounded-md border border-outline-variant/50 bg-white px-2 text-sm text-on-surface transition-[width] focus:w-48"
            >
              <option value="">Font</option>
              <option value="Lato, sans-serif">Lato</option>
              <option value="Arial, sans-serif">Arial</option>
              <option value="Georgia, serif">Georgia</option>
              <option value="'Times New Roman', serif">Times New Roman</option>
              <option value="'Courier New', monospace">Courier</option>
              <option value="Verdana, sans-serif">Verdana</option>
            </select>
            <select
              aria-label="Font size"
              value={styleValue(spanStyle, "font-size")}
              onChange={(event) => updateInlineStyle(editor, "font-size", event.target.value)}
              className="h-8 w-20 rounded-md border border-outline-variant/50 bg-white px-2 text-sm text-on-surface"
            >
              <option value="">Size</option>
              {["12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px", "36px"].map((size) => (
                <option key={size} value={size}>{size.replace("px", "")}</option>
              ))}
            </select>
            <ToolbarDivider />
            <ToolbarButton label="Bold" active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={16} /></ToolbarButton>
            <ToolbarButton label="Italic" active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={16} /></ToolbarButton>
            <ToolbarButton label="Underline" active={editor?.isActive("underline")} onClick={() => editor?.chain().focus().toggleUnderline().run()}><UnderlineIcon size={16} /></ToolbarButton>
            <ToolbarButton label="Strikethrough" active={editor?.isActive("strike")} onClick={() => editor?.chain().focus().toggleStrike().run()}><Strikethrough size={16} /></ToolbarButton>
            <ToolbarButton label="Inline code" active={editor?.isActive("code")} onClick={() => editor?.chain().focus().toggleCode().run()}><Code2 size={16} /></ToolbarButton>
            <ToolbarButton label="Superscript" active={editor?.isActive("superscript")} onClick={() => editor?.chain().focus().toggleMark("superscript").run()}><Superscript size={16} /></ToolbarButton>
            <ToolbarButton label="Subscript" active={editor?.isActive("subscript")} onClick={() => editor?.chain().focus().toggleMark("subscript").run()}><Subscript size={16} /></ToolbarButton>
            <ToolbarDivider />
            <ToolbarButton label="Align left" active={editor?.isActive({ textAlign: "left" })} onClick={() => editor?.chain().focus().setTextAlign("left").run()}><AlignLeft size={16} /></ToolbarButton>
            <ToolbarButton label="Align center" active={editor?.isActive({ textAlign: "center" })} onClick={() => editor?.chain().focus().setTextAlign("center").run()}><AlignCenter size={16} /></ToolbarButton>
            <ToolbarButton label="Align right" active={editor?.isActive({ textAlign: "right" })} onClick={() => editor?.chain().focus().setTextAlign("right").run()}><AlignRight size={16} /></ToolbarButton>
            <ToolbarButton label="Justify" active={editor?.isActive({ textAlign: "justify" })} onClick={() => editor?.chain().focus().setTextAlign("justify").run()}><AlignJustify size={16} /></ToolbarButton>
            <ToolbarDivider />
            <span className="relative">
              <ToolbarButton label="Text color" onClick={() => setColorPicker((open) => open === "text" ? null : "text")}><Palette size={16} /></ToolbarButton>
              {colorPicker === "text" ? (
                <ColorSwatchPopover
                  colors={TEXT_COLORS}
                  onSelect={(color) => {
                    updateInlineStyle(editor, "color", color);
                    setColorPicker(null);
                  }}
                  onClear={() => {
                    updateInlineStyle(editor, "color", "");
                    setColorPicker(null);
                  }}
                />
              ) : null}
            </span>
            <span className="relative">
              <ToolbarButton label="Highlight" active={Boolean(styleValue(spanStyle, "background-color"))} onClick={() => setColorPicker((open) => open === "highlight" ? null : "highlight")}><Highlighter size={16} /></ToolbarButton>
              {colorPicker === "highlight" ? (
                <ColorSwatchPopover
                  colors={HIGHLIGHT_COLORS}
                  columns={4}
                  onSelect={(color) => {
                    updateInlineStyle(editor, "background-color", color);
                    setColorPicker(null);
                  }}
                  onClear={() => {
                    updateInlineStyle(editor, "background-color", "");
                    setColorPicker(null);
                  }}
                />
              ) : null}
            </span>
            <span className="relative">
              <ToolbarButton label="Pill badge" onClick={() => setColorPicker((open) => open === "pill" ? null : "pill")}><span className="rounded-full bg-surface-container-high px-2 text-[10px] font-black">PILL</span></ToolbarButton>
              {colorPicker === "pill" ? (
                <div
                  className="absolute left-0 top-10 z-[75] w-44 rounded-xl border border-outline-variant/40 bg-white p-3 shadow-2xl"
                  onMouseDown={(event) => event.preventDefault()}
                >
                  <div className="grid grid-cols-4 gap-2">
                    {PILL_COLORS.map((color) => (
                      <button
                        key={color.value}
                        type="button"
                        title={color.label}
                        aria-label={color.label}
                        onClick={() => {
                          applyPillStyle(editor, color.value);
                          setColorPicker(null);
                        }}
                        className="h-7 w-7 rounded-full border border-outline-variant/50 transition-transform hover:scale-110"
                        style={{ backgroundColor: color.value }}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      editor?.chain().focus().unsetMark("spanStyle").run();
                      setColorPicker(null);
                    }}
                    className="mt-2 w-full rounded-md bg-surface-container-low px-2 py-1 text-left text-xs font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high"
                  >
                    Remove pill
                  </button>
                </div>
              ) : null}
            </span>
            <ToolbarDivider />
            <ToolbarButton label="Bullet list" active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={16} /></ToolbarButton>
            <ToolbarButton label="Numbered list" active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></ToolbarButton>
            <ToolbarButton label="Decrease indent" onClick={() => updateBlockIndent(editor, -1)}><IndentDecrease size={16} /></ToolbarButton>
            <ToolbarButton label="Increase indent" onClick={() => updateBlockIndent(editor, 1)}><IndentIncrease size={16} /></ToolbarButton>
            <ToolbarButton label="Blockquote" active={editor?.isActive("blockquote")} onClick={() => editor?.chain().focus().toggleBlockquote().run()}><Quote size={16} /></ToolbarButton>
            <ToolbarButton label="Clear formatting" onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}><Eraser size={16} /></ToolbarButton>
          </ToolbarLevel>
        </ToolbarCluster>

        <ToolbarCluster label="Insert">
          <ToolbarLevel className="gap-2">
            <ToolbarButton label="Link" active={editor?.isActive("link")} onClick={setLink}><LinkIcon size={16} /></ToolbarButton>
            <span ref={tablePickerRef} className="relative">
              <ToolbarButton label="Table" onClick={() => setTablePickerOpen((open) => !open)}><Table2 size={16} /></ToolbarButton>
              {tablePickerOpen ? (
                <div
                  className="absolute left-0 top-10 z-[75] w-64 rounded-xl border border-outline-variant/40 bg-white p-3 shadow-2xl"
                  onMouseDown={(event) => event.preventDefault()}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Table size</span>
                    <span className="text-xs font-semibold text-on-surface">{tablePickerSize.rows} × {tablePickerSize.cols}</span>
                  </div>
                  <div className="grid grid-cols-8 gap-1">
                    {Array.from({ length: 64 }, (_, index) => {
                      const row = Math.floor(index / 8) + 1;
                      const col = (index % 8) + 1;
                      const active = row <= tablePickerSize.rows && col <= tablePickerSize.cols;
                      return (
                        <button
                          key={`${row}-${col}`}
                          type="button"
                          aria-label={`Insert ${row} by ${col} table`}
                          onMouseEnter={() => setTablePickerSize({ rows: row, cols: col })}
                          onFocus={() => setTablePickerSize({ rows: row, cols: col })}
                          onClick={() => chooseTableSize(row, col)}
                          className={`h-5 w-5 rounded-sm border transition-colors ${
                            active
                              ? "border-primary bg-secondary-container"
                              : "border-outline-variant/60 bg-surface-container-lowest hover:bg-surface-container-high"
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </span>
            <ToolbarButton label="Upload image" disabled={uploadingImage} onClick={uploadImage}>{uploadingImage ? "..." : <ImageIcon size={16} />}</ToolbarButton>
            <ToolbarButton label="Upload file" disabled={uploadingFile} onClick={uploadFile}>{uploadingFile ? "..." : <FileUp size={16} />}</ToolbarButton>
            <ToolbarButton label="Embed video" onClick={openVideoEmbedInsert}><span className="text-[11px] leading-none">▶</span></ToolbarButton>
            <ToolbarButton label="Embed HTML / iframe" onClick={openHtmlBlockInsert}><span className="font-mono text-[12px] leading-none">&lt;/&gt;</span></ToolbarButton>
            <ToolbarButton label="LaTeX equation" onClick={openLatexInsert}><span className="font-serif text-base leading-none">Σ</span></ToolbarButton>
            <ToolbarDivider />
            <span ref={blocksMenuRef} className="relative">
              <button
                type="button"
                title="Content blocks"
                aria-label="Content blocks"
                aria-expanded={blocksMenuOpen}
                onClick={() => setBlocksMenuOpen((open) => !open)}
                className="flex h-8 items-center justify-center gap-1 rounded-md px-2 text-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <PanelTopOpen size={16} />
                Blocks
                <ChevronDown size={14} />
              </button>
              {blocksMenuOpen ? (
                <div
                  className="absolute right-0 top-10 z-[75] max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-outline-variant/40 bg-white p-2 shadow-2xl"
                  onMouseDown={(event) => event.preventDefault()}
                >
                  <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-variant">Separators</p>
                  <ToolbarDropdownItem
                    icon={<Minus size={16} />}
                    onClick={() => {
                      insertStyledSeparator("thin");
                      setBlocksMenuOpen(false);
                    }}
                  >
                    Thin separator
                  </ToolbarDropdownItem>
                  <ToolbarDropdownItem
                    icon={<span className="text-xs leading-none">---</span>}
                    onClick={() => {
                      insertStyledSeparator("dashed");
                      setBlocksMenuOpen(false);
                    }}
                  >
                    Dashed separator
                  </ToolbarDropdownItem>
                  <ToolbarDropdownItem
                    icon={<span className="text-[11px] leading-none">ASU</span>}
                    onClick={() => {
                      insertStyledSeparator("gradient");
                      setBlocksMenuOpen(false);
                    }}
                  >
                    Gradient separator
                  </ToolbarDropdownItem>
                  <div className="my-1 h-px bg-outline-variant/40" aria-hidden="true" />
                  <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-variant">Layouts</p>
                  <ToolbarDropdownItem
                    icon={<span className="text-xs leading-none">2</span>}
                    onClick={() => insertColumnLayout(2)}
                  >
                    2-Column Layout
                  </ToolbarDropdownItem>
                  <ToolbarDropdownItem
                    icon={<span className="text-xs leading-none">3</span>}
                    onClick={() => insertColumnLayout(3)}
                  >
                    3-Column Layout
                  </ToolbarDropdownItem>
                  <ToolbarDropdownItem
                    icon={<Table2 size={16} />}
                    onClick={insertStyledTableBlock}
                  >
                    Styled Table
                  </ToolbarDropdownItem>
                  <div className="my-1 h-px bg-outline-variant/40" aria-hidden="true" />
                  <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-variant">Blocks</p>
                  <ToolbarDropdownItem
                    icon={<PanelTopOpen size={16} />}
                    onClick={() => {
                      insertAccordion();
                      setBlocksMenuOpen(false);
                    }}
                  >
                    Accordion
                  </ToolbarDropdownItem>
                  <ToolbarDropdownItem
                    icon={<PanelTopOpen size={16} />}
                    onClick={() => insertManagedContentBlock("moduleHeader")}
                  >
                    Module Header
                  </ToolbarDropdownItem>
                  <ToolbarDropdownItem
                    icon={<Quote size={16} />}
                    onClick={() => insertManagedContentBlock("pullQuote")}
                  >
                    Pull Quote
                  </ToolbarDropdownItem>
                  <ToolbarDropdownItem
                    icon={<ListOrdered size={16} />}
                    onClick={() => insertManagedContentBlock("stepIndicator")}
                  >
                    Step Indicator
                  </ToolbarDropdownItem>
                  <ToolbarDropdownItem
                    icon={<span className="text-[10px] leading-none">CTA</span>}
                    onClick={openCtaButtonModal}
                  >
                    CTA Button
                  </ToolbarDropdownItem>
                  <ToolbarDropdownItem
                    icon={<ImageIcon size={16} />}
                    onClick={() => {
                      uploadImage("imageText");
                      setBlocksMenuOpen(false);
                    }}
                  >
                    Image + Text
                  </ToolbarDropdownItem>
                  <ToolbarDropdownItem
                    icon={<ImageIcon size={16} />}
                    onClick={() => {
                      uploadImage("fullWidthImage");
                      setBlocksMenuOpen(false);
                    }}
                  >
                    Full Width Image
                  </ToolbarDropdownItem>
                  <ToolbarDropdownItem
                    icon={<ImageIcon size={16} />}
                    onClick={() => {
                      uploadImage("imageCard");
                      setBlocksMenuOpen(false);
                    }}
                  >
                    Image Card
                  </ToolbarDropdownItem>
                  <ToolbarDropdownItem
                    icon={<ImageIcon size={16} />}
                    onClick={() => {
                      uploadImage("profileCard");
                      setBlocksMenuOpen(false);
                    }}
                  >
                    Profile Card
                  </ToolbarDropdownItem>
                  <ToolbarDropdownItem
                    icon={<Quote size={16} />}
                    onClick={() => {
                      uploadImage("testimonial");
                      setBlocksMenuOpen(false);
                    }}
                  >
                    Testimonial
                  </ToolbarDropdownItem>
                  <ToolbarDropdownItem
                    icon={<Info size={16} />}
                    onClick={() => {
                      insertCalloutBlock("info");
                      setBlocksMenuOpen(false);
                    }}
                  >
                    Info callout
                  </ToolbarDropdownItem>
                  <ToolbarDropdownItem
                    icon={<AlertTriangle size={16} />}
                    onClick={() => {
                      insertCalloutBlock("warning");
                      setBlocksMenuOpen(false);
                    }}
                  >
                    Warning callout
                  </ToolbarDropdownItem>
                  <ToolbarDropdownItem
                    icon={<Lightbulb size={16} />}
                    onClick={() => {
                      insertCalloutBlock("tip");
                      setBlocksMenuOpen(false);
                    }}
                  >
                    Tip callout
                  </ToolbarDropdownItem>
                  <ToolbarDropdownItem
                    icon={<StickyNote size={16} />}
                    onClick={() => {
                      insertCalloutBlock("note");
                      setBlocksMenuOpen(false);
                    }}
                  >
                    Note callout
                  </ToolbarDropdownItem>
                </div>
              ) : null}
            </span>
          </ToolbarLevel>
        </ToolbarCluster>

        <ToolbarCluster label="Tools">
          <ToolbarLevel>
            <ToolbarButton label="Undo" disabled={!editor || !editor.can().chain().focus().undo().run()} onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={16} /></ToolbarButton>
            <ToolbarButton label="Redo" disabled={!editor || !editor.can().chain().focus().redo().run()} onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={16} /></ToolbarButton>
            <ToolbarButton label="Find and replace" onClick={openFindReplace}><Search size={16} /></ToolbarButton>
            <ToolbarButton label="AI content generator" onClick={openAIGenerate}><Sparkles size={16} /></ToolbarButton>
            <ToolbarButton label="Accessibility check" onClick={openAccessibilityCheck}><AlertTriangle size={16} /></ToolbarButton>
          </ToolbarLevel>
          <ToolbarLevel>
            {(["rich", "html"] as const).map((option) => (
              <button
                key={option}
                type="button"
                title={option === "rich" ? "Rich text editor" : "Edit HTML source"}
                onClick={() => switchEditorMode(option)}
                className={`h-8 rounded-md px-2 text-sm font-semibold transition-colors ${
                  editorMode === option
                    ? "bg-secondary-container text-on-secondary-container"
                    : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                }`}
              >
                {option === "rich" ? <Text size={16} /> : <Terminal size={16} />}
              </button>
            ))}
          </ToolbarLevel>
          {editorMode === "html" ? (
            <ToolbarLevel>
              {(["edit", "split"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setMode(option)}
                  className={`h-8 rounded-md px-2 text-xs font-semibold transition-colors ${
                    mode === option
                      ? "bg-primary text-on-primary"
                      : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  }`}
                >
                  {option === "split" ? "Split" : "HTML Only"}
                </button>
              ))}
            </ToolbarLevel>
          ) : null}
        </ToolbarCluster>
      </div>
    </div>
    {ctaModalOpen ? (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-on-surface/50 px-4 py-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cta-button-title"
          className="w-full max-w-md overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4 border-b border-outline-variant/30 px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Insert</p>
              <h2 id="cta-button-title" className="mt-1 font-headline text-xl font-bold text-on-surface">
                CTA Button
              </h2>
            </div>
            <button
              type="button"
              title="Close"
              onClick={() => setCtaModalOpen(false)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant transition-colors hover:bg-surface-container-high"
            >
              <X size={16} />
            </button>
          </div>
          <div className="space-y-4 px-5 py-4">
            {ctaError ? (
              <div className="rounded-xl border border-error/30 bg-error-container px-4 py-3 text-sm font-semibold text-error">
                {ctaError}
              </div>
            ) : null}
            <label className="block text-sm font-semibold text-on-surface">
              Button text
              <input
                type="text"
                value={ctaLabel}
                onChange={(event) => setCtaLabel(event.target.value)}
                className="mt-2 h-10 w-full rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm font-normal text-on-surface outline-none focus:border-primary"
                autoFocus
              />
            </label>
            <label className="block text-sm font-semibold text-on-surface">
              URL
              <input
                type="text"
                value={ctaUrl}
                onChange={(event) => {
                  setCtaUrl(event.target.value);
                  setCtaError(null);
                }}
                placeholder="https://example.edu"
                className="mt-2 h-10 w-full rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm font-normal text-on-surface outline-none focus:border-primary"
              />
            </label>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-outline-variant/30 px-5 py-4">
            <button
              type="button"
              onClick={() => setCtaModalOpen(false)}
              className="rounded-lg bg-surface-container-low px-3 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={insertCtaButtonBlock}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container"
            >
              Insert Button
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}

export default function ContentEditorWorkspace({
  sessionId,
  item,
  initialTitle,
  initialHtml,
  initialPlainText,
  baseHref,
  pendingModuleRemoval = false,
  pendingModuleDeletion = false,
  pendingModuleRemovalLabel,
  removalRedirectHref,
}: {
  sessionId: string;
  item: ContentEditorItem;
  initialTitle: string;
  initialHtml: string;
  initialPlainText: string;
  baseHref: string;
  pendingModuleRemoval?: boolean;
  pendingModuleDeletion?: boolean;
  pendingModuleRemovalLabel?: string;
  removalRedirectHref?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [savedTitle, setSavedTitle] = useState(initialTitle);
  const [savedHtml, setSavedHtml] = useState(initialHtml);
  const [currentHtml, setCurrentHtml] = useState(initialHtml);
  const [canvasUrl, setCanvasUrl] = useState(item.canvas_url);
  const [mode, setMode] = useState<"preview" | "edit" | "split">("preview");
  const [editorMode, setEditorMode] = useState<"rich" | "html">("rich");
  const [changeSummary, setChangeSummary] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [expandedEditor, setExpandedEditor] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [aiGenerateModalOpen, setAiGenerateModalOpen] = useState(false);
  const [accessibilityCheckOpen, setAccessibilityCheckOpen] = useState(false);
  const [identifyIssueOpen, setIdentifyIssueOpen] = useState(false);
  const [identifyIssueMode, setIdentifyIssueMode] = useState<"replace" | "flag">("replace");
  const [identifyIssueTab, setIdentifyIssueTab] = useState<"revisions" | "source">("revisions");
  const [identifyIssueMessage, setIdentifyIssueMessage] = useState<string | null>(null);
  const [flagIssueNote, setFlagIssueNote] = useState("");
  const [flagIssueSaving, setFlagIssueSaving] = useState(false);
  const [canvasRevisions, setCanvasRevisions] = useState<CanvasRevisionRow[]>([]);
  const [canvasRevisionsLoading, setCanvasRevisionsLoading] = useState(false);
  const [canvasRevisionsLoaded, setCanvasRevisionsLoaded] = useState(false);
  const [selectedCanvasRevisionId, setSelectedCanvasRevisionId] = useState<number | null>(null);
  const [canvasRevisionPreview, setCanvasRevisionPreview] = useState<CanvasRevisionPreview | null>(null);
  const [canvasRevisionPreviewLoading, setCanvasRevisionPreviewLoading] = useState(false);
  const [canvasRevisionRestoring, setCanvasRevisionRestoring] = useState(false);
  const [sourceCourseQuery, setSourceCourseQuery] = useState("");
  const [sourceCourses, setSourceCourses] = useState<SourceCourse[]>([]);
  const [sourceCoursesCursor, setSourceCoursesCursor] = useState<string | null>(null);
  const [sourceCoursesLoading, setSourceCoursesLoading] = useState(false);
  const [selectedSourceCourse, setSelectedSourceCourse] = useState<SourceCourse | null>(null);
  const [sourcePageMatches, setSourcePageMatches] = useState<SourcePageMatch[]>([]);
  const [sourcePagesLoading, setSourcePagesLoading] = useState(false);
  const [selectedSourcePage, setSelectedSourcePage] = useState<SourcePageMatch | null>(null);
  const [sourcePagePreview, setSourcePagePreview] = useState<SourcePagePreview | null>(null);
  const [sourcePagePreviewLoading, setSourcePagePreviewLoading] = useState(false);
  const [sourcePageReplacing, setSourcePageReplacing] = useState(false);
  const [aiGeneratePrompt, setAiGeneratePrompt] = useState("");
  const [aiGenerateContext, setAiGenerateContext] = useState("");
  const [aiGeneratePreview, setAiGeneratePreview] = useState("");
  const [aiGenerateLoading, setAiGenerateLoading] = useState(false);
  const [aiGenerateError, setAiGenerateError] = useState<string | null>(null);
  const [findQuery, setFindQuery] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [activeFindIndex, setActiveFindIndex] = useState(0);
  const [richFindMatchCount, setRichFindMatchCount] = useState(0);
  const [slashMenu, setSlashMenu] = useState<{ open: boolean; x: number; y: number } | null>(null);
  const [tableContextMenu, setTableContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [htmlBlockModalOpen, setHtmlBlockModalOpen] = useState(false);
  const [htmlBlockDraft, setHtmlBlockDraft] = useState("");
  const [htmlBlockModalMode, setHtmlBlockModalMode] = useState<"insert" | "edit">("insert");
  const [videoEmbedModalOpen, setVideoEmbedModalOpen] = useState(false);
  const [videoEmbedUrl, setVideoEmbedUrl] = useState("");
  const [videoEmbedError, setVideoEmbedError] = useState<string | null>(null);
  const [latexModalOpen, setLatexModalOpen] = useState(false);
  const [latexModalMode, setLatexModalMode] = useState<"insert" | "edit">("insert");
  const [latexDraft, setLatexDraft] = useState("");
  const [latexDisplayMode, setLatexDisplayMode] = useState(true);
  const [latexError, setLatexError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [imageReview, setImageReview] = useState<EditorImageReviewState | null>(null);
  const [imageReviewAlt, setImageReviewAlt] = useState("");
  const [imageReviewLongDescription, setImageReviewLongDescription] = useState("");
  const [imageReviewDecorative, setImageReviewDecorative] = useState(false);
  const [imageReviewSaving, setImageReviewSaving] = useState(false);
  const [imageReviewGenerating, setImageReviewGenerating] = useState<"alt" | "long_desc" | "both" | null>(null);
  const [imageReviewError, setImageReviewError] = useState<string | null>(null);
  const [restoringRevisionId, setRestoringRevisionId] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<RevisionRow[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(true);
  const [pendingChanges, setPendingChanges] = useState<PendingChangesResponse | null>(null);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [diffExpanded, setDiffExpanded] = useState(false);
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const [pendingDiff, setPendingDiff] = useState<PendingDiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [moduleOperationBusyId, setModuleOperationBusyId] = useState<string | null>(null);
  const [applyingModuleOperations, setApplyingModuleOperations] = useState(false);
  const [batchPushing, setBatchPushing] = useState(false);
  const [batchPushState, setBatchPushState] = useState<Record<string, BatchPushState>>({});
  const [selectedContentPushIds, setSelectedContentPushIds] = useState<Set<string>>(new Set());
  const [pushHistory, setPushHistory] = useState<PushHistoryItem[]>([]);
  const [pushHistoryLoading, setPushHistoryLoading] = useState(true);
  const [pushHistoryError, setPushHistoryError] = useState<string | null>(null);
  const [moduleApplyHistory, setModuleApplyHistory] = useState<ModuleApplyHistoryItem[]>([]);
  const [moduleApplyHistoryLoading, setModuleApplyHistoryLoading] = useState(true);
  const [moduleApplyHistoryError, setModuleApplyHistoryError] = useState<string | null>(null);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const reviewTriggerRef = useRef<HTMLButtonElement>(null);
  const reviewDialogRef = useRef<HTMLDivElement>(null);
  const reviewCloseRef = useRef<HTMLButtonElement>(null);
  const imageUploadInputRef = useRef<HTMLInputElement>(null);
  const fileUploadInputRef = useRef<HTMLInputElement>(null);
  const pendingImageInsertModeRef = useRef<ManagedImageInsertMode>("image");
  const pendingFileLinkSelectionRef = useRef<{ from: number; to: number; text: string } | null>(null);
  const pendingHtmlBlockUpdateRef = useRef<HtmlBlockEditRequest["update"] | null>(null);
  const pendingLatexBlockUpdateRef = useRef<LatexBlockEditRequest["update"] | null>(null);
  const htmlTextareaRef = useRef<HTMLTextAreaElement>(null);
  const latexTextareaRef = useRef<HTMLTextAreaElement>(null);
  const richEditorWrapperRef = useRef<HTMLDivElement>(null);
  const tableContextMenuRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: false,
        underline: false,
      }),
      Underline,
      CanvasLink.configure({ openOnClick: false, autolink: true }),
      PreserveStyles,
      HtmlBlock,
      SpanStyle,
      SubscriptMark,
      SuperscriptMark,
      CanvasDiv,
      CanvasAnchor,
      CalloutBlock,
      AccordionSummary,
      AccordionContent,
      AccordionBlock,
      StyledSeparator,
      ResizableCanvasImage,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      CanvasTable.configure({ resizable: true }),
      TableRow,
      CanvasTableHeader,
      CanvasTableCell,
    ],
    content: initialHtml,
    onUpdate: ({ editor: nextEditor }) => {
      setCurrentHtml(serializeHtmlBlocks(nextEditor.getHTML()));
    },
    editorProps: {
      attributes: {
        class:
          "min-h-[420px] rounded-2xl border border-outline-variant/40 bg-white px-5 py-4 text-[15px] leading-7 text-on-surface focus:outline-none",
      },
      handleKeyDown: (view, event) => {
        if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return false;
        const { $from } = view.state.selection;
        const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
        if (textBefore === "/") {
          setSlashMenu(null);
          event.preventDefault();
          return true;
        }
        if (textBefore.trim()) return false;
        const coords = view.coordsAtPos(view.state.selection.from);
        window.setTimeout(() => {
          setSlashMenu({ open: true, x: coords.left, y: coords.bottom + 6 });
        }, 0);
        return false;
      },
      handleDOMEvents: {
        contextmenu: (view, event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return false;
          if (!target.closest("table")) return false;
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (pos) {
            view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(pos.pos))));
          }
          event.preventDefault();
          setTableContextMenu(tableContextMenuPosition(event.clientX, event.clientY));
          return true;
        },
      },
    },
  });

  useEffect(() => {
    if (!expandedEditor) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setExpandedEditor(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [expandedEditor]);

  useEffect(() => {
    if (!tableContextMenu) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof globalThis.Node && tableContextMenuRef.current?.contains(target)) return;
      setTableContextMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setTableContextMenu(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [tableContextMenu]);

  useEffect(() => {
    function handleEditHtmlBlock(event: Event) {
      const detail = (event as CustomEvent<HtmlBlockEditRequest>).detail;
      if (!detail?.update) return;
      pendingHtmlBlockUpdateRef.current = detail.update;
      setHtmlBlockModalMode("edit");
      setHtmlBlockDraft(detail.content || "");
      setHtmlBlockModalOpen(true);
    }

    window.addEventListener("canvascurate:edit-html-block", handleEditHtmlBlock);
    return () => window.removeEventListener("canvascurate:edit-html-block", handleEditHtmlBlock);
  }, []);

  useEffect(() => {
    function handleEditLatexBlock(event: Event) {
      const detail = (event as CustomEvent<LatexBlockEditRequest>).detail;
      if (!detail?.update) return;
      pendingLatexBlockUpdateRef.current = detail.update;
      setLatexModalMode("edit");
      setLatexDraft(detail.latex || "");
      setLatexDisplayMode(detail.displayMode);
      setLatexError(null);
      setLatexModalOpen(true);
    }

    window.addEventListener("canvascurate:edit-latex-block", handleEditLatexBlock);
    return () => window.removeEventListener("canvascurate:edit-latex-block", handleEditLatexBlock);
  }, []);

  const selectedPendingChange = pendingChanges?.content_changes.find((change) => change.content_item_id === item.id);
  const isDirty = title.trim() !== savedTitle.trim() || currentHtml !== savedHtml;
  const htmlFindMatches = useMemo(
    () => (editorMode === "html" ? findStringMatches(currentHtml, findQuery, findCaseSensitive) : []),
    [currentHtml, editorMode, findCaseSensitive, findQuery],
  );
  const findMatchCount = editorMode === "rich" ? richFindMatchCount : htmlFindMatches.length;

  const closePendingReview = useCallback(() => {
    setReviewExpanded(false);
    setDiffExpanded(false);
    window.setTimeout(() => reviewTriggerRef.current?.focus(), 0);
  }, []);

  const selectFindMatch = useCallback(
    (index: number) => {
      if (editorMode === "rich") {
        const ranges = collectFindRanges(richEditorWrapperRef.current ?? editor?.view.dom ?? document.body, findQuery, findCaseSensitive);
        const range = ranges[index];
        const element = range?.startContainer.parentElement;
        element?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      const match = htmlFindMatches[index];
      if (!match) return;
      const textarea = htmlTextareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(match.from, match.to);
      textarea.scrollIntoView({ block: "nearest" });
    },
    [editor, editorMode, findCaseSensitive, findQuery, htmlFindMatches],
  );

  useEffect(() => {
    setActiveFindIndex(0);
  }, [editorMode, findCaseSensitive, findQuery]);

  useEffect(() => {
    if (editorMode !== "rich") {
      setRichFindMatchCount(0);
      clearFindHighlights();
      return;
    }
    if (!findReplaceOpen || !findQuery.trim()) {
      setRichFindMatchCount(0);
      clearFindHighlights();
      return;
    }
    const root = richEditorWrapperRef.current ?? editor?.view.dom;
    const ranges = root ? collectFindRanges(root, findQuery, findCaseSensitive) : [];
    const fallbackCount = ranges.length ? ranges.length : countEditorDocumentMatches(editor, findQuery, findCaseSensitive);
    setRichFindMatchCount(fallbackCount);

    if (!root || typeof Highlight === "undefined" || typeof CSS === "undefined" || !("highlights" in CSS)) {
      clearFindHighlights();
      return;
    }
    ensureFindHighlightStyles();
    const activeRange = ranges[Math.min(activeFindIndex, Math.max(ranges.length - 1, 0))];
    const highlights = (CSS as typeof CSS & { highlights: HighlightRegistry }).highlights;
    highlights.set("canvas-curate-find-match", new Highlight(...ranges));
    highlights.set("canvas-curate-find-active", activeRange ? new Highlight(activeRange) : new Highlight());
    return clearFindHighlights;
  }, [activeFindIndex, currentHtml, editor, editorMode, findCaseSensitive, findQuery, findReplaceOpen]);

  useEffect(() => {
    if (!findReplaceOpen || findMatchCount === 0) return;
    if (activeFindIndex >= findMatchCount) {
      setActiveFindIndex(findMatchCount - 1);
    }
  }, [activeFindIndex, findMatchCount, findReplaceOpen]);

  useEffect(() => {
    if (!reviewExpanded) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => reviewCloseRef.current?.focus(), 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePendingReview();
        return;
      }

      if (event.key !== "Tab" || !reviewDialogRef.current) return;
      const focusable = Array.from(
        reviewDialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("disabled") && element.offsetParent !== null);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closePendingReview, reviewExpanded]);

  const loadPendingChanges = useCallback(async () => {
    setPendingLoading(true);
    try {
      const token = await getAccessToken();
      const data = await fetchJson<PendingChangesResponse>(
        `/canvas/sessions/${sessionId}/pending-changes`,
        token,
        "Failed to load pending changes",
      );
      setPendingChanges(data);
      setSelectedContentPushIds((current) => {
        const availableIds = new Set(data.content_changes.map((change) => change.content_item_id));
        const next = new Set(Array.from(current).filter((id) => availableIds.has(id)));
        return next.size === current.size ? current : next;
      });
      if (!data.content_changes.some((change) => change.content_item_id === item.id)) {
        setDiffExpanded(false);
        setPendingDiff(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load pending changes");
    } finally {
      setPendingLoading(false);
    }
  }, [item.id, sessionId]);

  const loadPushHistory = useCallback(async () => {
    setPushHistoryLoading(true);
    setPushHistoryError(null);
    try {
      const token = await getAccessToken();
      const data = await fetchJson<{ items: PushHistoryItem[] }>(
        `/canvas/sessions/${sessionId}/push-history?limit=8`,
        token,
        "Failed to load push history",
      );
      setPushHistory(data.items);
    } catch (error) {
      setPushHistory([]);
      setPushHistoryError(error instanceof Error ? error.message : "Failed to load push history");
    } finally {
      setPushHistoryLoading(false);
    }
  }, [sessionId]);

  const loadModuleApplyHistory = useCallback(async () => {
    setModuleApplyHistoryLoading(true);
    setModuleApplyHistoryError(null);
    try {
      const token = await getAccessToken();
      const data = await fetchJson<{ items: ModuleApplyHistoryItem[] }>(
        `/canvas/sessions/${sessionId}/module-apply-history?limit=8`,
        token,
        "Failed to load module update history",
      );
      setModuleApplyHistory(data.items);
    } catch (error) {
      setModuleApplyHistory([]);
      setModuleApplyHistoryError(error instanceof Error ? error.message : "Failed to load module update history");
    } finally {
      setModuleApplyHistoryLoading(false);
    }
  }, [sessionId]);

  async function refreshPendingReview() {
    await Promise.all([
      loadPendingChanges(),
      loadPushHistory(),
      loadModuleApplyHistory(),
    ]);
  }

  async function togglePendingDiff() {
    if (diffExpanded) {
      setDiffExpanded(false);
      return;
    }
    if (!selectedPendingChange?.has_changes) return;
    setDiffExpanded(true);
    if (pendingDiff?.content_item_id === item.id) return;

    setDiffLoading(true);
    try {
      const token = await getAccessToken();
      const data = await fetchJson<PendingDiffResponse>(
        `/canvas/sessions/${sessionId}/content/${item.id}/pending-diff`,
        token,
        "Failed to load pending diff",
      );
      setPendingDiff(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load pending diff");
      setDiffExpanded(false);
    } finally {
      setDiffLoading(false);
    }
  }

  async function discardModuleOperation(operationId: string) {
    setModuleOperationBusyId(operationId);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/module-operations/${operationId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to discard module operation"));
      }
      window.dispatchEvent(new CustomEvent("canvascurate:module-operation-deleted", { detail: { operationId } }));
      await loadPendingChanges();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to discard module operation");
    } finally {
      setModuleOperationBusyId(null);
    }
  }

  async function discardAllModuleOperations() {
    setModuleOperationBusyId("all");
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/module-operations`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to discard module operations"));
      }
      window.dispatchEvent(new CustomEvent("canvascurate:module-operation-deleted", { detail: { all: true } }));
      await loadPendingChanges();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to discard module operations");
    } finally {
      setModuleOperationBusyId(null);
    }
  }

  async function applyModuleOperations(operationIds?: string[]) {
    const moduleChanges = pendingChanges?.module_changes ?? [];
    const targetChanges = operationIds?.length
      ? moduleChanges.filter((change) => operationIds.includes(change.id))
      : moduleChanges;
    if (!targetChanges.length || applyingModuleOperations) return;
    const selectedRemovalOperationIds = new Set(
      targetChanges
        .filter((change) => change.operation_type === "item_remove" && change.content_item_id === item.id)
        .map((change) => change.id),
    );

    if (operationIds?.length === 1) {
      setModuleOperationBusyId(`apply:${operationIds[0]}`);
    } else {
      setApplyingModuleOperations(true);
    }
    setReviewMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/module-operations/apply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          operation_ids: targetChanges.map((change) => change.id),
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to apply module operations"));
      }

      const data = await res.json() as {
        applied: Array<{ id: string; module_item_id?: string; module_id?: string; operation_type: string; after_state: Record<string, unknown> }>;
        counts: { applied: number; failed: number; total: number };
      };
      window.dispatchEvent(new CustomEvent("canvascurate:module-operations-applied", { detail: { applied: data.applied } }));
      window.dispatchEvent(new CustomEvent("canvascurate:module-operation-deleted", { detail: { all: true } }));
      await loadPendingChanges();
      await loadModuleApplyHistory();
      const selectedModuleDeleted = pendingModuleDeletion && data.applied.some((operation) => operation.operation_type === "module_delete");
      if ((data.applied.some((operation) => selectedRemovalOperationIds.has(operation.id)) || selectedModuleDeleted) && removalRedirectHref) {
        router.push(removalRedirectHref);
      } else {
        router.refresh();
      }
      setReviewMessage(
        data.counts.failed
          ? `Applied ${data.counts.applied} module operation${data.counts.applied === 1 ? "" : "s"}; ${data.counts.failed} failed.`
          : `Applied ${data.counts.applied} module operation${data.counts.applied === 1 ? "" : "s"} to Canvas.`,
      );
    } catch (error) {
      setReviewMessage(error instanceof Error ? error.message : "Failed to apply module operations");
    } finally {
      if (operationIds?.length === 1) {
        setModuleOperationBusyId(null);
      } else {
        setApplyingModuleOperations(false);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadRevisions() {
      setRevisionsLoading(true);
      try {
        const token = await getAccessToken();
        const data = await fetchJson<{ items: RevisionRow[] }>(
          `/canvas/sessions/${sessionId}/content/${item.id}/revisions`,
          token,
          "Failed to load revisions",
        );
        if (!cancelled) {
          setRevisions(data.items);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Failed to load revisions");
        }
      } finally {
        if (!cancelled) {
          setRevisionsLoading(false);
        }
      }
    }

    void loadRevisions();
    void loadPushHistory();
    void loadModuleApplyHistory();
    const pendingTimer = window.setTimeout(() => {
      void loadPendingChanges();
    }, 0);
    function handlePendingChangesUpdated() {
      void loadPendingChanges();
    }
    window.addEventListener("canvascurate:pending-changes-updated", handlePendingChangesUpdated);
    return () => {
      cancelled = true;
      window.clearTimeout(pendingTimer);
      window.removeEventListener("canvascurate:pending-changes-updated", handlePendingChangesUpdated);
    };
  }, [item.id, loadModuleApplyHistory, loadPendingChanges, loadPushHistory, sessionId]);

  useEffect(() => {
    if (!identifyIssueOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeIdentifyIssueModal();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [identifyIssueOpen]);

  useEffect(() => {
    if (!identifyIssueOpen || identifyIssueMode !== "replace" || identifyIssueTab !== "revisions") return;
    if (canvasRevisionsLoaded || canvasRevisionsLoading) return;
    void loadCanvasRevisions();
  }, [canvasRevisionsLoaded, canvasRevisionsLoading, identifyIssueMode, identifyIssueOpen, identifyIssueTab]);

  const previewSrcDoc = useMemo(
    () => previewDocument(currentHtml, initialPlainText, baseHref),
    [baseHref, currentHtml, initialPlainText],
  );

  async function saveChanges() {
    if (!editor && editorMode === "rich") return;

    setSaving(true);
    setMessage(null);

    try {
      const token = await getAccessToken();
      const htmlBody = editorMode === "html" ? currentHtml : serializeHtmlBlocks(editor?.getHTML() ?? currentHtml);
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${item.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title,
          html_body: htmlBody,
          change_summary: changeSummary,
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to save content"));
      }

      const data = await res.json() as SaveResponse;
      setSavedTitle(data.title ?? "");
      setSavedHtml(data.html_body ?? "");
      setTitle(data.title ?? "");
      setCurrentHtml(data.html_body ?? "");
      if (editor) {
        editor.commands.setContent(data.html_body ?? "", { emitUpdate: false });
      }
      setChangeSummary("");
      setMessage(data.saved === false ? "No content changes to save." : `Saved${data.revision_number ? ` as revision ${data.revision_number}` : ""}.`);

      const revisionData = await fetchJson<{ items: RevisionRow[] }>(
        `/canvas/sessions/${sessionId}/content/${item.id}/revisions`,
        token,
        "Failed to load revisions",
      );
      setRevisions(revisionData.items);
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
      void loadPendingChanges();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save content");
    } finally {
      setSaving(false);
    }
  }

  async function pushToCanvas() {
    if (isDirty) {
      setMessage("Save the draft before pushing to Canvas.");
      return;
    }

    setPushing(true);
    setMessage(null);

    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${item.id}/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to push content to Canvas"));
      }

      const data = await res.json() as SaveResponse;
      const pushedTitle = data.title ?? "";
      const pushedHtml = data.html_body ?? "";
      setTitle(pushedTitle);
      setSavedTitle(pushedTitle);
      setSavedHtml(pushedHtml);
      setCurrentHtml(pushedHtml);
      setCanvasUrl(data.canvas_url ?? null);
      if (editor) {
        editor.commands.setContent(pushedHtml, { emitUpdate: false });
      }
      setMessage("Pushed saved draft to Canvas.");
      void loadPendingChanges();
      void loadPushHistory();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to push content to Canvas");
    } finally {
      setPushing(false);
    }
  }

  async function pushPendingContentChanges(changesToPush?: PendingContentChange[]) {
    const contentChanges = changesToPush ?? pendingChanges?.content_changes ?? [];
    if (!contentChanges.length || batchPushing) return;
    const includesCurrentDirtyItem = isDirty && contentChanges.some((change) => change.content_item_id === item.id);
    if (includesCurrentDirtyItem) {
      setReviewMessage("Save the current draft before pushing this content item.");
      return;
    }

    setBatchPushing(true);
    setReviewMessage(null);
    setBatchPushState(Object.fromEntries(
      contentChanges.map((change) => [change.content_item_id, { status: "queued" as const }]),
    ));

    let pushedCount = 0;
    let failedCount = 0;
    const batchId = crypto.randomUUID();

    try {
      const token = await getAccessToken();

      for (const change of contentChanges) {
      setBatchPushState((current) => ({
        ...current,
        [change.content_item_id]: { status: "pushing" },
      }));

      try {
        const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${change.content_item_id}/push`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
            body: JSON.stringify({ batch_id: batchId }),
        });
        if (!res.ok) {
          throw new Error(await parseApiError(res, "Failed to push content"));
        }

        const data = await res.json() as SaveResponse;
        pushedCount += 1;
        setBatchPushState((current) => ({
          ...current,
          [change.content_item_id]: { status: "pushed" },
        }));

        if (change.content_item_id === item.id) {
          const pushedTitle = data.title ?? "";
          const pushedHtml = data.html_body ?? "";
          setTitle(pushedTitle);
          setSavedTitle(pushedTitle);
          setSavedHtml(pushedHtml);
          setCurrentHtml(pushedHtml);
          setCanvasUrl(data.canvas_url ?? null);
          if (editor) {
            editor.commands.setContent(pushedHtml, { emitUpdate: false });
          }
          router.refresh();
        }
      } catch (error) {
        failedCount += 1;
        setBatchPushState((current) => ({
          ...current,
          [change.content_item_id]: {
            status: "failed",
            message: error instanceof Error ? error.message : "Failed to push content",
          },
        }));
      }
      }

      await loadPendingChanges();
      await loadPushHistory();
      setReviewMessage(
        failedCount
          ? `Content push finished: ${pushedCount} pushed, ${failedCount} failed.`
          : `Content push finished: ${pushedCount} item${pushedCount === 1 ? "" : "s"} pushed.`,
      );
    } catch (error) {
      setReviewMessage(error instanceof Error ? error.message : "Failed to start content push");
    } finally {
      setBatchPushing(false);
    }
  }

  function toggleContentPushSelection(contentItemId: string) {
    setSelectedContentPushIds((current) => {
      const next = new Set(current);
      if (next.has(contentItemId)) {
        next.delete(contentItemId);
      } else {
        next.add(contentItemId);
      }
      return next;
    });
  }

  function toggleAllContentPushSelection() {
    const contentChanges = pendingChanges?.content_changes ?? [];
    setSelectedContentPushIds((current) => {
      if (contentChanges.length && contentChanges.every((change) => current.has(change.content_item_id))) {
        return new Set();
      }
      return new Set(contentChanges.map((change) => change.content_item_id));
    });
  }

  function pushSelectedContentChanges() {
    const contentChanges = pendingChanges?.content_changes ?? [];
    const selectedChanges = contentChanges.filter((change) => selectedContentPushIds.has(change.content_item_id));
    void pushPendingContentChanges(selectedChanges);
  }

  async function restoreRevision(revisionId: string, revisionNumber: number) {
    setRestoringRevisionId(revisionId);
    setMessage(null);

    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${item.id}/revisions/${revisionId}/restore`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to restore revision"));
      }

      const data = await res.json() as SaveResponse;
      const restoredTitle = data.title ?? "";
      const restoredHtml = data.html_body ?? "";
      setTitle(restoredTitle);
      setSavedTitle(restoredTitle);
      setSavedHtml(restoredHtml);
      setCurrentHtml(restoredHtml);
      if (editor) {
        editor.commands.setContent(restoredHtml, { emitUpdate: false });
      }
      setChangeSummary("");
      setMessage(`Restored revision ${revisionNumber}.`);

      const revisionData = await fetchJson<{ items: RevisionRow[] }>(
        `/canvas/sessions/${sessionId}/content/${item.id}/revisions`,
        token,
        "Failed to load revisions",
      );
      setRevisions(revisionData.items);
      if (item.content_type === "quiz") {
        window.dispatchEvent(new CustomEvent("canvascurate:quiz-questions-updated"));
      }
      void loadPendingChanges();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to restore revision");
    } finally {
      setRestoringRevisionId(null);
    }
  }

  function closeIdentifyIssueModal() {
    setIdentifyIssueOpen(false);
    setIdentifyIssueMessage(null);
  }

  function applySavedContentResponse(data: SaveResponse) {
    const nextTitle = data.title ?? "";
    const nextHtml = data.html_body ?? "";
    setTitle(nextTitle);
    setSavedTitle(nextTitle);
    setSavedHtml(nextHtml);
    setCurrentHtml(nextHtml);
    if (editor) {
      editor.commands.setContent(nextHtml, { emitUpdate: false });
    }
    setChangeSummary("");
  }

  async function refreshLocalRevisions(token: string) {
    const revisionData = await fetchJson<{ items: RevisionRow[] }>(
      `/canvas/sessions/${sessionId}/content/${item.id}/revisions`,
      token,
      "Failed to load revisions",
    );
    setRevisions(revisionData.items);
  }

  async function loadCanvasRevisions() {
    if (item.content_type !== "page") {
      setIdentifyIssueMessage("Canvas page revisions are available for pages only.");
      setCanvasRevisionsLoaded(true);
      return;
    }
    setCanvasRevisionsLoading(true);
    setIdentifyIssueMessage(null);
    try {
      const token = await getAccessToken();
      const data = await fetchJson<{ items: CanvasRevisionRow[] }>(
        `/canvas/sessions/${sessionId}/content/${item.id}/canvas-revisions`,
        token,
        "Failed to load Canvas revisions",
      );
      setCanvasRevisions(data.items);
      setCanvasRevisionsLoaded(true);
      const nextSelectedId = data.items.some((revision) => revision.revision_id === selectedCanvasRevisionId)
        ? selectedCanvasRevisionId
        : data.items[0]?.revision_id ?? null;
      if (nextSelectedId) {
        void loadCanvasRevisionPreview(nextSelectedId);
      } else {
        setSelectedCanvasRevisionId(null);
        setCanvasRevisionPreview(null);
      }
    } catch (error) {
      setCanvasRevisionsLoaded(true);
      setIdentifyIssueMessage(error instanceof Error ? error.message : "Failed to load Canvas revisions");
    } finally {
      setCanvasRevisionsLoading(false);
    }
  }

  async function loadCanvasRevisionPreview(revisionId: number) {
    setSelectedCanvasRevisionId(revisionId);
    setCanvasRevisionPreviewLoading(true);
    setIdentifyIssueMessage(null);
    try {
      const token = await getAccessToken();
      const data = await fetchJson<CanvasRevisionPreview>(
        `/canvas/sessions/${sessionId}/content/${item.id}/canvas-revisions/${revisionId}`,
        token,
        "Failed to load Canvas revision preview",
      );
      setCanvasRevisionPreview(data);
    } catch (error) {
      setIdentifyIssueMessage(error instanceof Error ? error.message : "Failed to load Canvas revision preview");
    } finally {
      setCanvasRevisionPreviewLoading(false);
    }
  }

  async function restoreCanvasRevision() {
    if (!selectedCanvasRevisionId || canvasRevisionRestoring) return;
    if (isDirty) {
      setIdentifyIssueMessage("Save or cancel the current draft before restoring a previous version.");
      return;
    }
    setCanvasRevisionRestoring(true);
    setIdentifyIssueMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${item.id}/canvas-revisions/${selectedCanvasRevisionId}/restore`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to restore Canvas revision"));
      }
      const data = await res.json() as SaveResponse;
      applySavedContentResponse(data);
      await refreshLocalRevisions(token);
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
      void loadPendingChanges();
      closeIdentifyIssueModal();
      setMessage(`Restored Canvas revision ${selectedCanvasRevisionId}. Review the pending change before pushing to Canvas.`);
    } catch (error) {
      setIdentifyIssueMessage(error instanceof Error ? error.message : "Failed to restore Canvas revision");
    } finally {
      setCanvasRevisionRestoring(false);
    }
  }

  async function saveIssueFlag() {
    setFlagIssueSaving(true);
    setIdentifyIssueMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${item.id}/issues`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          issue_type: "flag_issue",
          note: flagIssueNote,
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to flag issue"));
      }
      setFlagIssueNote("");
      closeIdentifyIssueModal();
      setMessage("Issue flagged for the audit report.");
    } catch (error) {
      setIdentifyIssueMessage(error instanceof Error ? error.message : "Failed to flag issue");
    } finally {
      setFlagIssueSaving(false);
    }
  }

  async function loadSourceCourses(
    query = sourceCourseQuery,
    options: { append?: boolean; cursor?: string | null } = {},
  ) {
    setSourceCoursesLoading(true);
    setIdentifyIssueMessage(null);
    if (!options.append) {
      setSourceCourses([]);
      setSourceCoursesCursor(null);
      setSelectedSourceCourse(null);
      setSelectedSourcePage(null);
      setSourcePageMatches([]);
      setSourcePagePreview(null);
    }
    try {
      const token = await getAccessToken();
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (options.cursor) params.set("cursor", options.cursor);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const data = await fetchJson<{ items: SourceCourse[]; next_cursor?: string | null }>(
        `/canvas/sessions/${sessionId}/source-courses${suffix}`,
        token,
        "Failed to load source courses",
      );
      setSourceCourses((current) => {
        if (!options.append) return data.items;
        const existingIds = new Set(current.map((course) => course.course_id));
        return [
          ...current,
          ...data.items.filter((course) => !existingIds.has(course.course_id)),
        ];
      });
      setSourceCoursesCursor(data.next_cursor ?? null);
    } catch (error) {
      setIdentifyIssueMessage(error instanceof Error ? error.message : "Failed to load source courses");
    } finally {
      setSourceCoursesLoading(false);
    }
  }

  async function selectSourceCourse(course: SourceCourse) {
    setSelectedSourceCourse(course);
    setSelectedSourcePage(null);
    setSourcePagePreview(null);
    setSourcePageMatches([]);
    setSourcePagesLoading(true);
    setIdentifyIssueMessage(null);
    try {
      const token = await getAccessToken();
      const data = await fetchJson<{ items: SourcePageMatch[] }>(
        `/canvas/sessions/${sessionId}/source-pages?source_course_id=${encodeURIComponent(course.course_id)}&title=${encodeURIComponent(title || item.title || "")}`,
        token,
        "Failed to search source pages",
      );
      setSourcePageMatches(data.items);
      if (!data.items.length) {
        setIdentifyIssueMessage(`No matching page titled "${title || item.title}" was found in ${course.name}.`);
      }
    } catch (error) {
      setIdentifyIssueMessage(error instanceof Error ? error.message : "Failed to search source pages");
    } finally {
      setSourcePagesLoading(false);
    }
  }

  async function loadSourcePagePreview(page: SourcePageMatch) {
    if (!selectedSourceCourse) return;
    setSelectedSourcePage(page);
    setSourcePagePreviewLoading(true);
    setIdentifyIssueMessage(null);
    try {
      const token = await getAccessToken();
      const data = await fetchJson<SourcePagePreview>(
        `/canvas/sessions/${sessionId}/source-page?source_course_id=${encodeURIComponent(selectedSourceCourse.course_id)}&page_url=${encodeURIComponent(page.page_url)}`,
        token,
        "Failed to load source page preview",
      );
      setSourcePagePreview(data);
    } catch (error) {
      setIdentifyIssueMessage(error instanceof Error ? error.message : "Failed to load source page preview");
    } finally {
      setSourcePagePreviewLoading(false);
    }
  }

  async function replaceFromSourcePage() {
    if (!selectedSourceCourse || !selectedSourcePage || sourcePageReplacing) return;
    if (isDirty) {
      setIdentifyIssueMessage("Save or cancel the current draft before replacing content from a source course.");
      return;
    }
    setSourcePageReplacing(true);
    setIdentifyIssueMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${item.id}/replace-from-source-page`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          source_course_id: selectedSourceCourse.course_id,
          source_page_url: selectedSourcePage.page_url,
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to replace from source page"));
      }
      const data = await res.json() as SaveResponse;
      applySavedContentResponse(data);
      await refreshLocalRevisions(token);
      window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
      void loadPendingChanges();
      closeIdentifyIssueModal();
      setMessage("Replaced the local draft from the selected source page. Review the pending change before pushing to Canvas.");
    } catch (error) {
      setIdentifyIssueMessage(error instanceof Error ? error.message : "Failed to replace from source page");
    } finally {
      setSourcePageReplacing(false);
    }
  }

  function setLink() {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Enter link URL", previousUrl || "");
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const trimmedUrl = url.trim();
    if (editor.state.selection.empty) {
      editor.chain().focus().insertContent(`<a href="${escapeAttribute(trimmedUrl)}">${escapeHtml(trimmedUrl)}</a>`).run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: trimmedUrl }).run();
  }

  function uploadImage(insertMode: ManagedImageInsertMode = "image") {
    if (!editor || uploadingImage) return;
    pendingImageInsertModeRef.current = insertMode;
    imageUploadInputRef.current?.click();
  }

  function uploadFile() {
    if (!editor || uploadingFile) return;
    const { from, to, empty } = editor.state.selection;
    pendingFileLinkSelectionRef.current = empty
      ? null
      : { from, to, text: editor.state.doc.textBetween(from, to, " ").trim() };
    fileUploadInputRef.current?.click();
  }

  async function handleImageUpload(file: File | null) {
    if (!file || !editor) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Choose an image file to upload.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setMessage("Choose an image that is 10 MB or smaller.");
      return;
    }

    setUploadingImage(true);
    setMessage(null);
    const insertMode = pendingImageInsertModeRef.current;
    try {
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${item.id}/images/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to upload image"));
      }

      const data = await res.json() as EditorImageUploadResponse;
      setImageReview({
        imageId: data.image.id,
        src: data.insert.src,
        title: data.insert.title || file.name,
        canvasFileId: data.insert.canvas_file_id ?? null,
        insertMode,
      });
      setImageReviewAlt(data.image.edited_alt_text || data.insert.alt || "");
      setImageReviewLongDescription(data.image.long_description || "");
      setImageReviewDecorative(Boolean(data.image.is_decorative));
      setImageReviewError(null);
      setMessage(
        insertMode !== "image"
          ? `Uploaded image to Canvas Files. Add alt text or mark it decorative to insert the ${managedImageBlockLabel(insertMode)} block.`
          : "Uploaded image to Canvas Files. Add alt text or mark it decorative to insert it."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload image");
    } finally {
      setUploadingImage(false);
      if (imageUploadInputRef.current) {
        imageUploadInputRef.current.value = "";
      }
    }
  }

  async function handleFileUpload(file: File | null) {
    if (!file || !editor) return;
    const allowedExtensions = [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".csv", ".xls", ".xlsx"];
    const lowerName = file.name.toLowerCase();
    if (!allowedExtensions.some((extension) => lowerName.endsWith(extension))) {
      setMessage("Choose a PDF, Word, PowerPoint, CSV, or Excel file.");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setMessage("Choose a file that is 50 MB or smaller.");
      return;
    }

    setUploadingFile(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${item.id}/files/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to upload file"));
      }
      const data = await res.json() as EditorFileUploadResponse;
      const selection = pendingFileLinkSelectionRef.current;
      const linkText = selection?.text || data.insert.text || file.name;
      const linkHtml = `<a href="${escapeAttribute(data.insert.href)}" data-api-endpoint="${escapeAttribute(data.insert.href)}" data-api-returntype="File">${escapeHtml(linkText)}</a>`;
      if (selection && selection.from < selection.to) {
        const docSize = editor.state.doc.content.size;
        const from = Math.max(0, Math.min(selection.from, docSize));
        const to = Math.max(from, Math.min(selection.to, docSize));
        editor.chain().focus().insertContentAt({ from, to }, linkHtml).run();
      } else {
        editor.chain().focus().insertContent(linkHtml).run();
      }
      const issueCount = data.file.initial_accessibility_review?.issues.length ?? 0;
      setMessage(
        issueCount
          ? `Uploaded ${data.file.filename} to Canvas Files and ${selection ? "linked the selected text" : "inserted a link"}. Initial PDF review found ${issueCount} item${issueCount === 1 ? "" : "s"} for later document remediation.`
          : `Uploaded ${data.file.filename} to Canvas Files and ${selection ? "linked the selected text" : "inserted a link"}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload file");
    } finally {
      setUploadingFile(false);
      pendingFileLinkSelectionRef.current = null;
      if (fileUploadInputRef.current) {
        fileUploadInputRef.current.value = "";
      }
    }
  }

  async function generateImageReviewText(mode: "alt" | "long_desc" | "both") {
    if (!imageReview || imageReviewDecorative) return;
    setImageReviewGenerating(mode);
    setImageReviewError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/images/${imageReview.imageId}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ mode, overwrite_existing: true }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to generate image text"));
      }
      let data = await res.json() as ImageReviewGenerateResponse;
      const wasQueued = Boolean(data.job_id);
      if (wasQueued) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          const refresh = await fetch(`${API_URL}/canvas/sessions/${sessionId}/images/${imageReview.imageId}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          if (!refresh.ok) continue;
          data = await refresh.json() as ImageReviewGenerateResponse;
          const hasRequestedText =
            mode === "alt"
              ? Boolean(data.edited_alt_text)
              : mode === "long_desc"
                ? Boolean(data.long_description)
                : Boolean(data.edited_alt_text) && Boolean(data.long_description);
          if (hasRequestedText) break;
        }
      }
      if (data.edited_alt_text !== undefined) setImageReviewAlt(data.edited_alt_text || "");
      if (data.long_description !== undefined) setImageReviewLongDescription(data.long_description || "");
      if (data.is_decorative !== undefined) setImageReviewDecorative(Boolean(data.is_decorative));
      if (wasQueued && (
        (mode === "alt" && !data.edited_alt_text) ||
        (mode === "long_desc" && !data.long_description) ||
        (mode === "both" && (!data.edited_alt_text || !data.long_description))
      )) {
        setImageReviewError("Image text generation is queued. Reopen this image review after the worker finishes.");
      }
    } catch (error) {
      setImageReviewError(error instanceof Error ? error.message : "Failed to generate image text");
    } finally {
      setImageReviewGenerating(null);
    }
  }

  async function saveReviewedImageAndInsert() {
    if (!imageReview || !editor) return;
    const finalAlt = imageReviewAlt.trim();
    const finalLongDescription = imageReviewLongDescription.trim();
    if (!imageReviewDecorative && !finalAlt) {
      setImageReviewError("Add alt text or mark the image as decorative before inserting it.");
      return;
    }

    setImageReviewSaving(true);
    setImageReviewError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/images/${imageReview.imageId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          edited_alt_text: imageReviewDecorative ? null : finalAlt,
          long_description: imageReviewDecorative ? null : finalLongDescription || null,
          is_decorative: imageReviewDecorative,
          review_action: "keep",
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to save image accessibility text"));
      }

      if (imageReview.insertMode !== "image") {
        const inserted = insertHtmlBlockIntoDraft(buildManagedImageBlockHtml({
          alt: finalAlt,
          canvasFileId: imageReview.canvasFileId,
          decorative: imageReviewDecorative,
          mode: imageReview.insertMode,
          src: imageReview.src,
          title: imageReview.title,
        }));
        if (!inserted) return;
      } else {
        const attrs: {
          src: string;
          alt: string;
          title?: string;
          role?: string;
          "data-canvas-file-id"?: string;
          "data-decorative"?: string;
        } = {
          src: imageReview.src,
          alt: imageReviewDecorative ? "" : finalAlt,
        };
        if (imageReview.title) attrs.title = imageReview.title;
        if (imageReview.canvasFileId) attrs["data-canvas-file-id"] = imageReview.canvasFileId;
        if (imageReviewDecorative) {
          attrs.role = "presentation";
          attrs["data-decorative"] = "true";
        }
        editor.chain().focus().setImage(attrs).run();
      }
      setImageReview(null);
      setImageReviewAlt("");
      setImageReviewLongDescription("");
      setImageReviewDecorative(false);
      pendingImageInsertModeRef.current = "image";
      setMessage(
        imageReview.insertMode !== "image"
          ? `Inserted reviewed ${managedImageBlockLabel(imageReview.insertMode)} block into the draft.`
          : "Inserted reviewed image into the draft."
      );
    } catch (error) {
      setImageReviewError(error instanceof Error ? error.message : "Failed to save image accessibility text");
    } finally {
      setImageReviewSaving(false);
    }
  }

  function insertTable(rows = 3, cols = 3) {
    if (!editor) return;
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
  }

  function insertHtmlBlockIntoDraft(html: string, successMessage?: string) {
    if (!editor) return false;
    editor.commands.focus();
    const inserted = editor.commands.insertHtmlBlock(html);
    if (!inserted) {
      setMessage("Could not insert this content block here.");
      return false;
    }
    if (successMessage) setMessage(successMessage);
    return true;
  }

  function insertAccordion() {
    if (!editor) return;
    editor.commands.focus();
    const inserted = editor.commands.insertAccordion();
    if (!inserted) setMessage("Could not insert accordion here.");
  }

  function insertStyledSeparator(variant = "thin") {
    if (!editor) return;
    editor.commands.focus();
    const inserted = editor.commands.insertStyledSeparator(variant);
    if (!inserted) setMessage("Could not insert separator here.");
  }

  function openHtmlBlockInsert() {
    pendingHtmlBlockUpdateRef.current = null;
    setHtmlBlockModalMode("insert");
    setHtmlBlockDraft("");
    setHtmlBlockModalOpen(true);
  }

  function closeHtmlBlockModal() {
    setHtmlBlockModalOpen(false);
    setHtmlBlockDraft("");
    pendingHtmlBlockUpdateRef.current = null;
    setHtmlBlockModalMode("insert");
  }

  function insertHtmlBlock() {
    const html = htmlBlockDraft.trim();
    if (!html) return;
    if (htmlBlockModalMode === "edit") {
      pendingHtmlBlockUpdateRef.current?.(html);
      closeHtmlBlockModal();
      setMessage("Updated HTML block.");
      return;
    }
    if (insertHtmlBlockIntoDraft(html, "Inserted HTML embed block.")) {
      closeHtmlBlockModal();
    }
  }

  function openVideoEmbedInsert() {
    setVideoEmbedUrl("");
    setVideoEmbedError(null);
    setVideoEmbedModalOpen(true);
  }

  function insertVideoEmbed() {
    const parsed = parseVideoEmbedUrl(videoEmbedUrl);
    if (!parsed || !editor) {
      setVideoEmbedError("Enter a YouTube, Vimeo, or iframe source URL.");
      return;
    }
    if (!insertHtmlBlockIntoDraft(buildVideoEmbedHtml(parsed.embedUrl), "Inserted video embed block.")) return;
    setVideoEmbedUrl("");
    setVideoEmbedError(null);
    setVideoEmbedModalOpen(false);
  }

  function openLatexInsert() {
    pendingLatexBlockUpdateRef.current = null;
    setLatexModalMode("insert");
    setLatexDraft("");
    setLatexDisplayMode(true);
    setLatexError(null);
    setLatexModalOpen(true);
  }

  function closeLatexModal() {
    setLatexModalOpen(false);
    setLatexDraft("");
    setLatexError(null);
    pendingLatexBlockUpdateRef.current = null;
    setLatexModalMode("insert");
  }

  function insertLatexBlock() {
    const latex = latexDraft.trim();
    if (!latex || (!editor && latexModalMode === "insert")) {
      setLatexError("Enter a LaTeX equation.");
      return;
    }
    const html = buildLatexHtml(latex, latexDisplayMode);
    if (latexModalMode === "edit") {
      pendingLatexBlockUpdateRef.current?.(html);
      closeLatexModal();
      setMessage("Updated LaTeX equation block.");
      return;
    }
    if (!insertHtmlBlockIntoDraft(html, "Inserted LaTeX equation block.")) return;
    closeLatexModal();
  }

  function insertLatexSnippet(snippet: string) {
    const textarea = latexTextareaRef.current;
    if (!textarea) {
      setLatexDraft((current) => `${current}${current.endsWith(" ") || !current ? "" : " "}${snippet}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${latexDraft.slice(0, start)}${snippet}${latexDraft.slice(end)}`;
    setLatexDraft(next);
    window.requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + snippet.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  function openAIGenerate() {
    setAiGeneratePrompt("");
    setAiGenerateContext("");
    setAiGeneratePreview("");
    setAiGenerateError(null);
    setAiGenerateModalOpen(true);
  }

  function openAccessibilityCheck() {
    setAccessibilityCheckOpen(true);
  }

  function applyAccessibilityHtml(nextHtml: string) {
    setCurrentHtml(nextHtml);
    if (editor) {
      editor.commands.setContent(nextHtml, { emitUpdate: true });
    }
  }

  async function generateAIContent() {
    if (!aiGeneratePrompt.trim() || !editor) return;
    setAiGenerateLoading(true);
    setAiGenerateError(null);
    setAiGeneratePreview("");
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/ai-generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prompt: aiGeneratePrompt.trim(),
          additional_context: aiGenerateContext.trim() || null,
          context: editorPlainText(editor, 5000),
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to generate content"));
      }
      const data = await res.json() as { html?: string };
      if (!data.html?.trim()) throw new Error("AI returned an empty response.");
      setAiGeneratePreview(data.html.trim());
    } catch (err) {
      setAiGenerateError(err instanceof Error ? err.message : "Failed to generate content");
    } finally {
      setAiGenerateLoading(false);
    }
  }

  function insertAIContent() {
    if (!editor || !aiGeneratePreview.trim()) return;
    editor.chain().focus().insertContent(aiGeneratePreview).run();
    setAiGenerateModalOpen(false);
    setAiGeneratePrompt("");
    setAiGenerateContext("");
    setAiGeneratePreview("");
    setMessage("Inserted AI generated content into the draft.");
  }

  function switchEditorMode(nextMode: "rich" | "html") {
    if (nextMode === editorMode) return;
    if (nextMode === "html" && editor) {
      setCurrentHtml(serializeHtmlBlocks(editor.getHTML()));
    }
    if (nextMode === "rich" && editor && editor.getHTML() !== currentHtml) {
      editor.commands.setContent(currentHtml, { emitUpdate: false });
    }
    if (nextMode === "rich" && mode === "split") {
      setMode("edit");
    }
    setEditorMode(nextMode);
  }

  function stepFindMatch(direction: 1 | -1) {
    if (findMatchCount === 0) return;
    const nextIndex = (activeFindIndex + direction + findMatchCount) % findMatchCount;
    setActiveFindIndex(nextIndex);
    selectFindMatch(nextIndex);
  }

  function replaceActiveFindMatch() {
    if (findMatchCount === 0) {
      setMessage("No selected match to replace.");
      return;
    }
    if (editorMode === "rich") {
      const sourceHtml = serializeHtmlBlocks(editor?.getHTML() ?? currentHtml);
      const result = replaceNthTextMatchInHtml(sourceHtml, findQuery, replaceValue, findCaseSensitive, activeFindIndex);
      if (!result.replaced) {
        setMessage("No selected match to replace.");
        return;
      }
      setCurrentHtml(result.html);
      editor?.commands.setContent(result.html, { emitUpdate: false });
    } else {
      const match = htmlFindMatches[activeFindIndex];
      if (!match) {
        setMessage("No selected match to replace.");
        return;
      }
      const nextHtml = `${currentHtml.slice(0, match.from)}${replaceValue}${currentHtml.slice(match.to)}`;
      setCurrentHtml(nextHtml);
      window.setTimeout(() => {
        const cursor = match.from + replaceValue.length;
        htmlTextareaRef.current?.focus();
        htmlTextareaRef.current?.setSelectionRange(cursor, cursor);
      }, 0);
    }
    setMessage("Replaced the selected match.");
  }

  function replaceCurrentItemMatches() {
    const sourceHtml = editorMode === "html" ? currentHtml : serializeHtmlBlocks(editor?.getHTML() ?? currentHtml);
    const result = replaceTextMatchesInHtml(sourceHtml, findQuery, replaceValue, findCaseSensitive);
    if (result.count === 0) {
      setMessage("No matches found in the current item.");
      return;
    }
    setCurrentHtml(result.html);
    if (editor) {
      editor.commands.setContent(result.html, { emitUpdate: false });
    }
    setMode("edit");
    setMessage(`Replaced ${result.count} match${result.count === 1 ? "" : "es"} in the current item.`);
  }

  function cancelEditing() {
    setTitle(savedTitle);
    setCurrentHtml(savedHtml);
    setChangeSummary("");
    setFindReplaceOpen(false);
    setSlashMenu(null);
    setHtmlBlockModalOpen(false);
    setImageReview(null);
    setImageReviewError(null);
    pendingImageInsertModeRef.current = "image";
    setExpandedEditor(false);
    setEditorMode("rich");
    editor?.commands.setContent(savedHtml, { emitUpdate: false });
    setMode("preview");
    setMessage(isDirty ? "Discarded unsaved edits." : null);
  }

  return (
    <div
      className={`flex min-h-0 flex-col ${
        expandedEditor
          ? "fixed inset-3 z-[45] overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface shadow-2xl"
          : "h-full"
      }`}
    >
      <input
        ref={imageUploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleImageUpload(event.target.files?.[0] ?? null)}
      />
      <input
        ref={fileUploadInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.ppt,.pptx,.csv,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(event) => void handleFileUpload(event.target.files?.[0] ?? null)}
      />
      <div className="grid flex-none gap-3 border-b border-outline-variant/30 px-6 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0 lg:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
            {item.content_type}
            {item.module_name ? ` / ${item.module_name}` : ""}
          </p>
          {pendingModuleRemoval || pendingModuleDeletion ? (
            <div className="mt-2 inline-flex max-w-full items-center rounded-full bg-error/10 px-3 py-1 text-xs font-semibold text-error">
              {pendingModuleDeletion ? "Pending module deletion" : "Pending removal"}
              {pendingModuleRemovalLabel ? `: ${pendingModuleRemovalLabel}` : ""}
            </div>
          ) : null}
        </div>
        <div className="min-w-0">
          {mode === "preview" ? (
            <h1 className="truncate font-headline text-2xl font-extrabold text-on-surface">
              {title || "Untitled content"}
            </h1>
          ) : (
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-10 w-full rounded-xl border border-outline-variant/40 bg-surface-container-low px-3 py-2 font-headline text-lg font-bold text-on-surface outline-none focus:border-primary"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {mode === "preview" && canvasUrl ? (
            <a
              href={canvasUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center rounded-xl bg-surface-container-low px-4 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
            >
              Open in Canvas
            </a>
          ) : null}
          {mode === "preview" ? (
            <button
              type="button"
              onClick={() => {
                setIdentifyIssueMessage(null);
                setCanvasRevisionsLoaded(false);
                setCanvasRevisions([]);
                setSelectedCanvasRevisionId(null);
                setCanvasRevisionPreview(null);
                setIdentifyIssueOpen(true);
                setIdentifyIssueMode("replace");
                setIdentifyIssueTab("revisions");
              }}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-surface-container-low px-4 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
            >
              <Flag size={15} />
              Identify Issue
            </button>
          ) : null}
          {mode === "preview" ? (
            <button
              type="button"
              onClick={() => setMode("edit")}
              className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container"
            >
              Edit
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={cancelEditing}
                disabled={saving || pushing}
                className="inline-flex h-10 items-center rounded-xl bg-surface-container-low px-4 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setExpandedEditor(false);
                  setMode("preview");
                }}
                className="inline-flex h-10 items-center rounded-xl bg-surface-container-low px-4 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setExpandedEditor((expanded) => !expanded)}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-surface-container-low px-4 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
              >
                {expandedEditor ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                {expandedEditor ? "Exit Expanded" : "Expand Editor"}
              </button>
              <button
                type="button"
                disabled={!isDirty || saving || pushing}
                onClick={() => void saveChanges()}
                className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Saving…" : isDirty ? "Save Draft" : "Saved"}
              </button>
              <button
                type="button"
                disabled={isDirty || saving || pushing}
                onClick={() => void pushToCanvas()}
                className="inline-flex h-10 items-center rounded-xl bg-secondary-container px-4 text-sm font-semibold text-on-secondary-container transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pushing ? "Pushing…" : "Push to Canvas"}
              </button>
            </>
          )}
        </div>
      </div>

      {mode !== "preview" ? (
        <div className="flex-none border-b border-outline-variant/20 px-4 py-2">
          <EditorToolbar
            editor={editor}
            editorMode={editorMode}
            insertAccordion={insertAccordion}
            insertStyledSeparator={insertStyledSeparator}
            insertTable={insertTable}
            mode={mode}
            openHtmlBlockInsert={openHtmlBlockInsert}
            openLatexInsert={openLatexInsert}
            openAIGenerate={openAIGenerate}
            openAccessibilityCheck={openAccessibilityCheck}
            openVideoEmbedInsert={openVideoEmbedInsert}
            setLink={setLink}
            setMode={setMode}
            switchEditorMode={switchEditorMode}
            openFindReplace={() => setFindReplaceOpen((open) => !open)}
            uploadFile={uploadFile}
            uploadImage={uploadImage}
            uploadingFile={uploadingFile}
            uploadingImage={uploadingImage}
          />
        </div>
      ) : null}

      {slashMenu?.open && editor && mode !== "preview" && editorMode === "rich" ? (
        <SlashCommandMenu
          editor={editor}
          coords={{ x: slashMenu.x, y: slashMenu.y }}
          onClose={() => setSlashMenu(null)}
          uploadImage={uploadImage}
        />
      ) : null}

      {tableContextMenu && editor && mode !== "preview" && editorMode === "rich" ? (
        <div
          ref={tableContextMenuRef}
          className="fixed z-[90] max-h-[calc(100vh-16px)] w-56 overflow-y-auto rounded-xl border border-outline-variant/40 bg-white p-1.5 shadow-2xl"
          style={{ left: tableContextMenu.x, top: tableContextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {[
            ["Add row above", () => editor.chain().focus().addRowBefore().run()],
            ["Add row below", () => editor.chain().focus().addRowAfter().run()],
            ["Delete row", () => editor.chain().focus().deleteRow().run()],
            ["Add column left", () => editor.chain().focus().addColumnBefore().run()],
            ["Add column right", () => editor.chain().focus().addColumnAfter().run()],
            ["Delete column", () => editor.chain().focus().deleteColumn().run()],
            ["Toggle header row", () => editor.chain().focus().toggleHeaderRow().run()],
            ["Delete table", () => editor.chain().focus().deleteTable().run()],
          ].map(([label, action], index) => (
            <button
              key={String(label)}
              type="button"
              onClick={() => {
                (action as () => boolean)();
                setTableContextMenu(null);
              }}
              className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-surface-container-low ${
                index === 2 || index === 5 || index === 7 ? "text-error" : "text-on-surface"
              }`}
            >
              {String(label)}
            </button>
          ))}
        </div>
      ) : null}

      {mode !== "preview" && findReplaceOpen ? (
        <div className="flex-none border-b border-outline-variant/20 bg-surface-container-low px-6 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[220px] flex-1 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
              Find
              <input
                type="text"
                value={findQuery}
                onChange={(event) => setFindQuery(event.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-on-surface outline-none focus:border-primary"
                placeholder="Text in this item"
                autoFocus
              />
            </label>
            <label className="min-w-[220px] flex-1 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
              Replace
              <input
                type="text"
                value={replaceValue}
                onChange={(event) => setReplaceValue(event.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-on-surface outline-none focus:border-primary"
                placeholder="Replacement text"
              />
            </label>
            <label className="inline-flex h-10 items-center gap-2 rounded-xl border border-outline-variant/40 bg-white px-3 text-xs font-semibold text-on-surface-variant">
              <input
                type="checkbox"
                checked={findCaseSensitive}
                onChange={(event) => setFindCaseSensitive(event.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              Match case
            </label>
            <span className="inline-flex h-10 items-center rounded-xl bg-surface-container-high px-3 text-xs font-semibold text-on-surface-variant">
              {findQuery.trim()
                ? findMatchCount
                  ? `${activeFindIndex + 1} of ${findMatchCount}`
                  : "0 matches"
                : "No query"}
            </span>
            <div className="flex h-10 items-center gap-1 rounded-xl border border-outline-variant/40 bg-white p-1">
              <button
                type="button"
                title="Previous match"
                disabled={findMatchCount === 0}
                onClick={() => stepFindMatch(-1)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                title="Next match"
                disabled={findMatchCount === 0}
                onClick={() => stepFindMatch(1)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronDown size={16} />
              </button>
            </div>
            <button
              type="button"
              disabled={!findQuery.trim() || findMatchCount === 0}
              onClick={replaceActiveFindMatch}
              className="inline-flex h-10 items-center rounded-xl bg-secondary-container px-4 text-xs font-semibold text-on-secondary-container transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40"
            >
              Replace
            </button>
            <button
              type="button"
              disabled={!findQuery.trim() || findMatchCount === 0}
              onClick={replaceCurrentItemMatches}
              className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-xs font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-40"
            >
              Replace All
            </button>
            <button
              type="button"
              title="Close find and replace"
              onClick={() => setFindReplaceOpen(false)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-surface-container-high text-on-surface-variant transition-colors hover:bg-surface-dim"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      ) : null}

      {message ? (
        <div className="mx-6 mt-3 flex-none rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-sm text-on-surface">
          {message}
        </div>
      ) : null}

      {identifyIssueOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-on-surface/50 px-4 py-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeIdentifyIssueModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="identify-issue-title"
            className="flex max-h-[90vh] w-full max-w-[96vw] flex-col overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl"
          >
            <div className="flex flex-none items-start justify-between gap-4 border-b border-outline-variant/30 px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Content Review</p>
                <h2 id="identify-issue-title" className="mt-1 font-headline text-xl font-bold text-on-surface">
                  Identify Issue
                </h2>
                <p className="mt-1 text-sm text-on-surface-variant">
                  Restore known-good page content or flag this item for the audit report.
                </p>
              </div>
              <button
                type="button"
                title="Close"
                onClick={closeIdentifyIssueModal}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant transition-colors hover:bg-surface-container-high"
              >
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {identifyIssueMessage ? (
                <div className="mb-4 rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-sm font-semibold text-on-surface">
                  {identifyIssueMessage}
                </div>
              ) : null}
              {isDirty ? (
                <div className="mb-4 rounded-xl border border-error/30 bg-error-container px-4 py-3 text-sm font-semibold text-error">
                  Save or cancel the current draft before restoring or replacing content.
                </div>
              ) : null}
              <div className="mb-5 grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setIdentifyIssueMode("replace")}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    identifyIssueMode === "replace"
                      ? "border-primary bg-primary/10 text-on-surface"
                      : "border-outline-variant/40 bg-white text-on-surface hover:bg-surface-container-low"
                  }`}
                >
                  <span className="inline-flex items-center gap-2 text-sm font-bold">
                    <RotateCcw size={16} />
                    Content needs replacing
                  </span>
                  <span className="mt-1 block text-xs text-on-surface-variant">
                    Compare versions and restore from Canvas history or a source course.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setIdentifyIssueMode("flag")}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    identifyIssueMode === "flag"
                      ? "border-primary bg-primary/10 text-on-surface"
                      : "border-outline-variant/40 bg-white text-on-surface hover:bg-surface-container-low"
                  }`}
                >
                  <span className="inline-flex items-center gap-2 text-sm font-bold">
                    <Flag size={16} />
                    Flag issue
                  </span>
                  <span className="mt-1 block text-xs text-on-surface-variant">
                    Record an issue for follow-up and the phase 6 audit report.
                  </span>
                </button>
              </div>

              {identifyIssueMode === "flag" ? (
                <div className="rounded-xl border border-outline-variant/30 bg-white px-4 py-4">
                  <label className="block text-sm font-semibold text-on-surface">
                    Issue notes
                    <textarea
                      value={flagIssueNote}
                      onChange={(event) => setFlagIssueNote(event.target.value)}
                      rows={6}
                      placeholder="Describe what needs follow-up, where it appears, or why this content should be reviewed."
                      className="mt-2 w-full resize-y rounded-xl border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm font-normal text-on-surface outline-none focus:border-primary"
                    />
                  </label>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setIdentifyIssueTab("revisions")}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                        identifyIssueTab === "revisions"
                          ? "bg-primary text-on-primary"
                          : "bg-surface-container-low text-on-surface hover:bg-surface-container-high"
                      }`}
                    >
                      Previous Versions
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIdentifyIssueTab("source");
                        if (!sourceCourses.length && !sourceCoursesLoading) void loadSourceCourses();
                      }}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                        identifyIssueTab === "source"
                          ? "bg-primary text-on-primary"
                          : "bg-surface-container-low text-on-surface hover:bg-surface-container-high"
                      }`}
                    >
                      Source Course
                    </button>
                  </div>

                  {item.content_type !== "page" ? (
                    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-6 text-sm text-on-surface-variant">
                      Previous-version replacement is currently available for pages. Other content types should be flagged for review.
                    </div>
                  ) : identifyIssueTab === "revisions" ? (
                    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                      <div className="rounded-xl border border-outline-variant/30 bg-white p-3">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Canvas Revisions</p>
                          <button
                            type="button"
                            title="Refresh revisions"
                            onClick={() => {
                              setCanvasRevisionsLoaded(false);
                              void loadCanvasRevisions();
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high"
                          >
                            <RefreshCw size={14} />
                          </button>
                        </div>
                        {canvasRevisionsLoading ? (
                          <p className="text-sm text-on-surface-variant">Loading revisions...</p>
                        ) : canvasRevisions.length ? (
                          <div className="max-h-[48vh] space-y-2 overflow-y-auto">
                            {canvasRevisions.map((revision) => (
                              <button
                                key={revision.revision_id}
                                type="button"
                                onClick={() => void loadCanvasRevisionPreview(revision.revision_id)}
                                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                                  selectedCanvasRevisionId === revision.revision_id
                                    ? "border-primary bg-primary/10"
                                    : "border-outline-variant/30 bg-surface-container-lowest hover:bg-surface-container-low"
                                }`}
                              >
                                <span className="block font-semibold text-on-surface">
                                  Revision {revision.revision_id}{revision.latest ? " · latest" : ""}
                                </span>
                                <span className="block text-xs text-on-surface-variant">
                                  {revision.updated_at ? formatDate(revision.updated_at) : "No date"}
                                  {revision.edited_by?.display_name ? ` · ${revision.edited_by.display_name}` : ""}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-on-surface-variant">No Canvas revisions were found for this page.</p>
                        )}
                      </div>
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div className="overflow-hidden rounded-xl border border-outline-variant/30 bg-white">
                          <div className="border-b border-outline-variant/20 bg-surface-container-low px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                            Current Draft
                          </div>
                          <div className="canvas-content max-h-[52vh] overflow-auto p-4 text-sm text-on-surface" dangerouslySetInnerHTML={{ __html: currentHtml || "<p>No content</p>" }} />
                        </div>
                        <div className="overflow-hidden rounded-xl border border-outline-variant/30 bg-white">
                          <div className="border-b border-outline-variant/20 bg-surface-container-low px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                            Selected Revision
                          </div>
                          {canvasRevisionPreviewLoading ? (
                            <div className="p-4 text-sm text-on-surface-variant">Loading preview...</div>
                          ) : canvasRevisionPreview ? (
                            <div className="canvas-content max-h-[52vh] overflow-auto p-4 text-sm text-on-surface" dangerouslySetInnerHTML={{ __html: canvasRevisionPreview.body || "<p>No content</p>" }} />
                          ) : (
                            <div className="p-4 text-sm text-on-surface-variant">Choose a revision to preview it.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
                      <div className="space-y-4">
                        <div className="rounded-xl border border-outline-variant/30 bg-white p-3">
                          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Courses</p>
                          <form
                            className="mb-3 flex gap-2"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void loadSourceCourses(sourceCourseQuery, { append: false });
                            }}
                          >
                            <input
                              value={sourceCourseQuery}
                              onChange={(event) => setSourceCourseQuery(event.target.value)}
                              placeholder="Search courses..."
                              className="min-w-0 flex-1 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm outline-none focus:border-primary"
                            />
                            <button
                              type="submit"
                              className="inline-flex h-10 items-center gap-2 rounded-lg bg-surface-container-low px-3 text-sm font-semibold text-on-surface hover:bg-surface-container-high"
                            >
                              <Search size={15} />
                              Search
                            </button>
                          </form>
                          {sourceCoursesLoading && !sourceCourses.length ? (
                            <p className="text-sm text-on-surface-variant">Loading courses...</p>
                          ) : sourceCourses.length ? (
                            <div className="max-h-[30vh] space-y-2 overflow-y-auto">
                              {sourceCourses.map((course) => (
                                <button
                                  key={course.course_id}
                                  type="button"
                                  onClick={() => void selectSourceCourse(course)}
                                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                                    selectedSourceCourse?.course_id === course.course_id
                                      ? "border-primary bg-primary/10"
                                      : "border-outline-variant/30 bg-surface-container-lowest hover:bg-surface-container-low"
                                  }`}
                                >
                                  <span className="flex items-center gap-2 font-semibold text-on-surface">
                                    <GraduationCap size={14} />
                                    <span className="truncate">{course.name}</span>
                                  </span>
                                  <span className="mt-1 block truncate text-xs text-on-surface-variant">
                                    {[course.course_code, course.term_name].filter(Boolean).join(" · ") || `Course ${course.course_id}`}
                                  </span>
                                </button>
                              ))}
                              {sourceCoursesCursor ? (
                                <button
                                  type="button"
                                  onClick={() => void loadSourceCourses(sourceCourseQuery, { append: true, cursor: sourceCoursesCursor })}
                                  disabled={sourceCoursesLoading}
                                  className="w-full rounded-lg border border-dashed border-outline-variant/50 bg-surface-container-lowest px-3 py-2 text-center text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {sourceCoursesLoading ? "Loading more..." : "Load more courses"}
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-sm text-on-surface-variant">No courses found.</p>
                          )}
                        </div>
                        <div className="rounded-xl border border-outline-variant/30 bg-white p-3">
                          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Matching Pages</p>
                          {sourcePagesLoading ? (
                            <p className="text-sm text-on-surface-variant">Searching pages...</p>
                          ) : sourcePageMatches.length ? (
                            <div className="max-h-[24vh] space-y-2 overflow-y-auto">
                              {sourcePageMatches.map((page) => (
                                <button
                                  key={page.page_url}
                                  type="button"
                                  onClick={() => void loadSourcePagePreview(page)}
                                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                                    selectedSourcePage?.page_url === page.page_url
                                      ? "border-primary bg-primary/10"
                                      : "border-outline-variant/30 bg-surface-container-lowest hover:bg-surface-container-low"
                                  }`}
                                >
                                  <span className="flex items-center gap-2 font-semibold text-on-surface">
                                    <FileText size={14} />
                                    <span className="truncate">{page.title}</span>
                                  </span>
                                  <span className="mt-1 block text-xs text-on-surface-variant">
                                    {page.updated_at ? formatDate(page.updated_at) : page.page_url}
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-on-surface-variant">
                              {selectedSourceCourse ? "No matching pages found." : "Choose a course to search for a matching page title."}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
                        <div className="overflow-hidden rounded-xl border border-outline-variant/30 bg-white">
                          <div className="border-b border-outline-variant/20 bg-surface-container-low px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                            Current Draft
                          </div>
                          <div className="canvas-content max-h-[52vh] overflow-auto p-4 text-sm text-on-surface" dangerouslySetInnerHTML={{ __html: currentHtml || "<p>No content</p>" }} />
                        </div>
                        <div className="overflow-hidden rounded-xl border border-outline-variant/30 bg-white">
                          <div className="border-b border-outline-variant/20 bg-surface-container-low px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                            Source Page
                          </div>
                          {sourcePagePreviewLoading ? (
                            <div className="p-4 text-sm text-on-surface-variant">Loading source preview...</div>
                          ) : sourcePagePreview ? (
                            <div className="canvas-content max-h-[52vh] overflow-auto p-4 text-sm text-on-surface" dangerouslySetInnerHTML={{ __html: sourcePagePreview.body || "<p>No content</p>" }} />
                          ) : (
                            <div className="p-4 text-sm text-on-surface-variant">Choose a matching page to preview it.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-outline-variant/30 px-6 py-4">
              <button
                type="button"
                onClick={closeIdentifyIssueModal}
                className="rounded-lg bg-surface-container-low px-3 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
              >
                Cancel
              </button>
              {identifyIssueMode === "flag" ? (
                <button
                  type="button"
                  onClick={() => void saveIssueFlag()}
                  disabled={flagIssueSaving}
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {flagIssueSaving ? "Saving..." : "Flag Issue"}
                </button>
              ) : identifyIssueTab === "source" ? (
                <button
                  type="button"
                  onClick={() => void replaceFromSourcePage()}
                  disabled={isDirty || sourcePageReplacing || !selectedSourcePage || !sourcePagePreview}
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sourcePageReplacing ? "Replacing..." : "Replace with Source Page"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void restoreCanvasRevision()}
                  disabled={isDirty || canvasRevisionRestoring || !selectedCanvasRevisionId || !canvasRevisionPreview}
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {canvasRevisionRestoring ? "Restoring..." : "Restore Selected Version"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {accessibilityCheckOpen ? (
        <AccessibilityCheckPanel
          currentHtml={currentHtml}
          editor={editor}
          editorMode={editorMode}
          onApplyHtml={applyAccessibilityHtml}
          onClose={() => setAccessibilityCheckOpen(false)}
          sessionId={sessionId}
        />
      ) : null}

      {aiGenerateModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-on-surface/50 px-4 py-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-generate-title"
            className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-outline-variant/30 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Tools</p>
                <h2 id="ai-generate-title" className="mt-1 font-headline text-xl font-bold text-on-surface">
                  AI Content Generator
                </h2>
              </div>
              <button
                type="button"
                title="Close"
                onClick={() => setAiGenerateModalOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant transition-colors hover:bg-surface-container-high"
              >
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
              {aiGenerateError ? (
                <div className="rounded-xl border border-error/30 bg-error-container px-4 py-3 text-sm font-semibold text-error">
                  {aiGenerateError}
                </div>
              ) : null}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Quick Prompts</p>
                <div className="flex flex-wrap gap-2">
                  {AI_GENERATE_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setAiGeneratePrompt(preset.prompt)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        aiGeneratePrompt === preset.prompt
                          ? "border-primary bg-primary text-on-primary"
                          : "border-outline-variant/40 bg-white text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Smart Prompts</p>
                <div className="flex flex-wrap gap-2">
                  {AI_SMART_PROMPTS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setAiGeneratePrompt(preset.prompt)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        aiGeneratePrompt === preset.prompt
                          ? "border-secondary-container bg-secondary-container text-on-secondary-container"
                          : "border-outline-variant/40 bg-white text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block text-sm font-semibold text-on-surface">
                Prompt
                <textarea
                  value={aiGeneratePrompt}
                  onChange={(event) => setAiGeneratePrompt(event.target.value)}
                  rows={4}
                  placeholder="Describe what content you want to generate..."
                  className="mt-2 w-full resize-y rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm font-normal text-on-surface outline-none focus:border-primary"
                  autoFocus
                />
              </label>
              <label className="block text-sm font-semibold text-on-surface">
                Additional context
                <textarea
                  value={aiGenerateContext}
                  onChange={(event) => setAiGenerateContext(event.target.value)}
                  rows={3}
                  placeholder="Optional: audience, module topic, tone, constraints, or details to include."
                  className="mt-2 w-full resize-y rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm font-normal text-on-surface outline-none focus:border-primary"
                />
              </label>
              <button
                type="button"
                disabled={!aiGeneratePrompt.trim() || aiGenerateLoading}
                onClick={() => void generateAIContent()}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Sparkles size={16} />
                {aiGenerateLoading ? "Generating..." : "Generate"}
              </button>
              {aiGeneratePreview ? (
                <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Preview</p>
                  <div
                    className="canvas-content max-h-72 overflow-auto rounded-lg bg-white p-4 text-sm text-on-surface"
                    dangerouslySetInnerHTML={{ __html: aiGeneratePreview }}
                  />
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-outline-variant/30 px-5 py-4">
              <button
                type="button"
                onClick={() => setAiGenerateModalOpen(false)}
                className="rounded-lg bg-surface-container-low px-3 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!aiGeneratePreview.trim()}
                onClick={insertAIContent}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
              >
                Insert into Editor
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {htmlBlockModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-on-surface/50 px-4 py-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="html-block-title"
            className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-outline-variant/30 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                  {htmlBlockModalMode === "edit" ? "Edit" : "Insert"}
                </p>
                <h2 id="html-block-title" className="mt-1 font-headline text-xl font-bold text-on-surface">
                  {htmlBlockModalMode === "edit" ? "Edit HTML Block" : "Embed HTML / iFrame"}
                </h2>
              </div>
              <button
                type="button"
                title="Close"
                onClick={closeHtmlBlockModal}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant transition-colors hover:bg-surface-container-high"
              >
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {htmlBlockModalMode === "insert" ? (
              <div className="mb-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Templates</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    ["YouTube", '<iframe width="560" height="315" src="https://www.youtube.com/embed/VIDEO_ID" title="YouTube video player" frameborder="0" allowfullscreen></iframe>'],
                    ["Google Maps", '<iframe src="https://www.google.com/maps/embed?pb=PASTE_YOUR_EMBED_URL" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy"></iframe>'],
                    ["Kaltura", '<iframe id="kaltura_player" src="https://cdnapisec.kaltura.com/p/PARTNER_ID/sp/PARTNER_ID00/embedIframeJs/uiconf_id/UICONF_ID/partner_id/PARTNER_ID?iframeembed=true&playerId=kaltura_player&entry_id=ENTRY_ID" width="560" height="395" allowfullscreen></iframe>'],
                    ["Custom Block", '<div style="background:#f0f4f8;border-left:4px solid #8C1D40;padding:16px 20px;border-radius:4px;">\n  <strong>Custom Block</strong>\n  <p>Your content here.</p>\n</div>'],
                  ].map(([label, html]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setHtmlBlockDraft(html)}
                      className="rounded-lg border border-outline-variant/40 bg-white px-3 py-1.5 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              ) : null}
              <textarea
                value={htmlBlockDraft}
                onChange={(event) => setHtmlBlockDraft(event.target.value)}
                rows={12}
                className="min-h-72 w-full resize-y rounded-xl border border-outline-variant/40 bg-white px-4 py-3 font-mono text-sm leading-6 text-on-surface outline-none focus:border-primary"
                placeholder={'<iframe src="..." width="560" height="315" allowfullscreen></iframe>'}
                autoFocus
              />
              <div className="mt-4 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Preview</p>
                <div
                  className="max-h-64 overflow-auto rounded-lg bg-white p-3 text-sm text-on-surface"
                  dangerouslySetInnerHTML={{ __html: htmlBlockDraft }}
                />
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-outline-variant/30 px-5 py-4">
              <button
                type="button"
                onClick={closeHtmlBlockModal}
                className="rounded-lg bg-surface-container-low px-3 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!htmlBlockDraft.trim()}
                onClick={insertHtmlBlock}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
              >
                {htmlBlockModalMode === "edit" ? "Update HTML" : "Insert HTML"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {videoEmbedModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-on-surface/50 px-4 py-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="video-embed-title"
            className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-outline-variant/30 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Insert</p>
                <h2 id="video-embed-title" className="mt-1 font-headline text-xl font-bold text-on-surface">
                  Embed Video
                </h2>
              </div>
              <button type="button" title="Close" onClick={() => setVideoEmbedModalOpen(false)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant transition-colors hover:bg-surface-container-high">
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {videoEmbedError ? (
                <div className="mb-4 rounded-xl border border-error/30 bg-error-container px-4 py-3 text-sm font-semibold text-error">
                  {videoEmbedError}
                </div>
              ) : null}
              <label className="block text-sm font-semibold text-on-surface">
                Video URL
                <input
                  type="text"
                  value={videoEmbedUrl}
                  onChange={(event) => {
                    setVideoEmbedUrl(event.target.value);
                    setVideoEmbedError(null);
                  }}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="mt-2 h-10 w-full rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm font-normal text-on-surface outline-none focus:border-primary"
                  autoFocus
                />
              </label>
              {parseVideoEmbedUrl(videoEmbedUrl)?.embedUrl ? (
                <div className="mt-4 overflow-hidden rounded-xl bg-black" style={{ position: "relative", paddingBottom: "56.25%", height: 0 }}>
                  <iframe src={parseVideoEmbedUrl(videoEmbedUrl)?.embedUrl} className="absolute inset-0 h-full w-full border-0" allowFullScreen title="Video preview" />
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-outline-variant/30 px-5 py-4">
              <button type="button" onClick={() => setVideoEmbedModalOpen(false)} className="rounded-lg bg-surface-container-low px-3 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high">
                Cancel
              </button>
              <button type="button" onClick={insertVideoEmbed} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container">
                Insert Video
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {latexModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-on-surface/50 px-4 py-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="latex-title"
            className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-outline-variant/30 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                  {latexModalMode === "edit" ? "Edit" : "Insert"}
                </p>
                <h2 id="latex-title" className="mt-1 font-headline text-xl font-bold text-on-surface">
                  {latexModalMode === "edit" ? "Edit Equation" : "LaTeX Equation"}
                </h2>
              </div>
              <button type="button" title="Close" onClick={closeLatexModal} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant transition-colors hover:bg-surface-container-high">
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {latexError ? (
                <div className="mb-4 rounded-xl border border-error/30 bg-error-container px-4 py-3 text-sm font-semibold text-error">
                  {latexError}
                </div>
              ) : null}
              <div className="mb-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => setLatexDisplayMode(true)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${latexDisplayMode ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface"}`}>
                  Display
                </button>
                <button type="button" onClick={() => setLatexDisplayMode(false)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${!latexDisplayMode ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface"}`}>
                  Inline
                </button>
              </div>
              <label className="block text-sm font-semibold text-on-surface">
                Equation
                <textarea
                  ref={latexTextareaRef}
                  value={latexDraft}
                  onChange={(event) => {
                    setLatexDraft(event.target.value);
                    setLatexError(null);
                  }}
                  rows={6}
                  placeholder="E = mc^2"
                  className="mt-2 w-full resize-y rounded-xl border border-outline-variant/40 bg-white px-3 py-2 font-mono text-sm font-normal text-on-surface outline-none focus:border-primary"
                  autoFocus
                />
              </label>
              <div className="mt-4 space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Operations</p>
                {LATEX_OPERATION_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="mb-2 text-xs font-semibold text-on-surface-variant">{group.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {group.items.map((item) => (
                        <button
                          key={`${group.label}-${item.label}`}
                          type="button"
                          onClick={() => insertLatexSnippet(item.value)}
                          className="group relative inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-outline-variant/40 bg-white px-2.5 font-mono text-base font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
                          aria-label={`${item.label}: ${item.value}`}
                          title={`${item.label}: ${item.value}`}
                        >
                          {item.symbol}
                          <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-on-surface px-2 py-1 font-sans text-[11px] font-semibold text-surface-container-lowest shadow-lg group-hover:block">
                            {item.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Preview</p>
                <div
                  className="rounded-lg bg-white p-3 font-serif text-lg text-on-surface"
                  style={{ textAlign: latexDisplayMode ? "center" : "left" }}
                  dangerouslySetInnerHTML={{ __html: latexDraft.trim() ? renderLatexDisplay(latexDraft) : "Enter an equation above." }}
                />
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-outline-variant/30 px-5 py-4">
              <button type="button" onClick={closeLatexModal} className="rounded-lg bg-surface-container-low px-3 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high">
                Cancel
              </button>
              <button type="button" onClick={insertLatexBlock} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container">
                {latexModalMode === "edit" ? "Update Equation" : "Insert Equation"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {imageReview ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-on-surface/50 px-4 py-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="image-review-title"
            className="flex h-[min(92vh,820px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl lg:grid lg:grid-cols-[minmax(320px,0.9fr)_minmax(360px,1fr)]"
          >
            <div className="flex min-h-0 flex-none items-center justify-center bg-surface-container-low p-3 lg:h-full lg:flex-auto lg:p-4">
              <div className="flex h-[clamp(180px,30vh,280px)] w-full items-center justify-center rounded-xl border border-outline-variant/30 bg-white p-2 lg:h-full">
                {/* eslint-disable-next-line @next/next/no-img-element -- Canvas upload previews use authenticated, arbitrary Canvas file URLs. */}
                <img
                  src={imageReview.src}
                  alt=""
                  className="h-full max-h-full w-full max-w-full object-contain"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                  Uploaded Image
                </p>
                <h2 id="image-review-title" className="mt-1 font-headline text-xl font-bold text-on-surface">
                  Add Accessibility Text
                </h2>
                <p className="mt-1 text-sm text-on-surface-variant">
                  This image was uploaded to Canvas Files. Add alt text or mark it decorative before inserting
                  {imageReview.insertMode !== "image" ? ` the ${managedImageBlockLabel(imageReview.insertMode)} block` : " it"} into the draft.
                </p>
              </div>

              {imageReviewError ? (
                <div className="mt-4 rounded-xl border border-error/30 bg-error-container px-4 py-3 text-sm font-semibold text-error">
                  {imageReviewError}
                </div>
              ) : null}

              <label className="mt-5 flex items-start gap-3 rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3">
                <input
                  type="checkbox"
                  checked={imageReviewDecorative}
                  onChange={(event) => {
                    setImageReviewDecorative(event.target.checked);
                    if (event.target.checked) setImageReviewAlt("");
                  }}
                  className="mt-1 h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
                />
                <span>
                  <span className="block text-sm font-semibold text-on-surface">Decorative image</span>
                  <span className="block text-xs text-on-surface-variant">
                    Decorative images are inserted with empty alt text and presentation role.
                  </span>
                </span>
              </label>

              <div className="mt-4">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="uploaded-image-alt" className="text-sm font-semibold text-on-surface">
                    Alt text
                  </label>
                  <button
                    type="button"
                    disabled={imageReviewDecorative || Boolean(imageReviewGenerating) || imageReviewSaving}
                    onClick={() => void generateImageReviewText("alt")}
                    className="rounded-md bg-secondary-container px-2.5 py-1.5 text-xs font-semibold text-on-secondary-container transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {imageReviewGenerating === "alt" ? "Generating..." : "Generate"}
                  </button>
                </div>
                <textarea
                  id="uploaded-image-alt"
                  value={imageReviewAlt}
                  disabled={imageReviewDecorative}
                  onChange={(event) => setImageReviewAlt(event.target.value)}
                  rows={4}
                  className="mt-2 w-full resize-y rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary disabled:opacity-50"
                  placeholder={imageReviewDecorative ? "Decorative images use empty alt text." : "Describe the image for someone who cannot see it."}
                />
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="uploaded-image-long-description" className="text-sm font-semibold text-on-surface">
                    Long description
                  </label>
                  <button
                    type="button"
                    disabled={imageReviewDecorative || Boolean(imageReviewGenerating) || imageReviewSaving}
                    onClick={() => void generateImageReviewText("long_desc")}
                    className="rounded-md bg-secondary-container px-2.5 py-1.5 text-xs font-semibold text-on-secondary-container transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {imageReviewGenerating === "long_desc" ? "Generating..." : "Generate"}
                  </button>
                </div>
                <textarea
                  id="uploaded-image-long-description"
                  value={imageReviewLongDescription}
                  disabled={imageReviewDecorative}
                  onChange={(event) => setImageReviewLongDescription(event.target.value)}
                  rows={5}
                  className="mt-2 w-full resize-y rounded-xl border border-outline-variant/40 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary disabled:opacity-50"
                  placeholder="Optional for complex images, charts, diagrams, or screenshots."
                />
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-outline-variant/30 pt-4">
                <button
                  type="button"
                  disabled={imageReviewSaving || Boolean(imageReviewGenerating)}
                  onClick={() => {
                    setImageReview(null);
                    setImageReviewAlt("");
                    setImageReviewLongDescription("");
                    setImageReviewDecorative(false);
                    setImageReviewError(null);
                    pendingImageInsertModeRef.current = "image";
                  }}
                  className="rounded-lg bg-surface-container-low px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={imageReviewDecorative || Boolean(imageReviewGenerating) || imageReviewSaving}
                  onClick={() => void generateImageReviewText("both")}
                  className="rounded-lg bg-surface-container-low px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {imageReviewGenerating === "both" ? "Generating..." : "Generate Both"}
                </button>
                <button
                  type="button"
                  disabled={imageReviewSaving || Boolean(imageReviewGenerating) || (!imageReviewDecorative && !imageReviewAlt.trim())}
                  onClick={() => void saveReviewedImageAndInsert()}
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {imageReviewSaving ? "Saving..." : imageReview.insertMode !== "image" ? "Save and Insert Block" : "Save and Insert"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-6 mt-3 flex-none rounded-xl border border-outline-variant/30 bg-surface-container-low px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            ref={reviewTriggerRef}
            type="button"
            onClick={() => setReviewExpanded(true)}
            aria-haspopup="dialog"
            aria-expanded={reviewExpanded}
            className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-on-surface"
          >
            <span className="font-semibold">Pending Review</span>
            <span className="truncate text-xs text-on-surface-variant">
              {pendingLoading
                ? "Checking..."
                : pendingChanges?.counts.total
                  ? `${pendingChanges.counts.content} content / ${pendingChanges.counts.modules} module pending`
                  : "No pending changes"}
            </span>
            {selectedPendingChange ? (
              <span className="rounded-full bg-secondary-container px-2 py-0.5 text-[11px] font-semibold text-on-secondary-container">
                This item
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => void loadPendingChanges()}
            className="rounded-lg bg-surface-container-high px-2.5 py-1.5 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-dim"
          >
            Refresh
          </button>
        </div>
      </div>

      {reviewExpanded ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/45 px-4 py-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePendingReview();
          }}
        >
          <div
            ref={reviewDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pending-review-title"
            className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl"
          >
            <div className="flex flex-none items-start justify-between gap-4 border-b border-outline-variant/30 px-6 py-4">
              <div>
                <h2 id="pending-review-title" className="font-headline text-xl font-bold text-on-surface">
                  Pending Review
                </h2>
                <p className="mt-1 text-sm text-on-surface-variant">
                  {pendingLoading
                    ? "Checking pending changes..."
                    : pendingChanges?.counts.total
                      ? `${pendingChanges.counts.content} content / ${pendingChanges.counts.modules} module pending`
                      : "No pending changes"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refreshPendingReview()}
                  className="rounded-lg bg-surface-container-low px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
                >
                  Refresh
                </button>
                <button
                  ref={reviewCloseRef}
                  type="button"
                  onClick={closePendingReview}
                  className="rounded-lg bg-surface-container-low px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
              {reviewMessage ? (
                <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-sm font-semibold text-on-surface">
                  {reviewMessage}
                </div>
              ) : null}
              {!pendingLoading && !pendingChanges?.counts.total ? (
                <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-8 text-center text-sm text-on-surface-variant">
                  No pending content or module changes are waiting for review.
                </div>
              ) : null}
              {selectedPendingChange ? (
                <div className="grid gap-3 rounded-xl border border-outline-variant/30 bg-white px-4 py-3 text-sm text-on-surface md:grid-cols-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                      This item
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <p className="font-semibold">Revision {selectedPendingChange.latest_revision_number}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(selectedPendingChange.review_status)}`}>
                        {selectedPendingChange.review_status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-on-surface-variant">{formatDate(selectedPendingChange.latest_changed_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                      Changes
                    </p>
                    <p className="mt-1">{formatFieldList(selectedPendingChange.affected_fields)}</p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {selectedPendingChange.diff_summary} · {selectedPendingChange.word_delta >= 0 ? "+" : ""}
                      {selectedPendingChange.word_delta} words
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                      Summary
                    </p>
                    <p className="mt-1 line-clamp-2">
                      {selectedPendingChange.change_summary || "No summary provided."}
                    </p>
                  </div>
                  {selectedPendingChange.has_changes ? (
                    <div className="md:col-span-3">
                      <button
                        type="button"
                        onClick={() => void togglePendingDiff()}
                        disabled={diffLoading}
                        className="rounded-lg bg-surface-container-low px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
                      >
                        {diffLoading ? "Loading Diff..." : diffExpanded ? "Hide Diff" : "Show Diff"}
                      </button>
                      {diffExpanded && pendingDiff?.unified_diff ? (
                        <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-[#101820] p-3 font-mono text-[11px] leading-5 text-slate-200">
                          {pendingDiff.unified_diff.split("\n").map((line, index) => {
                            const color = line.startsWith("+") && !line.startsWith("+++")
                              ? "text-green-300"
                              : line.startsWith("-") && !line.startsWith("---")
                                ? "text-red-300"
                                : line.startsWith("@@")
                                  ? "text-blue-300"
                                  : "text-slate-300";
                            return (
                              <span key={`${index}-${line}`} className={`block whitespace-pre-wrap break-all ${color}`}>
                                {line || " "}
                              </span>
                            );
                          })}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {pendingChanges?.content_changes.length ? (
                <div className="rounded-xl border border-outline-variant/30 bg-white px-4 py-3 text-sm text-on-surface">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label="Select all content changes"
                        checked={pendingChanges.content_changes.every((change) => selectedContentPushIds.has(change.content_item_id))}
                        onChange={toggleAllContentPushSelection}
                        className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
                      />
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                        Content Changes
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span className="text-xs text-on-surface-variant">
                        {selectedContentPushIds.size
                          ? `${selectedContentPushIds.size} selected`
                          : `${pendingChanges.content_changes.length} ready item${pendingChanges.content_changes.length === 1 ? "" : "s"}`}
                      </span>
                      <button
                        type="button"
                        onClick={pushSelectedContentChanges}
                        disabled={batchPushing || selectedContentPushIds.size === 0}
                        className="rounded-md bg-secondary-container px-2.5 py-1.5 text-xs font-semibold text-on-secondary-container transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Push selected
                      </button>
                      <button
                        type="button"
                        onClick={() => void pushPendingContentChanges()}
                        disabled={batchPushing || (isDirty && pendingChanges.content_changes.some((change) => change.content_item_id === item.id))}
                        className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {batchPushing ? "Pushing..." : "Push all"}
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 space-y-2">
                    {pendingChanges.content_changes.map((change) => {
                      const active = change.content_item_id === item.id;
                      const rowState = batchPushState[change.content_item_id];
                      return (
                        <div
                          key={change.content_item_id}
                          className={`rounded-lg px-3 py-2 ${active ? "bg-primary/5 ring-1 ring-primary/20" : "bg-surface-container-low"}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 gap-2">
                              <input
                                type="checkbox"
                                aria-label={`Select ${change.title || "untitled content"} for push`}
                                checked={selectedContentPushIds.has(change.content_item_id)}
                                onChange={() => toggleContentPushSelection(change.content_item_id)}
                                className="mt-0.5 h-4 w-4 flex-none rounded border-outline-variant text-primary focus:ring-primary"
                              />
                              <div className="min-w-0">
                                <p className="line-clamp-1 text-sm font-semibold text-on-surface">
                                  {change.title || "Untitled content"}
                                </p>
                                <p className="mt-0.5 text-xs text-on-surface-variant">
                                  {change.content_type}
                                  {change.module_name ? ` / ${change.module_name}` : ""} / {formatFieldList(change.affected_fields)}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-none flex-col items-end gap-1">
                              <div className="flex flex-wrap justify-end gap-1">
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(change.review_status)}`}>
                                  {active ? "This item" : change.review_status}
                                </span>
                                <button
                                  type="button"
                                  disabled={batchPushing || (active && isDirty)}
                                  onClick={() => void pushPendingContentChanges([change])}
                                  className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {rowState?.status === "pushing" ? "Pushing..." : "Push"}
                                </button>
                              </div>
                              {rowState ? (
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${batchStatusClass(rowState)}`}
                                  title={rowState.message}
                                >
                                  {batchStatusLabel(rowState)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          {rowState?.status === "failed" && rowState.message ? (
                            <div className="mt-2 rounded-lg border border-error/30 bg-error-container px-3 py-2 text-xs font-semibold text-error">
                              {rowState.message}
                            </div>
                          ) : null}
                          <p className="mt-1 line-clamp-2 text-xs text-on-surface-variant">
                            {change.change_summary || change.diff_summary}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {pendingChanges?.module_changes.length ? (
                <div className="rounded-xl border border-outline-variant/30 bg-white px-4 py-3 text-sm text-on-surface">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                      Module Operations
                    </p>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={Boolean(moduleOperationBusyId) || applyingModuleOperations}
                        onClick={() => void applyModuleOperations()}
                        className="rounded-md bg-secondary-container px-2.5 py-1.5 text-xs font-semibold text-on-secondary-container transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {applyingModuleOperations ? "Applying..." : "Apply all"}
                      </button>
                      <button
                        type="button"
                        disabled={moduleOperationBusyId === "all" || applyingModuleOperations}
                        onClick={() => void discardAllModuleOperations()}
                        className="rounded-md bg-surface-container-low px-2.5 py-1.5 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {moduleOperationBusyId === "all" ? "Discarding..." : "Discard all"}
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 space-y-2">
                    {pendingChanges.module_changes.map((change) => {
                      const compareRows = moduleOperationCompareRows(change);
                      const canApplyIndividually = canApplyModuleOperationIndividually(change.operation_type);
                      const operationBusy = moduleOperationBusyId === change.id || moduleOperationBusyId === `apply:${change.id}`;
                      return (
                        <div
                          key={change.id}
                          className={`rounded-lg border px-3 py-3 ${moduleOperationToneClass(change.operation_type)}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-on-surface">{change.action_label}</p>
                              <p className="mt-0.5 line-clamp-2 text-xs text-on-surface-variant">
                                {change.detail || change.title || "Module item change"}
                              </p>
                            </div>
                            <div className="flex flex-none items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${moduleOperationBadgeClass(change.operation_type)}`}>
                                {change.review_status}
                              </span>
                              {canApplyIndividually ? (
                                <button
                                  type="button"
                                  disabled={operationBusy || applyingModuleOperations}
                                  onClick={() => void applyModuleOperations([change.id])}
                                  className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {moduleOperationBusyId === `apply:${change.id}` ? "Applying..." : "Apply"}
                                </button>
                              ) : (
                                <span className="rounded-md bg-white/70 px-2 py-1 text-[11px] font-semibold text-on-surface-variant">
                                  Batch only
                                </span>
                              )}
                              <button
                                type="button"
                                disabled={operationBusy}
                                onClick={() => void discardModuleOperation(change.id)}
                                className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {moduleOperationBusyId === change.id ? "..." : "Discard"}
                              </button>
                            </div>
                          </div>
                          {compareRows.length ? (
                            <div className="mt-3 grid gap-2">
                              {compareRows.map((row) => (
                                <div
                                  key={row.label}
                                  className="grid gap-2 rounded-md bg-white/80 px-3 py-2 text-xs md:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)]"
                                >
                                  <p className="font-semibold text-on-surface-variant">{row.label}</p>
                                  <p className="min-w-0 truncate text-on-surface-variant">
                                    <span className="font-semibold">Before:</span> {formatModuleValue(row.before)}
                                  </p>
                                  <p className="min-w-0 truncate text-on-surface">
                                    <span className="font-semibold">After:</span> {formatModuleValue(row.after)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <div className="rounded-xl border border-outline-variant/30 bg-white px-4 py-3 text-sm text-on-surface">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                    Recent Content Pushes
                  </p>
                </div>
                {pushHistoryLoading ? (
                  <p className="mt-3 text-sm text-on-surface-variant">Loading recent pushes...</p>
                ) : pushHistoryError ? (
                  <p className="mt-3 text-sm text-on-surface-variant">
                    Push history is not available from the current API yet.
                  </p>
                ) : pushHistory.length ? (
                  <div className="mt-2 divide-y divide-outline-variant/20">
                    {pushHistory.map((historyItem) => {
                      const revisionLabel = pushRevisionLabel(historyItem);
                      return (
                        <div key={historyItem.id} className="flex items-start justify-between gap-3 py-2">
                          <div className="min-w-0">
                            <p className="line-clamp-1 text-sm font-semibold text-on-surface">
                              {historyItem.title || "Untitled content"}
                            </p>
                            <p className="mt-0.5 text-xs text-on-surface-variant">
                              {contentTypeLabel(historyItem.content_type)}
                              {historyItem.batch_id ? " / batch push" : " / single push"}
                              {historyItem.canvas_id ? ` / Canvas ID ${historyItem.canvas_id}` : ""}
                            </p>
                            {revisionLabel ? (
                              <p className="mt-1 line-clamp-1 text-xs font-semibold text-on-surface">
                                {revisionLabel}
                              </p>
                            ) : null}
                            {historyItem.latest_change_summary ? (
                              <p className="mt-0.5 line-clamp-2 text-xs text-on-surface-variant">
                                {historyItem.latest_change_summary}
                                {historyItem.change_summaries.length > 1
                                  ? ` + ${historyItem.change_summaries.length - 1} earlier change${historyItem.change_summaries.length === 2 ? "" : "s"}`
                                  : ""}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex flex-none flex-col items-end gap-1 text-right">
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                              Pushed
                            </span>
                            <span className="text-[11px] text-on-surface-variant">
                              {formatDate(historyItem.created_at)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-on-surface-variant">No content pushes recorded yet.</p>
                )}
              </div>
              <div className="rounded-xl border border-outline-variant/30 bg-white px-4 py-3 text-sm text-on-surface">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                    Recent Module Updates
                  </p>
                </div>
                {moduleApplyHistoryLoading ? (
                  <p className="mt-3 text-sm text-on-surface-variant">Loading recent module updates...</p>
                ) : moduleApplyHistoryError ? (
                  <p className="mt-3 text-sm text-on-surface-variant">
                    Module update history is not available from the current API yet.
                  </p>
                ) : moduleApplyHistory.length ? (
                  <div className="mt-2 divide-y divide-outline-variant/20">
                    {moduleApplyHistory.map((historyItem) => {
                      const firstOperation = historyItem.operations[0];
                      const extraCount = Math.max(0, historyItem.applied_count - 1);
                      return (
                        <div key={historyItem.id} className="flex items-start justify-between gap-3 py-2">
                          <div className="min-w-0">
                            <p className="line-clamp-1 text-sm font-semibold text-on-surface">
                              {firstOperation?.title || `${historyItem.applied_count} module update${historyItem.applied_count === 1 ? "" : "s"}`}
                            </p>
                            <p className="mt-0.5 text-xs text-on-surface-variant">
                              {firstOperation
                                ? `${moduleOperationTypeLabel(firstOperation.operation_type)}${extraCount ? ` / +${extraCount} more` : ""}`
                                : `${historyItem.operation_ids.length || historyItem.applied_count} operation${(historyItem.operation_ids.length || historyItem.applied_count) === 1 ? "" : "s"}`}
                              {historyItem.failed_count ? ` / ${historyItem.failed_count} failed` : ""}
                            </p>
                          </div>
                          <div className="flex flex-none flex-col items-end gap-1 text-right">
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                              Applied
                            </span>
                            <span className="text-[11px] text-on-surface-variant">
                              {formatDate(historyItem.created_at)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-on-surface-variant">No module updates recorded yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className={`min-h-0 flex-1 overflow-y-auto px-6 py-4 ${mode === "split" ? "grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]" : "block"}`}>
        {mode !== "preview" ? (
          <div className="space-y-4">
            {editorMode === "rich" ? (
              <div className="relative">
                <EditorContent
                  ref={richEditorWrapperRef}
                  editor={editor}
                  className="canvas-editor rounded-2xl bg-surface-container-low p-3"
                />
                <AISelectionToolbar editor={editor} sessionId={sessionId} />
              </div>
            ) : (
              <textarea
                ref={htmlTextareaRef}
                value={currentHtml}
                onChange={(event) => setCurrentHtml(event.target.value)}
                className="min-h-[720px] w-full rounded-2xl border border-outline-variant/40 bg-white px-5 py-4 font-mono text-sm leading-6 text-on-surface outline-none focus:border-primary"
              />
            )}
          </div>
        ) : null}

        {mode !== "edit" ? (
          <iframe
            title={`${item.title || "Content"} preview`}
            srcDoc={previewSrcDoc}
            className="min-h-[640px] w-full rounded-2xl border border-outline-variant/40 bg-white"
          />
        ) : null}

        {mode !== "preview" ? (
          <div className={mode === "split" ? "xl:col-span-2" : ""}>
            <label className="mt-5 block text-sm text-on-surface">
              <span className="mb-1 block font-semibold">Change Summary</span>
              <input
                type="text"
                value={changeSummary}
                onChange={(event) => setChangeSummary(event.target.value)}
                placeholder="Optional note describing what changed in this revision."
                className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none focus:border-primary"
              />
            </label>
          </div>
        ) : null}

        {item.content_type === "quiz" ? (
          <div className={mode === "split" ? "xl:col-span-2" : ""}>
            <QuizQuestionsPanel
              contentItemId={item.id}
              editing={mode !== "preview"}
              sessionId={sessionId}
            />
          </div>
        ) : null}

      <div className={`mt-6 border-t border-outline-variant/30 py-5 ${mode === "split" ? "xl:col-span-2" : ""}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
              Revisions
            </p>
            <p className="mt-1 text-sm text-on-surface-variant">
              Saved changes are versioned per content item.
            </p>
          </div>
        </div>

        {revisionsLoading ? (
          <div className="mt-4 text-sm text-on-surface-variant">Loading revisions…</div>
        ) : revisions.length === 0 ? (
          <div className="mt-4 text-sm text-on-surface-variant">No revisions saved for this item yet.</div>
        ) : (
          <div className="mt-4 space-y-3">
            {revisions.map((revision) => (
              <div key={revision.id} className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-on-surface">
                    Revision {revision.revision_number}
                  </div>
                  <div className="text-xs text-on-surface-variant">
                    {formatDate(revision.created_at)}
                  </div>
                </div>
                <div className="mt-2 text-sm text-on-surface-variant">
                  {revision.change_summary || "No summary provided."}
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={restoringRevisionId === revision.id}
                    onClick={() => void restoreRevision(revision.id, revision.revision_number)}
                    className="rounded-lg bg-surface-container-high px-3 py-2 text-sm font-semibold text-on-surface hover:bg-surface-dim transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {restoringRevisionId === revision.id ? "Restoring…" : "Restore"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
