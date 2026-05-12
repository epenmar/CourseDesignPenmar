"use client";

/**
 * Displays saved local revisions for a Canvas content item.
 */

export type RevisionRow = {
  id: string;
  revision_number: number;
  before_title: string | null;
  after_title: string | null;
  change_summary: string | null;
  created_at: string;
};

type RevisionHistoryPanelProps = {
  className?: string;
  formatDate: (value: string) => string;
  loading: boolean;
  onRestore: (revisionId: string, revisionNumber: number) => void;
  restoringRevisionId: string | null;
  revisions: RevisionRow[];
};

export function RevisionHistoryPanel({
  className = "",
  formatDate,
  loading,
  onRestore,
  restoringRevisionId,
  revisions,
}: RevisionHistoryPanelProps) {
  return (
    <div className={`mt-6 border-t border-outline-variant/30 py-5 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
            Revisions
          </p>
          <p className="mt-1 text-sm text-on-surface-variant">
            Saved changes are versioned per content item.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 text-sm text-on-surface-variant">Loading revisions...</div>
      ) : revisions.length === 0 ? (
        <div className="mt-4 text-sm text-on-surface-variant">No revisions saved for this item yet.</div>
      ) : (
        <div className="mt-4 space-y-3">
          {revisions.map((revision) => (
            <div key={revision.id} className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-on-surface">
                  Revision {revision.revision_number}
                </div>
                <div className="text-xs text-on-surface-variant">
                  {formatDate(revision.created_at)}
                </div>
              </div>
              <div className="mt-2 text-sm text-on-surface-variant">
                {revision.change_summary || "No summary provided."}
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  disabled={restoringRevisionId === revision.id}
                  onClick={() => onRestore(revision.id, revision.revision_number)}
                  className="rounded-lg bg-surface-container-high px-3 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-dim disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {restoringRevisionId === revision.id ? "Restoring..." : "Restore"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
