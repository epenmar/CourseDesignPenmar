"use client";

/**
 * Save, revision, and Canvas push orchestration for the editor workspace.
 *
 * The workspace owns layout and editor composition; this hook owns the mutable
 * content lifecycle around local drafts, revision history, and Canvas pushes.
 */

import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";

import {
  loadEditorRevisions,
  pushEditorContentToCanvas,
  restoreEditorRevision,
  saveEditorContent,
  type EditorSaveResponse,
} from "@/modules/editor/api/editorClient";
import type { ContentEditorItem } from "@/modules/editor/types";
import { serializeHtmlBlocks } from "@/modules/editor/utils/html";

type UseEditorContentSaveParams = {
  changeSummary: string;
  currentHtml: string;
  editor: Editor | null;
  editorMode: "rich" | "html";
  getAccessToken: () => Promise<string>;
  item: ContentEditorItem;
  refreshRoute: () => void;
  savedHtml: string;
  savedTitle: string;
  sessionId: string;
  setChangeSummary: (value: string) => void;
  setCurrentHtml: (value: string) => void;
  setCanvasUrl: (value: string | null) => void;
  setMessage: (value: string | null) => void;
  setSavedHtml: (value: string) => void;
  setSavedTitle: (value: string) => void;
  setTitle: (value: string) => void;
  title: string;
};

function dispatchPendingChangesUpdated() {
  window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
}

function dispatchQuizQuestionsUpdated() {
  window.dispatchEvent(new CustomEvent("canvascurate:quiz-questions-updated"));
}

export function useEditorContentSave({
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
}: UseEditorContentSaveParams) {
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [restoringRevisionId, setRestoringRevisionId] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<Awaited<ReturnType<typeof loadEditorRevisions>>>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(true);

  const isDirty = title.trim() !== savedTitle.trim() || currentHtml !== savedHtml;

  const applySavedContentResponse = useCallback((data: EditorSaveResponse) => {
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
  }, [editor, setChangeSummary, setCurrentHtml, setSavedHtml, setSavedTitle, setTitle]);

  const refreshLocalRevisions = useCallback(async (token: string) => {
    setRevisions(await loadEditorRevisions(sessionId, item.id, token));
  }, [item.id, sessionId]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("canvascurate:editor-dirty-state", {
      detail: { contentItemId: item.id, dirty: isDirty },
    }));
    return () => {
      window.dispatchEvent(new CustomEvent("canvascurate:editor-dirty-state", {
        detail: { contentItemId: item.id, dirty: false },
      }));
    };
  }, [isDirty, item.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadRevisions() {
      setRevisionsLoading(true);
      try {
        const token = await getAccessToken();
        const data = await loadEditorRevisions(sessionId, item.id, token);
        if (!cancelled) {
          setRevisions(data);
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

    const timeoutId = window.setTimeout(() => {
      void loadRevisions();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [getAccessToken, item.id, sessionId, setMessage]);

  const saveChanges = useCallback(async () => {
    if (!editor && editorMode === "rich") return;

    setSaving(true);
    setMessage(null);

    try {
      const token = await getAccessToken();
      const htmlBody = editorMode === "html" ? currentHtml : serializeHtmlBlocks(editor?.getHTML() ?? currentHtml);
      const data = await saveEditorContent(sessionId, item.id, token, {
        title,
        html_body: htmlBody,
        change_summary: changeSummary,
      });
      applySavedContentResponse(data);
      setMessage(data.saved === false ? "No content changes to save." : `Saved${data.revision_number ? ` as revision ${data.revision_number}` : ""}.`);

      await refreshLocalRevisions(token);
      dispatchPendingChangesUpdated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save content");
    } finally {
      setSaving(false);
    }
  }, [
    applySavedContentResponse,
    changeSummary,
    currentHtml,
    editor,
    editorMode,
    getAccessToken,
    item.id,
    refreshLocalRevisions,
    sessionId,
    setMessage,
    title,
  ]);

  const pushToCanvas = useCallback(async () => {
    if (isDirty) {
      setMessage("Save the draft before pushing to Canvas.");
      return;
    }

    setPushing(true);
    setMessage(null);

    try {
      const token = await getAccessToken();
      const data = await pushEditorContentToCanvas(sessionId, item.id, token);
      applySavedContentResponse(data);
      setCanvasUrl(data.canvas_url ?? null);
      setMessage("Pushed saved draft to Canvas.");
      dispatchPendingChangesUpdated();
      refreshRoute();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to push content to Canvas");
    } finally {
      setPushing(false);
    }
  }, [applySavedContentResponse, getAccessToken, isDirty, item.id, refreshRoute, sessionId, setCanvasUrl, setMessage]);

  const restoreRevision = useCallback(async (revisionId: string, revisionNumber: number) => {
    setRestoringRevisionId(revisionId);
    setMessage(null);

    try {
      const token = await getAccessToken();
      const data = await restoreEditorRevision(sessionId, item.id, revisionId, token);
      applySavedContentResponse(data);
      setMessage(`Restored revision ${revisionNumber}.`);

      await refreshLocalRevisions(token);
      if (item.content_type === "quiz") {
        dispatchQuizQuestionsUpdated();
      }
      dispatchPendingChangesUpdated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to restore revision");
    } finally {
      setRestoringRevisionId(null);
    }
  }, [
    applySavedContentResponse,
    getAccessToken,
    item.content_type,
    item.id,
    refreshLocalRevisions,
    sessionId,
    setMessage,
  ]);

  return {
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
  };
}
