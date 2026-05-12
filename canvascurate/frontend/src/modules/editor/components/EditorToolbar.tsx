"use client";

/**
 * Main editor toolbar for formatting, insert actions, and editor-mode tools.
 *
 * The workspace owns editor state and persistence; this component owns the
 * toolbar UI, transient toolbar menus, and toolbar-local insert dialogs.
 */

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlertTriangle,
  Bold,
  ChevronDown,
  Code2,
  Eraser,
  FileUp,
  Highlighter,
  ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Info,
  Italic,
  Lightbulb,
  LinkIcon,
  List,
  ListOrdered,
  Minus,
  Palette,
  PanelTopOpen,
  Quote,
  Redo2,
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
} from "lucide-react";

import { Alert, Button, Input, Modal, ModalBody, ModalFooter } from "@/components/edplus";
import {
  ColorSwatchPopover,
  ToolbarButton,
  ToolbarCluster,
  ToolbarDivider,
  ToolbarDropdownItem,
  ToolbarLevel,
} from "@/modules/editor/components/ToolbarPrimitives";
import {
  buildColumnLayoutHtml,
  buildCtaButtonHtml,
  buildManagedContentBlockHtml,
  normalizeCtaUrl,
  type ManagedContentBlockMode,
  type ManagedImageInsertMode,
} from "@/modules/editor/utils/contentBlocks";
import {
  applyPillStyle,
  buildStyledTableHtml,
  styleValue,
  updateBlockIndent,
  updateInlineStyle,
} from "@/modules/editor/utils/toolbar";

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

type EditorToolbarProps = {
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
};

export function EditorToolbar({
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
}: EditorToolbarProps) {
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
              <ToolbarButton label="Upload image" disabled={uploadingImage} onClick={() => uploadImage("image")}>{uploadingImage ? "..." : <ImageIcon size={16} />}</ToolbarButton>
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
              <ToolbarDivider />
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
        <Modal
          open
          onOpenChange={(open) => { if (!open) setCtaModalOpen(false); }}
          title="CTA Button"
          subtitle="Insert"
          size="sm"
        >
          <ModalBody>
            {ctaError ? <Alert variant="error">{ctaError}</Alert> : null}
            <Input
              label="Button text"
              type="text"
              value={ctaLabel}
              onChange={(event) => setCtaLabel(event.target.value)}
              autoFocus
              fullWidth
            />
            <Input
              label="URL"
              type="text"
              value={ctaUrl}
              onChange={(event) => {
                setCtaUrl(event.target.value);
                setCtaError(null);
              }}
              placeholder="https://example.edu"
              fullWidth
            />
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setCtaModalOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={insertCtaButtonBlock}>
              Insert Button
            </Button>
          </ModalFooter>
        </Modal>
      ) : null}
    </>
  );
}
