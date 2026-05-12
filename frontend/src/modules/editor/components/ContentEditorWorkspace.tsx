"use client";

/**
 * Main Canvas content editor workspace.
 *
 * This file currently owns the Tiptap editor configuration, toolbar UI,
 * modal surfaces, and Canvas content save/push orchestration. It lives under
 * `modules/editor` so those pieces can be extracted behind a feature boundary
 * without changing the route-level import.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { TableRow } from "@tiptap/extension-table-row";
import { Selection } from "@tiptap/pm/state";
import { Flag, Maximize2, Minimize2 } from "lucide-react";
import { useRouter } from "next/navigation";

import Button from "@/components/edplus/Button";
import { createClient } from "@/lib/supabase/client";
import { QuizQuestionsPanel } from "@/components/ui/QuizQuestionsPanel";
import { AccessibilityCheckPanel } from "@/modules/editor/components/AccessibilityCheckPanel";
import { AIGenerateModal } from "@/modules/editor/components/AIGenerateModal";
import { AISelectionToolbar } from "@/modules/editor/components/AISelectionToolbar";
import { EditorToolbar } from "@/modules/editor/components/EditorToolbar";
import { FindReplaceBar } from "@/modules/editor/components/FindReplaceBar";
import { HtmlBlockModal } from "@/modules/editor/components/HtmlBlockModal";
import { ImageReviewModal } from "@/modules/editor/components/ImageReviewModal";
import { IdentifyIssueModal } from "@/modules/editor/components/IdentifyIssueModal";
import { LatexModal } from "@/modules/editor/components/LatexModal";
import { RevisionHistoryPanel } from "@/modules/editor/components/RevisionHistoryPanel";
import { SlashCommandMenu } from "@/modules/editor/components/SlashCommandMenu";
import { VideoEmbedModal } from "@/modules/editor/components/VideoEmbedModal";
import { AccordionBlock, AccordionContent, AccordionSummary } from "@/modules/editor/extensions/AccordionBlock";
import { CalloutBlock } from "@/modules/editor/extensions/CalloutBlock";
import { CanvasLink } from "@/modules/editor/extensions/CanvasLink";
import { CanvasAnchor, CanvasDiv } from "@/modules/editor/extensions/CanvasStructure";
import { CanvasTable, CanvasTableCell, CanvasTableHeader } from "@/modules/editor/extensions/CanvasTable";
import { HtmlBlock, type HtmlBlockEditRequest, type LatexBlockEditRequest } from "@/modules/editor/extensions/HtmlBlock";
import { PreserveStyles } from "@/modules/editor/extensions/PreserveStyles";
import { ResizableCanvasImage } from "@/modules/editor/extensions/ResizableCanvasImage";
import { SpanStyle, SubscriptMark, SuperscriptMark } from "@/modules/editor/extensions/SpanStyle";
import { StyledSeparator } from "@/modules/editor/extensions/StyledSeparator";
import { useEditorAI } from "@/modules/editor/hooks/useEditorAI";
import { useEditorContentSave } from "@/modules/editor/hooks/useEditorContentSave";
import { useEditorFindReplace } from "@/modules/editor/hooks/useEditorFindReplace";
import { useEditorIdentifyIssue } from "@/modules/editor/hooks/useEditorIdentifyIssue";
import { useEditorUploads } from "@/modules/editor/hooks/useEditorUploads";
import type { ContentEditorItem } from "@/modules/editor/types";
import {
  buildLatexHtml,
  buildVideoEmbedHtml,
  parseVideoEmbedUrl,
} from "@/modules/editor/utils/contentBlocks";
import { escapeAttribute, escapeHtml, serializeHtmlBlocks } from "@/modules/editor/utils/html";
import { previewDocument } from "@/modules/editor/utils/preview";

export type { ContentEditorItem } from "@/modules/editor/types";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    calloutBlock: {
      insertCallout: (type?: string) => ReturnType;
      setCalloutType: (type: string) => ReturnType;
    };
    accordionBlock: {
      insertAccordion: () => ReturnType;
    };
    styledSeparator: {
      insertStyledSeparator: (variant?: string) => ReturnType;
    };
    resizableImage: {
      setImageSize: (attrs: Record<string, unknown>) => ReturnType;
    };
  }
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

async function getAccessToken() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
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
  const [accessibilityCheckOpen, setAccessibilityCheckOpen] = useState(false);
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
  const pendingHtmlBlockUpdateRef = useRef<HtmlBlockEditRequest["update"] | null>(null);
  const pendingLatexBlockUpdateRef = useRef<LatexBlockEditRequest["update"] | null>(null);
  const htmlTextareaRef = useRef<HTMLTextAreaElement>(null);
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

  const refreshRoute = useCallback(() => {
    router.refresh();
  }, [router]);

  const {
    applySavedContentResponse,
    isDirty,
    pushing,
    pushToCanvas,
    refreshLocalRevisions,
    restoringRevisionId,
    restoreRevision,
    revisions,
    revisionsLoading,
    saveChanges,
    saving,
  } = useEditorContentSave({
    changeSummary,
    currentHtml,
    editor,
    editorMode,
    getAccessToken,
    item,
    refreshRoute,
    savedHtml,
    savedTitle,
    sessionId,
    setChangeSummary,
    setCurrentHtml,
    setCanvasUrl,
    setMessage,
    setSavedHtml,
    setSavedTitle,
    setTitle,
    title,
  });

  const {
    canvasRevisionPreview,
    canvasRevisionPreviewLoading,
    canvasRevisionRestoring,
    canvasRevisions,
    canvasRevisionsLoading,
    closeIdentifyIssueModal,
    flagIssueNote,
    flagIssueSaving,
    identifyIssueMessage,
    identifyIssueMode,
    identifyIssueOpen,
    identifyIssueTab,
    loadCanvasRevisionPreview,
    loadSourceCourses,
    loadSourcePagePreview,
    openIdentifyIssueModal,
    refreshCanvasRevisions,
    replaceFromSourcePage,
    restoreCanvasRevision,
    saveIssueFlag,
    selectedCanvasRevisionId,
    selectedSourceCourse,
    selectedSourcePage,
    selectSourceCourse,
    setFlagIssueNote,
    setIdentifyIssueMode,
    setIdentifyIssueTab,
    setSourceCourseQuery,
    sourceCourseQuery,
    sourceCourses,
    sourceCoursesCursor,
    sourceCoursesLoading,
    sourcePageMatches,
    sourcePagePreview,
    sourcePagePreviewLoading,
    sourcePageReplacing,
    sourcePagesLoading,
  } = useEditorIdentifyIssue({
    applySavedContentResponse,
    getAccessToken,
    isDirty,
    item,
    refreshLocalRevisions,
    sessionId,
    setMessage,
    title,
  });

  const {
    aiGenerateContext,
    aiGenerateError,
    aiGenerateLoading,
    aiGenerateModalOpen,
    aiGeneratePreview,
    aiGeneratePrompt,
    closeAIGenerate,
    generateAIContent,
    improveAccessibilityLinkText,
    insertAIContent,
    openAIGenerate,
    rewriteSelectionWithAI,
    setAiGenerateContext,
    setAiGeneratePrompt,
  } = useEditorAI({
    editor,
    getAccessToken,
    sessionId,
    setMessage,
  });

  const {
    activeFindIndex,
    findCaseSensitive,
    findMatchCount,
    findQuery,
    replaceActiveFindMatch,
    replaceCurrentItemMatches,
    replaceValue,
    setFindCaseSensitive,
    setFindQuery,
    setReplaceValue,
    stepFindMatch,
  } = useEditorFindReplace({
    currentHtml,
    editor,
    editorMode,
    findReplaceOpen,
    htmlTextareaRef,
    onHtmlChange: setCurrentHtml,
    onMessage: setMessage,
    onReplaceAllComplete: () => setMode("edit"),
    richEditorWrapperRef,
  });

  const {
    fileUploadInputRef,
    generateImageReviewText,
    handleFileUpload,
    handleImageUpload,
    imageReview,
    imageReviewAlt,
    imageReviewDecorative,
    imageReviewError,
    imageReviewGenerating,
    imageReviewLongDescription,
    imageReviewSaving,
    imageUploadInputRef,
    resetImageReview,
    saveReviewedImageAndInsert,
    setImageReviewAlt,
    setImageReviewDecorative,
    setImageReviewLongDescription,
    uploadingFile,
    uploadingImage,
    uploadFile,
    uploadImage,
  } = useEditorUploads({
    editor,
    getAccessToken,
    insertHtmlBlockIntoDraft,
    item,
    sessionId,
    setMessage,
  });

  const previewSrcDoc = useMemo(
    () => previewDocument(currentHtml, initialPlainText, baseHref),
    [baseHref, currentHtml, initialPlainText],
  );

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

  function openAccessibilityCheck() {
    setAccessibilityCheckOpen(true);
  }

  function applyAccessibilityHtml(nextHtml: string) {
    setCurrentHtml(nextHtml);
    if (editor) {
      editor.commands.setContent(nextHtml, { emitUpdate: true });
    }
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

  function cancelEditing() {
    setTitle(savedTitle);
    setCurrentHtml(savedHtml);
    setChangeSummary("");
    setFindReplaceOpen(false);
    setSlashMenu(null);
    setHtmlBlockModalOpen(false);
    resetImageReview();
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
            <Button
              type="button"
              onClick={openIdentifyIssueModal}
              variant="ghost"
              icon={<Flag size={15} />}
            >
              Identify Issue
            </Button>
          ) : null}
          {mode === "preview" ? (
            <Button
              type="button"
              onClick={() => setMode("edit")}
            >
              Edit
            </Button>
          ) : (
            <>
              <Button
                type="button"
                onClick={cancelEditing}
                disabled={saving || pushing}
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setExpandedEditor(false);
                  setMode("preview");
                }}
                variant="ghost"
              >
                Preview
              </Button>
              <Button
                type="button"
                onClick={() => setExpandedEditor((expanded) => !expanded)}
                variant="ghost"
                icon={expandedEditor ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              >
                {expandedEditor ? "Exit Expanded" : "Expand Editor"}
              </Button>
              <Button
                type="button"
                disabled={!isDirty || saving || pushing}
                onClick={() => void saveChanges()}
                loading={saving}
              >
                {isDirty ? "Save Draft" : "Saved"}
              </Button>
              <Button
                type="button"
                disabled={isDirty || saving || pushing}
                onClick={() => void pushToCanvas()}
                loading={pushing}
                variant="secondary"
              >
                Push to Canvas
              </Button>
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
        <FindReplaceBar
          activeFindIndex={activeFindIndex}
          caseSensitive={findCaseSensitive}
          findMatchCount={findMatchCount}
          findQuery={findQuery}
          onCaseSensitiveChange={setFindCaseSensitive}
          onClose={() => setFindReplaceOpen(false)}
          onFindQueryChange={setFindQuery}
          onReplaceActive={replaceActiveFindMatch}
          onReplaceAll={replaceCurrentItemMatches}
          onReplaceValueChange={setReplaceValue}
          onStepMatch={stepFindMatch}
          replaceValue={replaceValue}
        />
      ) : null}

      {message ? (
        <div className="mx-6 mt-3 flex-none rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-sm text-on-surface">
          {message}
        </div>
      ) : null}

      {identifyIssueOpen ? (
        <IdentifyIssueModal
          canvasRevisionPreview={canvasRevisionPreview}
          canvasRevisionPreviewLoading={canvasRevisionPreviewLoading}
          canvasRevisionRestoring={canvasRevisionRestoring}
          canvasRevisions={canvasRevisions}
          canvasRevisionsLoading={canvasRevisionsLoading}
          currentHtml={currentHtml}
          flagIssueNote={flagIssueNote}
          flagIssueSaving={flagIssueSaving}
          formatDate={formatDate}
          isDirty={isDirty}
          itemContentType={item.content_type}
          message={identifyIssueMessage}
          mode={identifyIssueMode}
          onClose={closeIdentifyIssueModal}
          onFlagIssueNoteChange={setFlagIssueNote}
          onLoadCanvasRevisionPreview={(revisionId) => void loadCanvasRevisionPreview(revisionId)}
          onLoadSourceCourses={(query, options) => void loadSourceCourses(query, options)}
          onLoadSourcePagePreview={(page) => void loadSourcePagePreview(page)}
          onModeChange={setIdentifyIssueMode}
          onRefreshCanvasRevisions={refreshCanvasRevisions}
          onReplaceFromSourcePage={() => void replaceFromSourcePage()}
          onRestoreCanvasRevision={() => void restoreCanvasRevision()}
          onSaveIssueFlag={() => void saveIssueFlag()}
          onSelectSourceCourse={(course) => void selectSourceCourse(course)}
          onSourceCourseQueryChange={setSourceCourseQuery}
          onTabChange={setIdentifyIssueTab}
          selectedCanvasRevisionId={selectedCanvasRevisionId}
          selectedSourceCourse={selectedSourceCourse}
          selectedSourcePage={selectedSourcePage}
          sourceCourseQuery={sourceCourseQuery}
          sourceCourses={sourceCourses}
          sourceCoursesCursor={sourceCoursesCursor}
          sourceCoursesLoading={sourceCoursesLoading}
          sourcePageMatches={sourcePageMatches}
          sourcePagePreview={sourcePagePreview}
          sourcePagePreviewLoading={sourcePagePreviewLoading}
          sourcePageReplacing={sourcePageReplacing}
          sourcePagesLoading={sourcePagesLoading}
          tab={identifyIssueTab}
        />
      ) : null}

      {accessibilityCheckOpen ? (
        <AccessibilityCheckPanel
          currentHtml={currentHtml}
          editor={editor}
          editorMode={editorMode}
          onApplyHtml={applyAccessibilityHtml}
          onClose={() => setAccessibilityCheckOpen(false)}
          onImproveLinkText={improveAccessibilityLinkText}
          sessionId={sessionId}
        />
      ) : null}

      {aiGenerateModalOpen ? (
        <AIGenerateModal
          context={aiGenerateContext}
          error={aiGenerateError}
          loading={aiGenerateLoading}
          onClose={closeAIGenerate}
          onContextChange={setAiGenerateContext}
          onInsert={insertAIContent}
          onPreviewGenerate={() => void generateAIContent()}
          onPromptChange={setAiGeneratePrompt}
          preview={aiGeneratePreview}
          prompt={aiGeneratePrompt}
        />
      ) : null}

      {htmlBlockModalOpen ? (
        <HtmlBlockModal
          draft={htmlBlockDraft}
          mode={htmlBlockModalMode}
          onClose={closeHtmlBlockModal}
          onDraftChange={setHtmlBlockDraft}
          onSubmit={insertHtmlBlock}
        />
      ) : null}

      {videoEmbedModalOpen ? (
        <VideoEmbedModal
          error={videoEmbedError}
          onClose={() => setVideoEmbedModalOpen(false)}
          onErrorChange={setVideoEmbedError}
          onSubmit={insertVideoEmbed}
          onUrlChange={setVideoEmbedUrl}
          url={videoEmbedUrl}
        />
      ) : null}

      {latexModalOpen ? (
        <LatexModal
          displayMode={latexDisplayMode}
          draft={latexDraft}
          error={latexError}
          mode={latexModalMode}
          onClose={closeLatexModal}
          onDisplayModeChange={setLatexDisplayMode}
          onDraftChange={setLatexDraft}
          onErrorChange={setLatexError}
          onSubmit={insertLatexBlock}
        />
      ) : null}

      {imageReview ? (
        <ImageReviewModal
          altText={imageReviewAlt}
          decorative={imageReviewDecorative}
          error={imageReviewError}
          generating={imageReviewGenerating}
          imageReview={imageReview}
          longDescription={imageReviewLongDescription}
          onAltTextChange={setImageReviewAlt}
          onCancel={resetImageReview}
          onDecorativeChange={(checked) => {
            setImageReviewDecorative(checked);
            if (checked) setImageReviewAlt("");
          }}
          onGenerate={(mode) => void generateImageReviewText(mode)}
          onLongDescriptionChange={setImageReviewLongDescription}
          onSave={() => void saveReviewedImageAndInsert()}
          saving={imageReviewSaving}
        />
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
                <AISelectionToolbar editor={editor} onRewriteSelection={rewriteSelectionWithAI} />
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

        <RevisionHistoryPanel
          className={mode === "split" ? "xl:col-span-2" : ""}
          formatDate={formatDate}
          loading={revisionsLoading}
          onRestore={(revisionId, revisionNumber) => void restoreRevision(revisionId, revisionNumber)}
          restoringRevisionId={restoringRevisionId}
          revisions={revisions}
        />
      </div>
    </div>
  );
}
