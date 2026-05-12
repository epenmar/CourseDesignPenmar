/**
 * Original-file cleanup controls for document detail.
 *
 * Keeps cleanup and archive rendering outside the document detail manager while
 * callbacks stay owned by the parent workflow.
 */

import Button from "@/components/edplus/Button";

type CleanupAction = "keep" | "delete" | "defer";

type CanvasArchive = {
  folder_name?: string | null;
  folder_path?: string | null;
};

type ArchiveJob = {
  error_message: string | null;
};

type OriginalCleanupPanelProps = {
  cleanupDecision: CleanupAction | null;
  decisionReason: string | null;
  replacementDeployed: boolean;
  archiveBlockedByPlacement: boolean;
  archiveBlockReason: string;
  canvasArchive: CanvasArchive | null | undefined;
  latestArchiveJob: ArchiveJob | null;
  archiveActive: boolean;
  archiveSucceeded: boolean;
  hasActiveCanvasPlacement: boolean;
  savingCleanupDecision: CleanupAction | null;
  archivingOriginal: boolean;
  onSaveCleanupDecision: (action: CleanupAction) => void;
  onArchiveOriginal: () => void;
};

export default function OriginalCleanupPanel({
  cleanupDecision,
  decisionReason,
  replacementDeployed,
  archiveBlockedByPlacement,
  archiveBlockReason,
  canvasArchive,
  latestArchiveJob,
  archiveActive,
  archiveSucceeded,
  hasActiveCanvasPlacement,
  savingCleanupDecision,
  archivingOriginal,
  onSaveCleanupDecision,
  onArchiveOriginal,
}: OriginalCleanupPanelProps) {
  return (
    <div className="rounded-3xl bg-surface-container-lowest p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-headline text-lg font-bold text-on-surface">Original Cleanup</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Inventory decision for the replaced original file.
          </p>
        </div>
        <span className="rounded-full border border-outline-variant/60 bg-surface-container-low px-3 py-1 text-xs font-semibold text-on-surface-variant">
          {cleanupDecision === "delete" ? "cleanup" : cleanupDecision ?? "unreviewed"}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {([
          ["keep", "Keep original"],
          ["delete", "Mark cleanup"],
          ["defer", "Defer"],
        ] as const).map(([action, label]) => (
          <Button
            key={action}
            type="button"
            onClick={() => onSaveCleanupDecision(action)}
            disabled={Boolean(savingCleanupDecision)}
            loading={savingCleanupDecision === action}
            variant={cleanupDecision === action ? "primary" : "ghost"}
            className="w-full"
          >
            {savingCleanupDecision === action ? "Saving" : label}
          </Button>
        ))}
      </div>
      {!replacementDeployed ? (
        <p className="mt-3 text-xs text-on-surface-variant">Deploy a replacement before archiving the original.</p>
      ) : archiveBlockedByPlacement ? (
        <p className="mt-3 text-xs text-on-surface-variant">
          {archiveBlockReason} Remove old placements, push replacement revisions if needed, and resync before archiving.
        </p>
      ) : null}
      {decisionReason ? (
        <p className="mt-3 text-xs text-on-surface-variant">{decisionReason}</p>
      ) : null}
      <div className="mt-4 rounded-2xl bg-surface-container-low p-4 text-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-on-surface">
              {archiveSucceeded ? "Archived in Canvas" : archiveActive ? "Archive in progress" : "Canvas Archive"}
            </p>
            <p className="mt-1 text-xs text-on-surface-variant">
              {canvasArchive?.folder_path || canvasArchive?.folder_name || "CanvasCurate Archive"}
            </p>
          </div>
          <Button
            type="button"
            onClick={onArchiveOriginal}
            disabled={!replacementDeployed || hasActiveCanvasPlacement || cleanupDecision !== "delete" || archiveActive || archiveSucceeded || archivingOriginal}
            loading={archiveActive || archivingOriginal}
            variant="secondary"
            size="sm"
            className="text-xs"
          >
            {archiveActive || archivingOriginal ? "Archiving" : archiveSucceeded ? "Archived" : "Move to archive"}
          </Button>
        </div>
        {cleanupDecision !== "delete" && !archiveSucceeded ? (
          <p className="mt-3 text-xs text-on-surface-variant">Mark cleanup before moving the original file.</p>
        ) : null}
        {latestArchiveJob?.error_message ? (
          <p className="mt-3 text-xs text-error">{latestArchiveJob.error_message}</p>
        ) : null}
      </div>
    </div>
  );
}
