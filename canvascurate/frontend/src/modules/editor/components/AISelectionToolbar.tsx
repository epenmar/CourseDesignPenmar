"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Sparkles, X } from "lucide-react";

import Button from "@/components/edplus/Button";

type AIRewriteAction = {
  id: string;
  instruction: string;
  label: string;
};

const AI_REWRITE_ACTIONS: AIRewriteAction[] = [
  { id: "rewrite", label: "Rewrite", instruction: "Rewrite this text in a different way while preserving the meaning:" },
  { id: "simplify", label: "Simplify", instruction: "Simplify this text for easier reading:" },
  { id: "expand", label: "Expand", instruction: "Expand this text with more detail:" },
  { id: "formal", label: "Formal", instruction: "Rewrite this text in a more formal, professional tone:" },
  { id: "concise", label: "Concise", instruction: "Make this text more concise without losing meaning:" },
  { id: "fix", label: "Fix Grammar", instruction: "Fix any grammar, spelling, or punctuation errors in this text:" },
];

type AISelectionToolbarProps = {
  editor: Editor | null;
  onRewriteSelection: (text: string, instruction: string) => Promise<string>;
};

export function AISelectionToolbar({ editor, onRewriteSelection }: AISelectionToolbarProps) {
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

  async function runAction(action: AIRewriteAction) {
    if (!editor || !selectionRef.current || loadingAction) return;
    const { from, to } = selectionRef.current;
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    if (!selectedText.trim()) return;
    setLoadingAction(action.id);
    setMenuOpen(false);
    setError(null);
    try {
      const result = await onRewriteSelection(selectedText, action.instruction);
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
            <Button type="button" onClick={discardPreview} variant="ghost" size="sm" className="h-8 px-3 py-1.5 text-xs">
              Dismiss
            </Button>
            <Button type="button" onClick={applyPreview} size="sm" className="h-8 px-3 py-1.5 text-xs">
              Replace Selection
            </Button>
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
          <Button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            size="sm"
            loading={Boolean(loadingAction)}
            icon={<Sparkles size={14} />}
            className="h-8 px-2.5 text-xs"
          >
            AI
          </Button>
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
