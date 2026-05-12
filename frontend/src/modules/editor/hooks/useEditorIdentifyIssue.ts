"use client";

/**
 * Identify Issue orchestration for editor content.
 *
 * Owns the replacement/flag modal state, Canvas revision recovery, source-course
 * replacement, and issue flag submission while the workspace keeps rendering.
 */

import { useCallback, useEffect, useState } from "react";

import {
  loadCanvasRevisionPreview as loadCanvasRevisionPreviewFromApi,
  loadCanvasRevisions as loadCanvasRevisionsFromApi,
  loadSourceCourses as loadSourceCoursesFromApi,
  loadSourcePagePreview as loadSourcePagePreviewFromApi,
  loadSourcePages,
  replaceEditorContentFromSourcePage,
  restoreCanvasRevision as restoreCanvasRevisionFromApi,
  saveEditorIssueFlag,
  type CanvasRevisionPreview,
  type CanvasRevisionRow,
  type EditorSaveResponse,
  type SourceCourse,
  type SourcePageMatch,
  type SourcePagePreview,
} from "@/modules/editor/api/editorClient";
import type { ContentEditorItem } from "@/modules/editor/types";

type IdentifyIssueMode = "replace" | "flag";
type IdentifyIssueTab = "revisions" | "source";
type LoadSourceCourseOptions = { append?: boolean; cursor?: string | null };

type UseEditorIdentifyIssueParams = {
  applySavedContentResponse: (data: EditorSaveResponse) => void;
  getAccessToken: () => Promise<string>;
  isDirty: boolean;
  item: ContentEditorItem;
  refreshLocalRevisions: (token: string) => Promise<void>;
  sessionId: string;
  setMessage: (value: string | null) => void;
  title: string;
};

function dispatchPendingChangesUpdated() {
  window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
}

