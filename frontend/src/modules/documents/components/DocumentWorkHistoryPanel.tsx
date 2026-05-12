/**
 * Document detail work-history panel.
 *
 * Renders the normalized document activity timeline without owning fetch or
 * mutation behavior.
 */

type WorkHistoryEvent = {
  id: string;
  occurred_at: string | null;
  type: string;
  status: string;
  label: string;
  summary: string;
  source_table: string;
};

function historyStatusClass(status: string) {
  if (status === "failed" || status === "cancelled") return "border-error/30 bg-error-container text-error";
  if (status === "succeeded" || status === "applied" || status === "recorded") return "border-secondary/30 bg-secondary-container/30 text-on-secondary-container";
  if (status === "queued" || status === "running" || status === "retrying") return "border-primary/20 bg-primary/10 text-primary";
  return "border-outline-variant/60 bg-surface-container-low text-on-surface-variant";
}

function historyTypeLabel(type: string) {
  return type.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export default function DocumentWorkHistoryPanel({ workHistory }: { workHistory: WorkHistoryEvent[] }) {
  return (
    <div className="rounded-3xl bg-surface-container-lowest p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-headline text-lg font-bold text-on-surface">Document Work History</h2>
          <p className="mt-1 text-sm text-on-surface-variant">Analysis, replacement, cleanup, archive, and recorded audit actions.</p>
        </div>
        <span className="rounded-full border border-outline-variant/60 bg-surface-container-low px-3 py-1 text-xs font-semibold text-on-surface-variant">
          {workHistory.length}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {workHistory.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No work history has been recorded for this document.</p>
        ) : workHistory.slice(0, 10).map((entry) => (
          <div key={entry.id} className="rounded-2xl bg-surface-container-low px-3 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-on-surface">{entry.label}</p>
                <p className="mt-1 text-xs text-on-surface-variant">{entry.summary}</p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${historyStatusClass(entry.status)}`}>
                {entry.status}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
              <span>{entry.occurred_at ? new Date(entry.occurred_at).toLocaleString() : "No timestamp"}</span>
              <span>{historyTypeLabel(entry.type)}</span>
              <span>{entry.source_table}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
