/**
 * Replacement candidate panel for document detail.
 *
 * Shows uploaded/generated replacement state, deployment status, lightweight
 * replacement checks, and the action that opens reference selection.
 */

import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";

import Button from "@/components/edplus/Button";

type AccessibilityReview = {
  issues?: { code: string; message: string }[];
};

type ReplacementCandidate = {
  id?: string | null;
  status: string;
  filename?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  uploaded_at?: string | null;
  source?: string | null;
  export_generation_mode?: string | null;
  initial_accessibility_review?: AccessibilityReview | null;
  reference_review?: {
    linked_count: number;
  } | null;
  canvas_deployment?: {
    canvas_file_id: string | null;
    canvas_url: string | null;
    selected_reference_count?: number | null;
    revision_count?: number | null;
    queued_at?: string | null;
    deployed_at?: string | null;
  };
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

function canvasFilePageUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/(preview|download)$/, "");
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split("#", 1)[0].split("?", 1)[0].replace(/\/(preview|download)$/, "");
  }
}

function fileExtension(filename: string | null | undefined) {
  if (!filename) return "";
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function statusLabel(status: string | null | undefined) {
  const value = String(status || "unreviewed").replace(/_/g, " ");
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function replacementSourceLabel(source: string | null | undefined) {
  if (source === "generated_pdf_export") return "Generated export";
  if (source === "manual_replacement_upload") return "Manual upload";
  return statusLabel(source || "replacement");
}

function exportGenerationLabel(mode: string | null | undefined) {
  if (mode === "planned_structure_tree") return "Structure tree export";
  if (mode === "metadata_only") return "Metadata export";
  return "Generated export";
}

type ReplacementCandidatePanelProps = {
  replacement: ReplacementCandidate | null | undefined;
  replacementStatusText: string;
  replacementDeploymentStatus: string;
  replacementCanvasDeployed: boolean;
  replacementDeploymentActive: boolean;
  referencesReviewed: boolean;
  linkedCount: number;
  deployingReplacement: boolean;
  onOpenDeployModal: () => void;
};

export default function ReplacementCandidatePanel({
  replacement,
  replacementStatusText,
  replacementDeploymentStatus,
  replacementCanvasDeployed,
  replacementDeploymentActive,
  referencesReviewed,
  linkedCount,
  deployingReplacement,
  onOpenDeployModal,
}: ReplacementCandidatePanelProps) {
  const replacementIssues = replacement?.initial_accessibility_review?.issues ?? [];
  const replacementIsPdf = replacement ? fileExtension(replacement.filename) === "pdf" || replacement.content_type === "application/pdf" : false;
  const replacementDeployment = replacement?.canvas_deployment ?? null;

  return (
    <div className="rounded-3xl bg-surface-container-lowest p-5 shadow-sm">
      <h2 className="font-headline text-lg font-bold text-on-surface">Replacement Candidate</h2>
      {replacement ? (
        <div className="mt-4 space-y-3 text-sm">
          <div className="rounded-2xl bg-surface-container-low p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-on-surface">{replacement.filename || "Replacement file"}</p>
                <p className="mt-1 text-xs text-on-surface-variant">
                  {formatBytes(replacement.size_bytes ?? null)}
                  {replacement.uploaded_at ? ` / Uploaded ${new Date(replacement.uploaded_at).toLocaleString()}` : ""}
                </p>
              </div>
              <span className="rounded-full border border-outline-variant/60 bg-surface-container-lowest px-3 py-1 text-xs font-semibold text-on-surface-variant">
                {replacementStatusText}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-surface-container-lowest px-3 py-1 text-xs font-semibold text-on-surface-variant">
                {replacementSourceLabel(replacement.source)}
              </span>
              {replacement.source === "generated_pdf_export" ? (
                <span className="rounded-full bg-secondary-container/40 px-3 py-1 text-xs font-semibold text-on-secondary-container">
                  {exportGenerationLabel(replacement.export_generation_mode)}
                </span>
              ) : null}
            </div>
            {replacement.source === "generated_pdf_export" ? (
              <p className="mt-3 text-xs text-on-surface-variant">
                This candidate was generated from the PDF export job. It is deployable now; marked-content binding remains the next export slice before final PDF/UA output.
              </p>
            ) : null}
          </div>
          {replacementDeploymentStatus !== "not_deployed" ? (
            <div className={`rounded-2xl border p-4 ${
              replacementCanvasDeployed
                ? "border-secondary/30 bg-secondary-container/25"
                : "border-primary/20 bg-primary/10"
            }`}>
              <div className="flex items-start gap-3">
                {replacementCanvasDeployed
                  ? <CheckCircle2 className="mt-0.5 text-primary" size={17} />
                  : <RefreshCw className="mt-0.5 text-primary" size={17} />}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-on-surface">
                    {replacementCanvasDeployed ? "Deployed to Canvas" : "Deployment queued"}
                  </p>
                  <p className="mt-1 text-on-surface-variant">
                    {replacementCanvasDeployed
                      ? `Uploaded Canvas file ${replacementDeployment?.canvas_file_id || ""}`.trim()
                      : "The replacement deployment job is waiting or running."}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-on-surface-variant">
                    {typeof replacementDeployment?.selected_reference_count === "number" ? (
                      <span>{replacementDeployment.selected_reference_count} selected reference{replacementDeployment.selected_reference_count === 1 ? "" : "s"}</span>
                    ) : null}
                    {typeof replacementDeployment?.revision_count === "number" ? (
                      <span>{replacementDeployment.revision_count} pending revision{replacementDeployment.revision_count === 1 ? "" : "s"}</span>
                    ) : null}
                    {replacementDeployment?.deployed_at ? (
                      <span>Deployed {new Date(replacementDeployment.deployed_at).toLocaleString()}</span>
                    ) : replacementDeployment?.queued_at ? (
                      <span>Queued {new Date(replacementDeployment.queued_at).toLocaleString()}</span>
                    ) : null}
                  </div>
                  {replacementDeployment?.canvas_url ? (
                    <Link
                      href={canvasFilePageUrl(replacementDeployment.canvas_url) || replacementDeployment.canvas_url}
                      target="_blank"
                      className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      Open Canvas file <ExternalLink size={13} />
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          <div className="rounded-2xl bg-surface-container-low p-4">
            <div className="flex items-start gap-3">
              {referencesReviewed ? <CheckCircle2 className="mt-0.5 text-primary" size={17} /> : <AlertTriangle className="mt-0.5 text-error" size={17} />}
              <div>
                <p className="font-semibold text-on-surface">Reference review</p>
                <p className="mt-1 text-on-surface-variant">
                  {referencesReviewed
                    ? `Reviewed ${replacement.reference_review?.linked_count ?? linkedCount} reference${(replacement.reference_review?.linked_count ?? linkedCount) === 1 ? "" : "s"}.`
                    : `${linkedCount} reference${linkedCount === 1 ? "" : "s"} must be reviewed before deployment.`}
                </p>
              </div>
            </div>
          </div>
          <div className={`rounded-2xl border p-4 ${replacementIssues.length ? "border-error/25 bg-error-container/45" : "border-secondary/30 bg-secondary-container/25"}`}>
            <p className="font-semibold text-on-surface">
              {replacementIssues.length
                ? `${replacementIssues.length} replacement PDF finding${replacementIssues.length === 1 ? "" : "s"}`
                : replacementIsPdf
                  ? "Initial replacement check passed"
                  : "PDF accessibility check not applicable"}
            </p>
            {replacementIssues.length ? (
              <ul className="mt-3 space-y-2">
                {replacementIssues.slice(0, 3).map((issue) => (
                  <li key={`${replacement.id}:${issue.code}`} className="text-sm text-on-surface">
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-on-surface-variant">
                {replacementIsPdf
                  ? "No issues were detected by the lightweight PDF probe."
                  : "This replacement type can be deployed to Canvas, but the current accessibility probe only checks PDFs."}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              onClick={onOpenDeployModal}
              disabled={deployingReplacement || replacementDeploymentActive || replacementCanvasDeployed}
              loading={deployingReplacement}
            >
              {replacementCanvasDeployed
                ? "Deployed to Canvas"
                : replacementDeploymentActive
                  ? "Deployment queued"
                  : deployingReplacement
                    ? "Queuing deployment"
                    : "Deploy replacement to Canvas"}
            </Button>
            <p className="text-xs text-on-surface-variant">
              {replacementCanvasDeployed
                ? "Generate a new export if you need to deploy another replacement version."
                : "You will choose which references should point to this replacement before the deployment job starts."}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl bg-surface-container-low p-4 text-sm text-on-surface-variant">
          Upload a replacement candidate here first. Canvas deployment and link rewrites stay blocked until references are reviewed.
        </div>
      )}
    </div>
  );
}
