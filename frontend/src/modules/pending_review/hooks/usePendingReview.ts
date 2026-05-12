"use client";

/**
 * State and API orchestration for the session-level Pending Review workflow.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  applyModuleOperations as applyModuleOperationsApi,
  discardAllModuleOperations as discardAllModuleOperationsApi,
  discardModuleOperation as discardModuleOperationApi,
  getPendingDiff,
  listModuleApplyHistory,
  listPendingChanges,
  listPushHistory,
  pushContentChange,
} from "@/modules/pending_review/api/pendingReviewClient";
import type {
  BatchPushState,
  ModuleApplyHistoryItem,
  PendingChangesResponse,
  PendingContentChange,
  PendingDiffResponse,
  PushHistoryItem,
} from "@/modules/pending_review/types";

type EditorDirtyEventDetail = {
  contentItemId: string | null;
  dirty: boolean;
};

export default function usePendingReview(sessionId: string) {
  const router = useRouter();
  const [pendingChanges, setPendingChanges] = useState<PendingChangesResponse | null>(null);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [selectedContentPushIds, setSelectedContentPushIds] = useState<Set<string>>(new Set());
  const [batchPushing, setBatchPushing] = useState(false);
  const [batchPushState, setBatchPushState] = useState<Record<string, BatchPushState>>({});
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [diffContentId, setDiffContentId] = useState<string | null>(null);
  const [pendingDiff, setPendingDiff] = useState<PendingDiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [moduleOperationBusyId, setModuleOperationBusyId] = useState<string | null>(null);
  const [applyingModuleOperations, setApplyingModuleOperations] = useState(false);
  const [pushHistory, setPushHistory] = useState<PushHistoryItem[]>([]);
  const [pushHistoryLoading, setPushHistoryLoading] = useState(true);
  const [pushHistoryError, setPushHistoryError] = useState<string | null>(null);
  const [moduleApplyHistory, setModuleApplyHistory] = useState<ModuleApplyHistoryItem[]>([]);
  const [moduleApplyHistoryLoading, setModuleApplyHistoryLoading] = useState(true);
  const [moduleApplyHistoryError, setModuleApplyHistoryError] = useState<string | null>(null);
  const [dirtyEditorItemId, setDirtyEditorItemId] = useState<string | null>(null);

  const loadPendingChanges = useCallback(async () => {
    setPendingLoading(true);
    setPendingError(null);
    try {
      const data = await listPendingChanges(sessionId);
      setPendingChanges(data);
      setSelectedContentPushIds((current) => {
        const availableIds = new Set(data.content_changes.map((change) => change.content_item_id));
        const next = new Set(Array.from(current).filter((id) => availableIds.has(id)));
        return next.size === current.size ? current : next;
      });
      if (diffContentId && !data.content_changes.some((change) => change.content_item_id === diffContentId)) {
        setDiffContentId(null);
        setPendingDiff(null);
      }
    } catch (error) {
      setPendingError(error instanceof Error ? error.message : "Failed to load pending changes");
    } finally {
      setPendingLoading(false);
    }
  }, [diffContentId, sessionId]);

  const loadPushHistory = useCallback(async () => {
    setPushHistoryLoading(true);
    setPushHistoryError(null);
    try {
      const data = await listPushHistory(sessionId);
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
      const data = await listModuleApplyHistory(sessionId);
      setModuleApplyHistory(data.items);
    } catch (error) {
      setModuleApplyHistory([]);
      setModuleApplyHistoryError(error instanceof Error ? error.message : "Failed to load module update history");
    } finally {
      setModuleApplyHistoryLoading(false);
    }
  }, [sessionId]);

  const refreshPendingReview = useCallback(async () => {
    await Promise.all([
      loadPendingChanges(),
      loadPushHistory(),
      loadModuleApplyHistory(),
    ]);
  }, [loadModuleApplyHistory, loadPendingChanges, loadPushHistory]);

  useEffect(() => {
    void refreshPendingReview();

    function handlePendingChangesUpdated() {
      void loadPendingChanges();
    }

    function handleEditorDirtyState(event: Event) {
      const detail = (event as CustomEvent<EditorDirtyEventDetail>).detail;
      if (!detail?.contentItemId || !detail.dirty) {
        setDirtyEditorItemId(null);
        return;
      }
      setDirtyEditorItemId(detail.contentItemId);
    }

    window.addEventListener("canvascurate:pending-changes-updated", handlePendingChangesUpdated);
    window.addEventListener("canvascurate:editor-dirty-state", handleEditorDirtyState);
    return () => {
      window.removeEventListener("canvascurate:pending-changes-updated", handlePendingChangesUpdated);
      window.removeEventListener("canvascurate:editor-dirty-state", handleEditorDirtyState);
    };
  }, [loadPendingChanges, refreshPendingReview]);

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
      if (contentChanges.every((change) => current.has(change.content_item_id))) {
        return new Set();
      }
      return new Set(contentChanges.map((change) => change.content_item_id));
    });
  }

  async function togglePendingDiff(change: PendingContentChange) {
    if (diffContentId === change.content_item_id) {
      setDiffContentId(null);
      setPendingDiff(null);
      return;
    }
    if (!change.has_changes) return;

    setDiffContentId(change.content_item_id);
    setDiffLoading(true);
    try {
      setPendingDiff(await getPendingDiff(sessionId, change.content_item_id));
    } catch (error) {
      setReviewMessage(error instanceof Error ? error.message : "Failed to load pending diff");
      setDiffContentId(null);
      setPendingDiff(null);
    } finally {
      setDiffLoading(false);
    }
  }

  async function pushPendingContentChanges(changesToPush?: PendingContentChange[]) {
    const contentChanges = changesToPush ?? pendingChanges?.content_changes ?? [];
    if (!contentChanges.length || batchPushing) return;
    if (dirtyEditorItemId && contentChanges.some((change) => change.content_item_id === dirtyEditorItemId)) {
      setReviewMessage("Save or cancel the current editor draft before pushing that content item.");
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

    for (const change of contentChanges) {
      setBatchPushState((current) => ({
        ...current,
        [change.content_item_id]: { status: "pushing" },
      }));
      try {
        await pushContentChange(sessionId, change.content_item_id, batchId);
        pushedCount += 1;
        setBatchPushState((current) => ({
          ...current,
          [change.content_item_id]: { status: "pushed" },
        }));
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
    setBatchPushing(false);
    router.refresh();
  }

  function pushSelectedContentChanges() {
    const contentChanges = pendingChanges?.content_changes ?? [];
    const selectedChanges = contentChanges.filter((change) => selectedContentPushIds.has(change.content_item_id));
    void pushPendingContentChanges(selectedChanges);
  }

  async function discardModuleOperation(operationId: string) {
    setModuleOperationBusyId(operationId);
    setReviewMessage(null);
    try {
      await discardModuleOperationApi(sessionId, operationId);
      window.dispatchEvent(new CustomEvent("canvascurate:module-operation-deleted", { detail: { operationId } }));
      await loadPendingChanges();
      router.refresh();
    } catch (error) {
      setReviewMessage(error instanceof Error ? error.message : "Failed to discard module operation");
    } finally {
      setModuleOperationBusyId(null);
    }
  }

  async function discardAllModuleOperations() {
    setModuleOperationBusyId("all");
    setReviewMessage(null);
    try {
      await discardAllModuleOperationsApi(sessionId);
      window.dispatchEvent(new CustomEvent("canvascurate:module-operation-deleted", { detail: { all: true } }));
      await loadPendingChanges();
      router.refresh();
    } catch (error) {
      setReviewMessage(error instanceof Error ? error.message : "Failed to discard module operations");
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

    if (operationIds?.length === 1) {
      setModuleOperationBusyId(`apply:${operationIds[0]}`);
    } else {
      setApplyingModuleOperations(true);
    }
    setReviewMessage(null);
    try {
      const data = await applyModuleOperationsApi(sessionId, targetChanges.map((change) => change.id));
      window.dispatchEvent(new CustomEvent("canvascurate:module-operations-applied", { detail: { applied: data.applied } }));
      window.dispatchEvent(new CustomEvent("canvascurate:module-operation-deleted", { detail: { all: true } }));
      await loadPendingChanges();
      await loadModuleApplyHistory();
      router.refresh();
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

  const totalPending = pendingChanges?.counts.total ?? 0;
  const dirtyBlocksPushAll = Boolean(
    dirtyEditorItemId && pendingChanges?.content_changes.some((change) => change.content_item_id === dirtyEditorItemId),
  );

  return {
    applyingModuleOperations,
    applyModuleOperations,
    batchPushing,
    batchPushState,
    dirtyBlocksPushAll,
    dirtyEditorItemId,
    diffContentId,
    diffLoading,
    discardAllModuleOperations,
    discardModuleOperation,
    moduleApplyHistory,
    moduleApplyHistoryError,
    moduleApplyHistoryLoading,
    moduleOperationBusyId,
    pendingChanges,
    pendingDiff,
    pendingError,
    pendingLoading,
    pushHistory,
    pushHistoryError,
    pushHistoryLoading,
    pushPendingContentChanges,
    pushSelectedContentChanges,
    refreshPendingReview,
    reviewMessage,
    selectedContentPushIds,
    setReviewMessage,
    toggleAllContentPushSelection,
    toggleContentPushSelection,
    togglePendingDiff,
    totalPending,
  };
}
