"use client";

/**
 * Recent content push history panel.
 */

import type { PushHistoryItem } from "@/modules/pending_review/types";
import Badge from "@/components/edplus/Badge";
import Card, { CardBody } from "@/components/edplus/Card";
import { Skeleton } from "@/components/edplus/Skeleton";
import { contentTypeLabel, formatDate, pushRevisionLabel } from "@/modules/pending_review/utils";

export default function PushHistoryPanel({
  error,
  items,
  loading,
}: {
  error: string | null;
  items: PushHistoryItem[];
  loading: boolean;
}) {
  return (
    <Card>
      <CardBody className="px-4 py-3 text-sm text-on-surface">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
        Recent Content Pushes
      </p>
      {loading ? (
        <div className="mt-3 space-y-2">
          <Skeleton height="14px" width="70%" rounded="sm" />
          <Skeleton height="12px" width="45%" rounded="sm" />
        </div>
      ) : error ? (
        <p className="mt-3 text-sm text-on-surface-variant">Push history is not available from the current API yet.</p>
      ) : items.length ? (
        <div className="mt-2 divide-y divide-outline-variant/20">
          {items.map((historyItem) => {
            const revisionLabel = pushRevisionLabel(historyItem);
            return (
              <div key={historyItem.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="line-clamp-1 text-sm font-semibold text-on-surface">
                    {historyItem.title || "Untitled content"}
                  </p>
                  <p className="mt-0.5 text-xs text-on-surface-variant">
                    {contentTypeLabel(historyItem.content_type)}
                    {historyItem.batch_id ? " / batch push" : " / single push"}
                    {historyItem.canvas_id ? ` / Canvas ID ${historyItem.canvas_id}` : ""}
                  </p>
                  {revisionLabel ? (
                    <p className="mt-1 line-clamp-1 text-xs font-semibold text-on-surface">{revisionLabel}</p>
                  ) : null}
                  {historyItem.latest_change_summary ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-on-surface-variant">
                      {historyItem.latest_change_summary}
                      {historyItem.change_summaries.length > 1
                        ? ` + ${historyItem.change_summaries.length - 1} earlier change${historyItem.change_summaries.length === 2 ? "" : "s"}`
                        : ""}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-none flex-col items-end gap-1 text-right">
                  <Badge variant="primary" className="px-2 py-0.5 text-[11px]">Pushed</Badge>
                  <span className="text-[11px] text-on-surface-variant">{formatDate(historyItem.created_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-sm text-on-surface-variant">No content pushes recorded yet.</p>
      )}
      </CardBody>
    </Card>
  );
}
