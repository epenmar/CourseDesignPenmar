"use client";

/**
 * Pending module operation list and apply/discard controls.
 */

import type { PendingModuleChange } from "@/modules/pending_review/types";
import Badge from "@/components/edplus/Badge";
import Button from "@/components/edplus/Button";
import Card, { CardBody } from "@/components/edplus/Card";
import {
  canApplyModuleOperationIndividually,
  formatModuleValue,
  moduleOperationBadgeClass,
  moduleOperationCompareRows,
  moduleOperationToneClass,
} from "@/modules/pending_review/utils";

export default function PendingModuleChanges({
  applyingModuleOperations,
  changes,
  moduleOperationBusyId,
  onApplyAll,
  onApplyOne,
  onDiscardAll,
  onDiscardOne,
}: {
  applyingModuleOperations: boolean;
  changes: PendingModuleChange[];
  moduleOperationBusyId: string | null;
  onApplyAll: () => void;
  onApplyOne: (operationId: string) => void;
  onDiscardAll: () => void;
  onDiscardOne: (operationId: string) => void;
}) {
  if (!changes.length) return null;

  return (
    <Card>
      <CardBody className="px-4 py-3 text-sm text-on-surface">
        <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
          Module Operations
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={Boolean(moduleOperationBusyId) || applyingModuleOperations}
            onClick={onApplyAll}
          >
            {applyingModuleOperations ? "Applying..." : "Apply all"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={moduleOperationBusyId === "all" || applyingModuleOperations}
            onClick={onDiscardAll}
          >
            {moduleOperationBusyId === "all" ? "Discarding..." : "Discard all"}
          </Button>
        </div>
      </div>
      <div className="mt-2 space-y-2">
        {changes.map((change) => {
          const compareRows = moduleOperationCompareRows(change);
          const canApplyIndividually = canApplyModuleOperationIndividually(change.operation_type);
          const operationBusy = moduleOperationBusyId === change.id || moduleOperationBusyId === `apply:${change.id}`;
          return (
            <div
              key={change.id}
              className={`rounded-lg border px-3 py-3 ${moduleOperationToneClass(change.operation_type)}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-on-surface">{change.action_label}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-on-surface-variant">
                    {change.detail || change.title || "Module item change"}
                  </p>
                </div>
                <div className="flex flex-none items-center gap-2">
                  <Badge className={`px-2 py-0.5 text-[11px] ${moduleOperationBadgeClass(change.operation_type)}`}>
                    {change.review_status}
                  </Badge>
                  {canApplyIndividually ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={operationBusy || applyingModuleOperations}
                      onClick={() => onApplyOne(change.id)}
                      className="h-auto px-2 py-1 text-[11px]"
                    >
                      {moduleOperationBusyId === `apply:${change.id}` ? "Applying..." : "Apply"}
                    </Button>
                  ) : (
                    <span className="rounded-md bg-white/70 px-2 py-1 text-[11px] font-semibold text-on-surface-variant">
                      Batch only
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={operationBusy}
                    onClick={() => onDiscardOne(change.id)}
                    className="h-auto px-2 py-1 text-[11px]"
                  >
                    {moduleOperationBusyId === change.id ? "..." : "Discard"}
                  </Button>
                </div>
              </div>
              {compareRows.length ? (
                <div className="mt-3 grid gap-2">
                  {compareRows.map((row) => (
                    <div
                      key={row.label}
                      className="grid gap-2 rounded-md bg-white/80 px-3 py-2 text-xs md:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)]"
                    >
                      <p className="font-semibold text-on-surface-variant">{row.label}</p>
                      <p className="min-w-0 truncate text-on-surface-variant">
                        <span className="font-semibold">Before:</span> {formatModuleValue(row.before)}
                      </p>
                      <p className="min-w-0 truncate text-on-surface">
                        <span className="font-semibold">After:</span> {formatModuleValue(row.after)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      </CardBody>
    </Card>
  );
}
