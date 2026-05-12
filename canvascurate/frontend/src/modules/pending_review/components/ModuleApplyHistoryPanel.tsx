"use client";

/**
 * Recent module operation apply history panel.
 */

import type { ModuleApplyHistoryItem } from "@/modules/pending_review/types";
import Badge from "@/components/edplus/Badge";
import Card, { CardBody } from "@/components/edplus/Card";
import { Skeleton } from "@/components/edplus/Skeleton";
import { formatDate, moduleOperationTypeLabel } from "@/modules/pending_review/utils";

export default function ModuleApplyHistoryPanel({
  error,
  items,
  loading,
}: {
  error: string | null;
  items: ModuleApplyHistoryItem[];
  loading: boolean;
}) {
  return (
    <Card>
      <CardBody className="px-4 py-3 text-sm text-on-surface">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
        Recent Module Updates
      </p>
      {loading ? (
        <div className="mt-3 space-y-2">
          <Skeleton height="14px" width="70%" rounded="sm" />
          <Skeleton height="12px" width="45%" rounded="sm" />
        </div>
      ) : error ? (
        <p className="mt-3 text-sm text-on-surface-variant">Module update history is not available from the current API yet.</p>
      ) : items.length ? (
        <div className="mt-2 divide-y divide-outline-variant/20">
          {items.map((historyItem) => {
            const firstOperation = historyItem.operations[0];
            const extraCount = Math.max(0, historyItem.applied_count - 1);
            return (
              <div key={historyItem.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="line-clamp-1 text-sm font-semibold text-on-surface">
                    {firstOperation?.title || `${historyItem.applied_count} module update${historyItem.applied_count === 1 ? "" : "s"}`}
                  </p>
                  <p className="mt-0.5 text-xs text-on-surface-variant">
                    {firstOperation
                      ? `${moduleOperationTypeLabel(firstOperation.operation_type)}${extraCount ? ` / +${extraCount} more` : ""}`
                      : `${historyItem.operation_ids.length || historyItem.applied_count} operation${(historyItem.operation_ids.length || historyItem.applied_count) === 1 ? "" : "s"}`}
                    {historyItem.failed_count ? ` / ${historyItem.failed_count} failed` : ""}
                  </p>
                </div>
                <div className="flex flex-none flex-col items-end gap-1 text-right">
                  <Badge variant="primary" className="px-2 py-0.5 text-[11px]">Applied</Badge>
                  <span className="text-[11px] text-on-surface-variant">{formatDate(historyItem.created_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-sm text-on-surface-variant">No module updates recorded yet.</p>
      )}
      </CardBody>
    </Card>
  );
}
