/**
 * Transfer readiness summary counts for modules and content types.
 */

import type { TransferReadiness } from "../types";

const countLabels: Array<[keyof TransferReadiness["summary"]["content_counts"], string]> = [
  ["page", "Pages"],
  ["assignment", "Assignments"],
  ["discussion", "Discussions"],
  ["quiz", "Quizzes"],
  ["file", "Files"],
];

export default function TransferSummaryPanel({ readiness }: { readiness: TransferReadiness }) {
  return (
    <section className="space-y-6 rounded-xl bg-surface-container-low p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="text-sm font-bold uppercase tracking-widest text-primary/80">Content Summary</h4>
        <span className="text-xs font-medium text-on-surface-variant">
          {readiness.session.is_course_creation_export ? "Canvas Create export" : "Canvas Clean session"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {countLabels.map(([key, label]) => (
          <div key={key} className="flex flex-col items-center justify-center gap-2 rounded-lg bg-surface-container-lowest p-4 ghost-border">
            <span className="font-headline text-2xl font-black text-on-surface">{readiness.summary.content_counts[key]}</span>
            <span className="text-[10px] font-bold uppercase text-on-surface-variant">{label}</span>
          </div>
        ))}
      </div>
      <div className="grid gap-3 border-t border-outline-variant/20 pt-4 text-xs font-semibold text-on-surface-variant md:grid-cols-5">
        <span>{readiness.summary.module_count} modules</span>
        <span>{readiness.summary.module_item_count} items in modules</span>
        <span>{readiness.summary.transferable_content_count} transferable items</span>
        <span>{readiness.summary.referenced_file_count ?? 0} referenced files/images</span>
        <span>{readiness.summary.pending_content_count} content drafts ready</span>
      </div>
    </section>
  );
}
