/**
 * Accessibility findings panel for document detail.
 *
 * Renders stored per-document findings without owning analysis state.
 */

import { ShieldCheck } from "lucide-react";

type AnalysisFinding = {
  code: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  message: string;
  source: string;
};

function severityClass(severity: AnalysisFinding["severity"]) {
  if (severity === "critical" || severity === "high") return "border-error/30 bg-error-container text-error";
  if (severity === "medium") return "border-secondary/40 bg-secondary-container/35 text-on-secondary-container";
  return "border-outline-variant/60 bg-surface-container-low text-on-surface-variant";
}

export default function AccessibilityFindingsPanel({ findings }: { findings: AnalysisFinding[] }) {
  return (
    <div className="rounded-3xl bg-surface-container-lowest p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-outline-variant/40 pb-4">
        <div>
          <h2 className="font-headline text-xl font-bold text-on-surface">Accessibility Findings</h2>
          <p className="mt-1 text-sm text-on-surface-variant">Stored on this document record for later remediation and export jobs.</p>
        </div>
        <ShieldCheck className="text-primary" size={22} />
      </div>
      <div className="mt-4 max-h-[360px] space-y-3 overflow-y-auto pr-1">
        {findings.length ? findings.map((finding) => (
          <div key={`${finding.code}:${finding.source}`} className="rounded-2xl border border-outline-variant/35 bg-surface-container-low p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${severityClass(finding.severity)}`}>
                {finding.severity}
              </span>
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">{finding.source}</span>
            </div>
            <p className="mt-3 text-sm text-on-surface">{finding.message}</p>
          </div>
        )) : (
          <p className="rounded-2xl bg-surface-container-low p-4 text-sm text-on-surface-variant">No accessibility findings are currently stored for this document.</p>
        )}
      </div>
    </div>
  );
}
