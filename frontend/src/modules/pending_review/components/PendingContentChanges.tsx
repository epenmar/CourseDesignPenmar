"use client";

/**
 * Pending content revision list and batch push controls.
 */

import type {
  BatchPushState,
  PendingContentChange,
  PendingDiffResponse,
} from "@/modules/pending_review/types";
import Alert from "@/components/edplus/Alert";
import Badge from "@/components/edplus/Badge";
import Button from "@/components/edplus/Button";
import Card, { CardBody } from "@/components/edplus/Card";
import {
  batchStatusClass,
  batchStatusLabel,
  formatFieldList,
  statusBadgeClass,
} from "@/modules/pending_review/utils";

export default function PendingContentChanges({
  batchPushState,
  batchPushing,
  changes,
  diffContentId,
  diffLoading,
  dirtyBlocksPushAll,
  dirtyEditorItemId,
  onPushAll,
  onPushChange,
  onPushSelected,
  onToggleAll,
  onToggleDiff,
  onToggleSelection,
  pendingDiff,
  selectedContentPushIds,
}: {
  batchPushState: Record<string, BatchPushState>;
  batchPushing: boolean;
  changes: PendingContentChange[];
  diffContentId: string | null;
  diffLoading: boolean;
  dirtyBlocksPushAll: boolean;
  dirtyEditorItemId: string | null;
  onPushAll: () => void;
  onPushChange: (change: PendingContentChange) => void;
  onPushSelected: () => void;
  onToggleAll: () => void;
  onToggleDiff: (change: PendingContentChange) => void;
  onToggleSelection: (contentItemId: string) => void;
  pendingDiff: PendingDiffResponse | null;
  selectedContentPushIds: Set<string>;
}) {
  if (!changes.length) return null;

  return (
    <Card>
      <CardBody className="px-4 py-3 text-sm text-on-surface">
        <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <input
            type="checkbox"
            aria-label="Select all content changes"
            checked={changes.every((change) => selectedContentPushIds.has(change.content_item_id))}
            onChange={onToggleAll}
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
              : `${changes.length} ready item${changes.length === 1 ? "" : "s"}`}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onPushSelected}
            disabled={batchPushing || selectedContentPushIds.size === 0}
          >
            Push selected
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onPushAll}
            disabled={batchPushing || dirtyBlocksPushAll}
          >
            {batchPushing ? "Pushing..." : "Push all"}
          </Button>
        </div>
      </div>
      {dirtyBlocksPushAll ? (
        <Alert variant="warning" className="mt-2 py-2 text-xs">
          Save or cancel the current editor draft before pushing that content item.
        </Alert>
      ) : null}
      <div className="mt-2 space-y-2">
        {changes.map((change) => {
          const activeDirty = change.content_item_id === dirtyEditorItemId;
          const rowState = batchPushState[change.content_item_id];
          const rowDiffOpen = diffContentId === change.content_item_id;
          return (
            <div
              key={change.content_item_id}
              className={`rounded-lg px-3 py-2 ${activeDirty ? "bg-secondary-container/30 ring-1 ring-secondary-container" : "bg-surface-container-low"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Select ${change.title || "untitled content"} for push`}
                    checked={selectedContentPushIds.has(change.content_item_id)}
                    onChange={() => onToggleSelection(change.content_item_id)}
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
                    <Badge className={`px-2 py-0.5 text-[11px] ${statusBadgeClass(change.review_status)}`}>
                      {activeDirty ? "Unsaved draft" : change.review_status}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={batchPushing || activeDirty}
                      onClick={() => onPushChange(change)}
                      className="h-auto px-2 py-1 text-[11px]"
                    >
                      {rowState?.status === "pushing" ? "Pushing..." : "Push"}
                    </Button>
                  </div>
                  {rowState ? (
                    <Badge
                      className={`px-2 py-0.5 text-[11px] ${batchStatusClass(rowState)}`}
                      title={rowState.message}
                    >
                      {batchStatusLabel(rowState)}
                    </Badge>
                  ) : null}
                </div>
              </div>
              {rowState?.status === "failed" && rowState.message ? (
                <Alert variant="error" className="mt-2 py-2 text-xs">
                  {rowState.message}
                </Alert>
              ) : null}
              <p className="mt-1 line-clamp-2 text-xs text-on-surface-variant">
                {change.change_summary || change.diff_summary}
              </p>
              {change.has_changes ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onToggleDiff(change)}
                  disabled={diffLoading}
                  className="mt-2 h-auto px-2 py-1 text-[11px]"
                >
                  {diffLoading && rowDiffOpen ? "Loading diff..." : rowDiffOpen ? "Hide diff" : "Show diff"}
                </Button>
              ) : null}
              {rowDiffOpen && pendingDiff?.unified_diff ? (
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
          );
        })}
      </div>
      </CardBody>
    </Card>
  );
}
