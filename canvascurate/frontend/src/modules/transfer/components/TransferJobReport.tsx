/**
 * Compact transfer job result report.
 *
 * The backend stores this inside the existing background job result so the UI
 * can explain creates, updates, deletions, protected skips, and errors without
 * issuing additional report requests after a transfer completes.
 */

import type { TransferJobReport, TransferJobReportCategory, TransferJobReportItem } from "../types";

const SECTION_ORDER: Array<{
  key: TransferJobReportCategory;
  title: string;
  tone: "default" | "success" | "warning" | "error";
}> = [
  { key: "errors", title: "Errors", tone: "error" },
  { key: "warnings", title: "Warnings", tone: "warning" },
  { key: "protected", title: "Protected Items", tone: "warning" },
  { key: "skipped", title: "Skipped Items", tone: "warning" },
  { key: "updated", title: "Updated", tone: "success" },
  { key: "created", title: "Created", tone: "success" },
  { key: "deleted", title: "Deleted", tone: "error" },
  { key: "migrated_files", title: "Migrated Files", tone: "success" },
  { key: "placed", title: "Placed in Modules", tone: "default" },
];

function sectionClass(tone: "default" | "success" | "warning" | "error") {
  if (tone === "error") return "border-error/30 bg-error-container/35";
  if (tone === "warning") return "border-secondary/30 bg-secondary-container/15";
  if (tone === "success") return "border-[#446D12]/20 bg-[#446D12]/5";
  return "border-outline-variant/20 bg-surface-container-lowest";
}

function itemToneClass(item: TransferJobReportItem, tone: "default" | "success" | "warning" | "error") {
  if (item.status === "error" || tone === "error") return "text-error";
  if (item.status === "warning" || item.status === "skipped" || tone === "warning") return "text-secondary";
  if (item.status === "done" || tone === "success") return "text-[#446D12]";
  return "text-on-surface-variant";
}

export default function TransferJobReportPanel({ report }: { report?: TransferJobReport | null }) {
  const sections = SECTION_ORDER.map((section) => ({
    ...section,
    items: report?.[section.key] ?? [],
  })).filter((section) => section.items.length > 0);

  if (!sections.length) return null;

  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs font-bold text-on-surface">Transfer result report</p>
      {sections.map((section) => (
        <div key={section.key} className={`rounded-xl border p-3 ${sectionClass(section.tone)}`}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold text-on-surface">{section.title}</p>
            <span className="rounded-full bg-surface-container-lowest px-2 py-0.5 text-[10px] font-bold text-on-surface-variant">
              {section.items.length}
            </span>
          </div>
          <div className="mt-2 max-h-36 space-y-2 overflow-y-auto">
            {section.items.slice(0, 12).map((item, index) => (
              <div key={`${section.key}-${item.title}-${index}`} className="text-xs">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 font-semibold text-on-surface">{item.title}</p>
                  {item.content_type ? (
                    <span className="flex-none rounded-full bg-surface-container-high px-2 py-0.5 text-[9px] font-bold uppercase text-on-surface-variant">
                      {item.content_type}
                    </span>
                  ) : null}
                </div>
                {item.reason ? <p className={`mt-0.5 ${itemToneClass(item, section.tone)}`}>{item.reason}</p> : null}
              </div>
            ))}
          </div>
          {section.items.length > 12 ? (
            <p className="mt-2 text-[10px] text-on-surface-variant">
              {section.items.length - 12} more item(s) are included in this report section.
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