export function useEditorIdentifyIssue({
  applySavedContentResponse,
  getAccessToken,
  isDirty,
  item,
  refreshLocalRevisions,
  sessionId,
  setMessage,
  title,
}: UseEditorIdentifyIssueParams) {
  const [identifyIssueOpen, setIdentifyIssueOpen] = useState(false);
  const [identifyIssueMode, setIdentifyIssueMode] = useState<IdentifyIssueMode>("replace");
  const [identifyIssueTab, setIdentifyIssueTab] = useState<IdentifyIssueTab>("revisions");
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

  const closeIdentifyIssueModal = useCallback(() => {
    setIdentifyIssueOpen(false);
    setIdentifyIssueMessage(null);
  }, []);

  const openIdentifyIssueModal = useCallback(() => {
    setIdentifyIssueMessage(null);
    setCanvasRevisionsLoaded(false);
    setCanvasRevisions([]);
    setSelectedCanvasRevisionId(null);
    setCanvasRevisionPreview(null);
    setIdentifyIssueOpen(true);
    setIdentifyIssueMode("replace");
    setIdentifyIssueTab("revisions");
  }, []);

  const loadCanvasRevisionPreview = useCallback(async (revisionId: number) => {
    setSelectedCanvasRevisionId(revisionId);
    setCanvasRevisionPreviewLoading(true);
    setIdentifyIssueMessage(null);
    try {
      const token = await getAccessToken();
      const data = await loadCanvasRevisionPreviewFromApi(sessionId, item.id, revisionId, token);
      setCanvasRevisionPreview(data);
    } catch (error) {
      setIdentifyIssueMessage(error instanceof Error ? error.message : "Failed to load Canvas revision preview");
    } finally {
      setCanvasRevisionPreviewLoading(false);
    }
  }, [getAccessToken, item.id, sessionId]);

  const loadCanvasRevisions = useCallback(async () => {
    if (item.content_type !== "page") {
      setIdentifyIssueMessage("Canvas page revisions are available for pages only.");
      setCanvasRevisionsLoaded(true);
      return;
    }
    setCanvasRevisionsLoading(true);
    setIdentifyIssueMessage(null);
    try {
      const token = await getAccessToken();
      const data = await loadCanvasRevisionsFromApi(sessionId, item.id, token);
      setCanvasRevisions(data);
      setCanvasRevisionsLoaded(true);
      const nextSelectedId = data.some((revision) => revision.revision_id === selectedCanvasRevisionId)
        ? selectedCanvasRevisionId
        : data[0]?.revision_id ?? null;
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
  }, [getAccessToken, item.content_type, item.id, loadCanvasRevisionPreview, selectedCanvasRevisionId, sessionId]);

  const refreshCanvasRevisions = useCallback(() => {
    setCanvasRevisionsLoaded(false);
    void loadCanvasRevisions();
  }, [loadCanvasRevisions]);

  useEffect(() => {
    if (!identifyIssueOpen || identifyIssueMode !== "replace" || identifyIssueTab !== "revisions") return;
    if (canvasRevisionsLoaded || canvasRevisionsLoading) return;
    const timeoutId = window.setTimeout(() => {
      void loadCanvasRevisions();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [
    canvasRevisionsLoaded,
    canvasRevisionsLoading,
    identifyIssueMode,
    identifyIssueOpen,
    identifyIssueTab,
    loadCanvasRevisions,
  ]);

  useEffect(() => {
    if (!identifyIssueOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeIdentifyIssueModal();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeIdentifyIssueModal, identifyIssueOpen]);

  const restoreCanvasRevision = useCallback(async () => {
    if (!selectedCanvasRevisionId || canvasRevisionRestoring) return;
    if (isDirty) {
      setIdentifyIssueMessage("Save or cancel the current draft before restoring a previous version.");
      return;
    }
    setCanvasRevisionRestoring(true);
    setIdentifyIssueMessage(null);
    try {
      const token = await getAccessToken();
      const data = await restoreCanvasRevisionFromApi(sessionId, item.id, selectedCanvasRevisionId, token);
      applySavedContentResponse(data);
      await refreshLocalRevisions(token);
      dispatchPendingChangesUpdated();
      closeIdentifyIssueModal();
      setMessage(`Restored Canvas revision ${selectedCanvasRevisionId}. Review the pending change before pushing to Canvas.`);
    } catch (error) {
      setIdentifyIssueMessage(error instanceof Error ? error.message : "Failed to restore Canvas revision");
    } finally {
      setCanvasRevisionRestoring(false);
    }
  }, [
    applySavedContentResponse,
    canvasRevisionRestoring,
    closeIdentifyIssueModal,
    getAccessToken,
    isDirty,
    item.id,
    refreshLocalRevisions,
    selectedCanvasRevisionId,
    sessionId,
    setMessage,
  ]);

  const saveIssueFlag = useCallback(async () => {
    setFlagIssueSaving(true);
    setIdentifyIssueMessage(null);
    try {
      const token = await getAccessToken();
      await saveEditorIssueFlag(sessionId, item.id, token, flagIssueNote);
      setFlagIssueNote("");
      closeIdentifyIssueModal();
      setMessage("Issue flagged for the audit report.");
    } catch (error) {
      setIdentifyIssueMessage(error instanceof Error ? error.message : "Failed to flag issue");
    } finally {
      setFlagIssueSaving(false);
    }
  }, [closeIdentifyIssueModal, flagIssueNote, getAccessToken, item.id, sessionId, setMessage]);

  const loadSourceCourses = useCallback(async (
    query = sourceCourseQuery,
    options: LoadSourceCourseOptions = {},
  ) => {
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
      const data = await loadSourceCoursesFromApi(sessionId, token, {
        cursor: options.cursor,
        query,
      });
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
  }, [getAccessToken, sessionId, sourceCourseQuery]);

  const selectSourceCourse = useCallback(async (course: SourceCourse) => {
    setSelectedSourceCourse(course);
    setSelectedSourcePage(null);
    setSourcePagePreview(null);
    setSourcePageMatches([]);
    setSourcePagesLoading(true);
    setIdentifyIssueMessage(null);
    try {
      const token = await getAccessToken();
      const data = await loadSourcePages(sessionId, token, course.course_id, title || item.title || "");
      setSourcePageMatches(data);
      if (!data.length) {
        setIdentifyIssueMessage(`No matching page titled "${title || item.title}" was found in ${course.name}.`);
      }
    } catch (error) {
      setIdentifyIssueMessage(error instanceof Error ? error.message : "Failed to search source pages");
    } finally {
      setSourcePagesLoading(false);
    }
  }, [getAccessToken, item.title, sessionId, title]);

  const loadSourcePagePreview = useCallback(async (page: SourcePageMatch) => {
    if (!selectedSourceCourse) return;
    setSelectedSourcePage(page);
    setSourcePagePreviewLoading(true);
    setIdentifyIssueMessage(null);
    try {
      const token = await getAccessToken();
      const data = await loadSourcePagePreviewFromApi(sessionId, token, selectedSourceCourse.course_id, page.page_url);
      setSourcePagePreview(data);
    } catch (error) {
      setIdentifyIssueMessage(error instanceof Error ? error.message : "Failed to load source page preview");
    } finally {
      setSourcePagePreviewLoading(false);
    }
  }, [getAccessToken, selectedSourceCourse, sessionId]);

  const replaceFromSourcePage = useCallback(async () => {
    if (!selectedSourceCourse || !selectedSourcePage || sourcePageReplacing) return;
    if (isDirty) {
      setIdentifyIssueMessage("Save or cancel the current draft before replacing content from a source course.");
      return;
    }
    setSourcePageReplacing(true);
    setIdentifyIssueMessage(null);
    try {
      const token = await getAccessToken();
      const data = await replaceEditorContentFromSourcePage(
        sessionId,
        item.id,
        token,
        selectedSourceCourse.course_id,
        selectedSourcePage.page_url,
      );
      applySavedContentResponse(data);
      await refreshLocalRevisions(token);
      dispatchPendingChangesUpdated();
      closeIdentifyIssueModal();
      setMessage("Replaced the local draft from the selected source page. Review the pending change before pushing to Canvas.");
    } catch (error) {
      setIdentifyIssueMessage(error instanceof Error ? error.message : "Failed to replace from source page");
    } finally {
      setSourcePageReplacing(false);
    }
  }, [
    applySavedContentResponse,
    closeIdentifyIssueModal,
    getAccessToken,
    isDirty,
    item.id,
    refreshLocalRevisions,
    selectedSourceCourse,
    selectedSourcePage,
    sessionId,
    setMessage,
    sourcePageReplacing,
  ]);

  return {
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
  };
}
