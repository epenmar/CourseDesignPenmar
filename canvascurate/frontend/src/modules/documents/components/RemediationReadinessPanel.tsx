/**
 * Remediation readiness panel for document detail.
 *
 * Renders PDF review next actions, export readiness, tagged-PDF export controls,
 * and replacement/deployment reminders while parent state owns side effects.
 */

import { AlertTriangle, CheckCircle2, Download, ShieldCheck, UploadCloud } from "lucide-react";

import Button from "@/components/edplus/Button";

type ReadinessAction = {
  key: string;
  title: string;
  detail: string;
  status: "ready" | "action";
};

type ExportReadinessIssue = {
  code?: string | null;
  severity?: string | null;
  message?: string | null;
  page_number?: number | null;
  zone_id?: string | null;
  figure_id?: string | null;
};

type PdfExportArtifact = {
  status?: string | null;
  filename?: string | null;
  size_bytes?: number | null;
  generated_at?: string | null;
  export_note?: string | null;
  structure_plan?: {
    node_count?: number | null;
    artifact_count?: number | null;
  } | null;
  export_checks?: {
    status?: string | null;
    language?: string | null;
    marked?: boolean | null;
    has_struct_tree?: boolean | null;
    missing_expected_roles?: string[];
    alt_count?: number | null;
  } | null;
};

type PdfExportQueueResponse = {
  status?: "blocked" | "queued" | string;
  message?: string | null;
  validation?: {
    error_count?: number | null;
    warning_count?: number | null;
  } | null;
};

