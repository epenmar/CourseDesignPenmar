"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { AlertTriangle, RefreshCw, Sparkles, X } from "lucide-react";

import { Alert, Badge, Button, ButtonLink, EmptyState } from "@/components/edplus";
import {
  accessibilityFixLabel,
  canFixAccessibilityIssue,
  fixAccessibilityIssueInHtml,
  runAccessibilityChecks,
  shouldRouteAccessibilityIssueToImages,
  type AccessibilityIssue,
} from "@/modules/editor/utils/accessibility";
import { serializeHtmlBlocks } from "@/modules/editor/utils/html";

type AccessibilityCheckPanelProps = {
  currentHtml: string;
  editor: Editor | null;
  editorMode: "rich" | "html";
  onApplyHtml: (html: string) => void;
  onClose: () => void;
  onImproveLinkText: (issue: AccessibilityIssue) => Promise<string>;
  sessionId: string;
};

export function AccessibilityCheckPanel({
  currentHtml,
  editor,
  editorMode,
  onApplyHtml,
  onClose,
  onImproveLinkText,
  sessionId,
}: AccessibilityCheckPanelProps) {
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

  async function fixIssue(issue: AccessibilityIssue) {
    if (!canFixAccessibilityIssue(issue) || fixingId) return;
    setFixingId(issue.id);
    setFixError(null);
    try {
      const needsLinkText = issue.code === "empty-link" || issue.code === "vague-link" || issue.code === "file-link";
      const replacementText = needsLinkText ? await onImproveLinkText(issue) : undefined;
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
            <Button
              type="button"
              title="Re-check"
              onClick={() => setRefreshKey((value) => value + 1)}
              variant="ghost"
              size="sm"
              icon={<RefreshCw size={15} />}
              className="h-9 w-9 p-0 text-on-surface-variant"
            >
              <span className="sr-only">Re-check</span>
            </Button>
            <Button
              type="button"
              title="Close"
              onClick={onClose}
              variant="ghost"
              size="sm"
              icon={<X size={16} />}
              className="h-9 w-9 p-0 text-on-surface-variant"
            >
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 border-b border-outline-variant/20 px-5 py-3">
          <Badge variant="error" className="px-2.5 py-1 text-xs">
            {errors.length} error{errors.length === 1 ? "" : "s"}
          </Badge>
          <Badge variant="warning" className="px-2.5 py-1 text-xs">
            {warnings.length} warning{warnings.length === 1 ? "" : "s"}
          </Badge>
          {refreshKey > 0 ? (
            <span className="ml-auto text-xs font-semibold text-on-surface-variant">Rechecked</span>
          ) : null}
        </div>
        {fixError ? (
          <Alert variant="error" className="rounded-none border-x-0 border-t-0 px-5 py-3">
            {fixError}
          </Alert>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {issues.length === 0 ? (
            <EmptyState
              icon={<Sparkles size={18} />}
              title="No issues found"
              description="Draft checks passed."
              size="sm"
              className="px-5 py-8"
            />
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
                        <Badge className="px-2 py-0.5 text-[11px]">
                          {issue.rule}
                        </Badge>
                      </div>
                      {issue.context ? (
                        <p className="mt-1 truncate text-xs text-on-surface-variant">{issue.context}</p>
                      ) : null}
                      <p className="mt-2 text-sm text-on-surface-variant">{issue.fix}</p>
                      {canFixAccessibilityIssue(issue) ? (
                        <Button
                          type="button"
                          disabled={Boolean(fixingId)}
                          loading={fixingId === issue.id}
                          icon={<Sparkles size={12} />}
                          size="sm"
                          onClick={() => void fixIssue(issue)}
                          className="mt-3 h-auto px-3 py-1.5 text-xs"
                        >
                          {accessibilityFixLabel(issue)}
                        </Button>
                      ) : null}
                      {shouldRouteAccessibilityIssueToImages(issue) ? (
                        <ButtonLink
                          href={`/sessions/${sessionId}/images`}
                          variant="ghost"
                          size="sm"
                          className="mt-3 h-auto px-3 py-1.5 text-xs"
                        >
                          Review in Images
                        </ButtonLink>
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
