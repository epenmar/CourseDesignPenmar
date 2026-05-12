"use client";

/**
 * Slash command menu for quick editor insertion and formatting actions.
 *
 * The workspace owns when the menu opens; this component owns command filtering,
 * keyboard navigation, and toolbar-like insert actions triggered from `/`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { X } from "lucide-react";

import {
  buildColumnLayoutHtml,
  buildCtaButtonHtml,
  buildManagedContentBlockHtml,
  normalizeCtaUrl,
  type ManagedImageInsertMode,
} from "@/modules/editor/utils/contentBlocks";
import {
  buildStyledTableHtml,
  updateBlockIndent,
  updateInlineStyle,
} from "@/modules/editor/utils/toolbar";

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

export function SlashCommandMenu({
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
          event.preventDefault();
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
