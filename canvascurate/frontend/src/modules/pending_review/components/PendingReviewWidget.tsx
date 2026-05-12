"use client";

/**
 * Session-level Pending Review launcher and modal.
 *
 * This is mounted from the session shell so pending content revisions and
 * module operations can be reviewed from any active session page.
 */

import { useState } from "react";
import { RefreshCw, X } from "lucide-react";

import Alert from "@/components/edplus/Alert";
import Button from "@/components/edplus/Button";
import EmptyState from "@/components/edplus/EmptyState";
import ModuleApplyHistoryPanel from "@/modules/pending_review/components/ModuleApplyHistoryPanel";
import PendingContentChanges from "@/modules/pending_review/components/PendingContentChanges";
import PendingModuleChanges from "@/modules/pending_review/components/PendingModuleChanges";
import PendingReviewButton from "@/modules/pending_review/components/PendingReviewButton";
import PushHistoryPanel from "@/modules/pending_review/components/PushHistoryPanel";
import usePendingReview from "@/modules/pending_review/hooks/usePendingReview";

export default function PendingReviewWidget({
  collapsed = false,
  sessionId,
}: {
  collapsed?: boolean;
  sessionId: string;
}) {
  const [open, setOpen] = useState(false);
  const review = usePendingReview(sessionId);

  return (
    <>
      <PendingReviewButton
        collapsed={collapsed}
        contentCount={review.pendingChanges?.counts.content ?? 0}
        loading={review.pendingLoading}
        moduleCount={review.pendingChanges?.counts.modules ?? 0}
        totalPending={review.totalPending}
        onOpen={() => {
          setOpen(true);
          review.setReviewMessage(null);
        }}
      />

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/45 px-4 py-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
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
                  {review.pendingLoading
                    ? "Checking pending changes..."
                    : review.totalPending
                      ? `${review.pendingChanges?.counts.content ?? 0} content / ${review.pendingChanges?.counts.modules ?? 0} module pending`
                      : "No pending changes"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void review.refreshPendingReview()}
                  icon={<RefreshCw size={14} />}
                >
                  Refresh
                </Button>
                <button
                  type="button"
                  title="Close"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant transition-colors hover:bg-surface-container-high"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
              {review.reviewMessage ? (
                <Alert variant="info">
                  {review.reviewMessage}
                </Alert>
              ) : null}
              {review.pendingError ? (
                <Alert variant="error">
                  {review.pendingError}
                </Alert>
              ) : null}
              {!review.pendingLoading && !review.totalPending ? (
                <EmptyState
                  title="No pending changes"
                  description="No pending content or module changes are waiting for review."
                  size="sm"
                />
              ) : null}

              <PendingContentChanges
                batchPushState={review.batchPushState}
                batchPushing={review.batchPushing}
                changes={review.pendingChanges?.content_changes ?? []}
                diffContentId={review.diffContentId}
                diffLoading={review.diffLoading}
                dirtyBlocksPushAll={review.dirtyBlocksPushAll}
                dirtyEditorItemId={review.dirtyEditorItemId}
                onPushAll={() => void review.pushPendingContentChanges()}
                onPushChange={(change) => void review.pushPendingContentChanges([change])}
                onPushSelected={review.pushSelectedContentChanges}
                onToggleAll={review.toggleAllContentPushSelection}
                onToggleDiff={(change) => void review.togglePendingDiff(change)}
                onToggleSelection={review.toggleContentPushSelection}
                pendingDiff={review.pendingDiff}
                selectedContentPushIds={review.selectedContentPushIds}
              />

              <PendingModuleChanges
                applyingModuleOperations={review.applyingModuleOperations}
                changes={review.pendingChanges?.module_changes ?? []}
                moduleOperationBusyId={review.moduleOperationBusyId}
                onApplyAll={() => void review.applyModuleOperations()}
                onApplyOne={(operationId) => void review.applyModuleOperations([operationId])}
                onDiscardAll={() => void review.discardAllModuleOperations()}
                onDiscardOne={(operationId) => void review.discardModuleOperation(operationId)}
              />

              <PushHistoryPanel
                error={review.pushHistoryError}
                items={review.pushHistory}
                loading={review.pushHistoryLoading}
              />

              <ModuleApplyHistoryPanel
                error={review.moduleApplyHistoryError}
                items={review.moduleApplyHistory}
                loading={review.moduleApplyHistoryLoading}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