function formatBytes(value: number | null) {
  if (!value || value < 0) return "Unknown size";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function statusLabel(status: string | null | undefined) {
  const value = String(status || "unreviewed").replace(/_/g, " ");
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function exportReadinessActionLabel(issue: ExportReadinessIssue) {
  const code = issue.code || "";
  if (code.includes("title") || code.includes("language")) return "Edit metadata";
  if (issue.figure_id || code.includes("pdf_figure") || code.includes("pdf_flowchart")) {
    return code.includes("flowchart") ? "Open builder" : "Review figure";
  }
  if (issue.page_number) return "Open page";
  return null;
}

function exportReadinessLabel(status: string | null | undefined) {
  if (status === "ready") return "Ready";
  if (status === "not_ready") return "Blocked";
  return "Review";
}

function exportReadinessClass(status: string | null | undefined) {
  if (status === "ready") return "border-secondary/30 bg-secondary-container/30 text-on-secondary-container";
  if (status === "not_ready") return "border-error/30 bg-error-container text-error";
  return "border-outline-variant/60 bg-surface-container-low text-on-surface-variant";
}

type RemediationReadinessPanelProps = {
  isPdfDocument: boolean;
  readinessActions: ReadinessAction[];
  exportReadinessStatus: string | null | undefined;
  exportReadinessIssueCount: number;
  exportReadinessIssues: ExportReadinessIssue[];
  pdfExportArtifact: PdfExportArtifact | null | undefined;
  pdfExportQueueResult: PdfExportQueueResponse | null | undefined;
  downloadingPdfExport: "original" | "artifact" | null;
  preparingPdfExport: boolean;
  linkedCount: number;
  isOrphaned: boolean;
  hasActiveCanvasPlacement: boolean;
  archiveBlockReason: string;
  onOpenTagFlow: () => void;
  onExportReadinessIssue: (issue: ExportReadinessIssue) => void;
  onDownloadPdfExport: (kind: "original" | "artifact") => void;
  onPreparePdfExport: () => void;
};

export default function RemediationReadinessPanel({
  isPdfDocument,
  readinessActions,
  exportReadinessStatus,
  exportReadinessIssueCount,
  exportReadinessIssues,
  pdfExportArtifact,
  pdfExportQueueResult,
  downloadingPdfExport,
  preparingPdfExport,
  linkedCount,
  isOrphaned,
  hasActiveCanvasPlacement,
  archiveBlockReason,
  onOpenTagFlow,
  onExportReadinessIssue,
  onDownloadPdfExport,
  onPreparePdfExport,
}: RemediationReadinessPanelProps) {
  const hasPdfExportArtifact = Boolean(pdfExportArtifact?.status || pdfExportArtifact?.filename);
  const pdfExportQueueValidation = pdfExportQueueResult?.validation;
  const pdfExportQueueBlocked = pdfExportQueueResult?.status === "blocked";
  const pdfExportQueueQueued = pdfExportQueueResult?.status === "queued";

  return (
    <div className="rounded-3xl bg-surface-container-low p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <UploadCloud className="text-primary" size={20} />
            <h2 className="font-headline text-lg font-bold text-on-surface">Remediation Readiness</h2>
          </div>
          <p className="mt-1 text-sm text-on-surface-variant">
            Next actions before producing and deploying an accessible replacement.
          </p>
        </div>
        {isPdfDocument ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${exportReadinessClass(exportReadinessStatus)}`}>
              Export: {exportReadinessLabel(exportReadinessStatus)} · {exportReadinessIssueCount} item{exportReadinessIssueCount === 1 ? "" : "s"}
            </span>
            <Button
              type="button"
              onClick={onOpenTagFlow}
            >
              Open TagFlow
            </Button>
          </div>
        ) : null}
      </div>
      <div className="mt-4 space-y-3 text-sm">
        {isPdfDocument ? (
          <div className="rounded-2xl bg-surface-container-lowest p-3">
            <p className="font-semibold text-on-surface">Next actions</p>
            <div className="mt-3 space-y-2">
              {readinessActions.map((action) => (
                <div key={action.key} className="flex items-start gap-3">
                  {action.status === "ready"
                    ? <CheckCircle2 className="mt-0.5 text-primary" size={17} />
                    : <AlertTriangle className="mt-0.5 text-error" size={17} />}
                  <div>
                    <p className="font-semibold text-on-surface">{action.title}</p>
                    <p className="text-on-surface-variant">{action.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {isPdfDocument && exportReadinessIssues.length ? (
          <div className="rounded-2xl bg-surface-container-lowest p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-on-surface">Export readiness</p>
              <span className="shrink-0 rounded-full bg-surface-container-low px-2 py-0.5 text-xs font-semibold text-on-surface-variant">
                {exportReadinessIssues.length} item{exportReadinessIssues.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
              {exportReadinessIssues.map((issue, index) => (
                <div key={`${issue.code || "issue"}-${issue.page_number || "document"}-${index}`} className="flex items-start gap-3">
                  {issue.severity === "error"
                    ? <AlertTriangle className="mt-0.5 text-error" size={17} />
                    : <AlertTriangle className="mt-0.5 text-on-surface-variant" size={17} />}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-on-surface">
                      {issue.page_number ? `Page ${issue.page_number}` : "Document"}
                    </p>
                    <p className="text-on-surface-variant">{issue.message || statusLabel(issue.code)}</p>
                  </div>
                  {exportReadinessActionLabel(issue) ? (
                    <Button
                      type="button"
                      onClick={() => onExportReadinessIssue(issue)}
                      variant="ghost"
                      size="sm"
                      className="h-auto shrink-0 px-2.5 py-1 text-xs"
                    >
                      {exportReadinessActionLabel(issue)}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {isPdfDocument ? (
          <div className="rounded-2xl bg-surface-container-lowest p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-semibold text-on-surface">Tagged PDF export</p>
                <p className="mt-1 text-on-surface-variant">
                  Generate the current PDF artifact and keep the original available for download.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => onDownloadPdfExport("original")}
                  disabled={downloadingPdfExport !== null}
                  loading={downloadingPdfExport === "original"}
                  variant="ghost"
                  size="sm"
                  icon={<Download size={14} />}
                  className="text-xs"
                >
                  {downloadingPdfExport === "original" ? "Downloading" : "Original"}
                </Button>
                {hasPdfExportArtifact ? (
                  <Button
                    type="button"
                    onClick={() => onDownloadPdfExport("artifact")}
                    disabled={downloadingPdfExport !== null}
                    loading={downloadingPdfExport === "artifact"}
                    variant="secondary"
                    size="sm"
                    icon={<Download size={14} />}
                    className="text-xs"
                  >
                    {downloadingPdfExport === "artifact" ? "Downloading" : "Exported PDF"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  onClick={onPreparePdfExport}
                  disabled={preparingPdfExport}
                  loading={preparingPdfExport}
                  size="sm"
                  className="text-xs"
                >
                  {preparingPdfExport ? "Preparing..." : hasPdfExportArtifact ? "Regenerate export" : "Prepare export"}
                </Button>
              </div>
            </div>
            {hasPdfExportArtifact ? (
              <div className="mt-3 rounded-xl bg-secondary-container/25 px-3 py-2 text-xs text-on-secondary-container">
                <p className="font-semibold">{pdfExportArtifact?.filename || "Exported PDF"} is ready.</p>
                <p className="mt-1">
                  {formatBytes(pdfExportArtifact?.size_bytes ?? null)}
                  {pdfExportArtifact?.generated_at ? ` / Generated ${new Date(pdfExportArtifact.generated_at).toLocaleString()}` : ""}
                </p>
                {pdfExportArtifact?.export_note ? (
                  <p className="mt-1 text-on-surface-variant">{pdfExportArtifact.export_note}</p>
                ) : null}
                {pdfExportArtifact?.structure_plan ? (
                  <p className="mt-1 text-on-surface-variant">
                    Structure plan: {pdfExportArtifact.structure_plan.node_count ?? 0} content node{(pdfExportArtifact.structure_plan.node_count ?? 0) === 1 ? "" : "s"}
                    {typeof pdfExportArtifact.structure_plan.artifact_count === "number" ? ` / ${pdfExportArtifact.structure_plan.artifact_count} artifact zone${pdfExportArtifact.structure_plan.artifact_count === 1 ? "" : "s"} skipped` : ""}
                  </p>
                ) : null}
                {pdfExportArtifact?.export_checks ? (
                  <div className="mt-2 rounded-lg bg-surface-container-lowest px-3 py-2 text-on-surface-variant">
                    <p className="font-semibold text-on-surface">
                      Export inspection: {statusLabel(pdfExportArtifact.export_checks.status)}
                    </p>
                    <p className="mt-1">
                      {pdfExportArtifact.export_checks.marked ? "Marked PDF" : "Marked flag missing"}
                      {" / "}
                      {pdfExportArtifact.export_checks.has_struct_tree ? "Structure tree detected" : "Structure tree missing"}
                      {pdfExportArtifact.export_checks.language ? ` / Lang ${pdfExportArtifact.export_checks.language}` : " / Language missing"}
                      {typeof pdfExportArtifact.export_checks.alt_count === "number" ? ` / ${pdfExportArtifact.export_checks.alt_count} alt entr${pdfExportArtifact.export_checks.alt_count === 1 ? "y" : "ies"}` : ""}
                    </p>
                    {pdfExportArtifact.export_checks.missing_expected_roles?.length ? (
                      <p className="mt-1 text-error">
                        Missing expected roles: {pdfExportArtifact.export_checks.missing_expected_roles.join(", ")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            {pdfExportQueueResult ? (
              <div className={`mt-3 rounded-xl px-3 py-2 ${pdfExportQueueBlocked ? "bg-error-container/50 text-error" : "bg-secondary-container/35 text-on-secondary-container"}`}>
                <div className="flex items-start gap-2">
                  {pdfExportQueueBlocked ? <AlertTriangle className="mt-0.5 shrink-0" size={16} /> : <CheckCircle2 className="mt-0.5 shrink-0" size={16} />}
                  <div>
                    <p className="font-semibold">
                      {pdfExportQueueBlocked
                        ? "Export is blocked"
                        : pdfExportQueueQueued
                          ? "Export job queued"
                          : statusLabel(pdfExportQueueResult.status)}
                    </p>
                    <p className="mt-1 text-xs">
                      {pdfExportQueueBlocked
                        ? `${pdfExportQueueValidation?.error_count ?? 0} blocking issue${(pdfExportQueueValidation?.error_count ?? 0) === 1 ? "" : "s"} must be fixed before export.`
                        : pdfExportQueueResult.message || "Validation passed. Tagged-PDF generation remains the next implementation slice."}
                    </p>
                    {(pdfExportQueueValidation?.warning_count ?? 0) > 0 ? (
                      <p className="mt-1 text-xs">
                        {pdfExportQueueValidation?.warning_count} warning{pdfExportQueueValidation?.warning_count === 1 ? "" : "s"} remain available for review.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-start gap-3 rounded-2xl bg-surface-container-lowest p-3">
          {linkedCount > 0 ? <CheckCircle2 className="mt-0.5 text-primary" size={17} /> : <AlertTriangle className="mt-0.5 text-error" size={17} />}
          <div>
            <p className="font-semibold text-on-surface">Reference map</p>
            <p className="text-on-surface-variant">{linkedCount} references would need review before deploying a replacement.</p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-2xl bg-surface-container-lowest p-3">
          <ShieldCheck className="mt-0.5 text-primary" size={17} />
          <div>
            <p className="font-semibold text-on-surface">Job boundary</p>
            <p className="text-on-surface-variant">Replacement and tagged-PDF export will run through background jobs.</p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-2xl bg-surface-container-lowest p-3">
          {isOrphaned ? <AlertTriangle className="mt-0.5 text-error" size={17} /> : <CheckCircle2 className="mt-0.5 text-primary" size={17} />}
          <div>
            <p className="font-semibold text-on-surface">Canvas deployment</p>
            <p className="text-on-surface-variant">
              {!hasActiveCanvasPlacement ? "This file is not currently linked or placed in module inventory." : archiveBlockReason}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
