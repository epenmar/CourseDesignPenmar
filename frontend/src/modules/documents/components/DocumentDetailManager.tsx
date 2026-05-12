"use client";

/**
 * Document remediation detail workspace.
 *
 * Manages PDF review status, TagFlow entry points, metadata readiness,
 * figure review, replacement deployment, reference review, and original-file
 * cleanup for a single Canvas document.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  FileText,
  HelpCircle,
  RefreshCw,
  UploadCloud,
  X,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import TagFlowStructurePreview, { type TagFlowPreviewPage } from "@/modules/tagflow/components/TagFlowStructurePreview";
import Tooltip from "@/components/ui/Tooltip";
import AccessibilityFindingsPanel from "@/modules/documents/components/AccessibilityFindingsPanel";
import DocumentWorkHistoryPanel from "@/modules/documents/components/DocumentWorkHistoryPanel";
import OriginalCleanupPanel from "@/modules/documents/components/OriginalCleanupPanel";
import PdfExtractionPanel, {
  CUSTOM_PDF_LANGUAGE_VALUE,
  pdfLanguageUsesCustomMode,
} from "@/modules/documents/components/PdfExtractionPanel";
import ReferenceReviewPanel from "@/modules/documents/components/ReferenceReviewPanel";
import ReplacementCandidatePanel from "@/modules/documents/components/ReplacementCandidatePanel";
import RemediationReadinessPanel from "@/modules/documents/components/RemediationReadinessPanel";
import TagFlowPagePreviewModal from "@/modules/documents/components/TagFlowPagePreviewModal";
import TagFlowPagesPanel from "@/modules/documents/components/TagFlowPagesPanel";
import FlowchartBuilderModal from "@/modules/tagflow/components/FlowchartBuilderModal";
import FlowchartVisualAnnotator from "@/modules/tagflow/components/FlowchartVisualAnnotator";
import type { FlowchartConnection, FlowchartNode, FlowchartStructure } from "@/modules/tagflow/types";
import { emptyFlowchartStructure, normalizeFlowchartStructure } from "@/modules/tagflow/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";
const ASU_CANVAS_BASE_URL = "https://canvas.asu.edu";
const REPLACEMENT_ACCEPT = ".pdf,.doc,.docx,.ppt,.pptx,.csv,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const REPLACEMENT_EXTENSIONS = new Set(["csv", "doc", "docx", "pdf", "ppt", "pptx", "xls", "xlsx"]);
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "retrying"]);
const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

type LinkedFrom = {
  content_item_id: string;
  content_title: string | null;
  content_type: string;
  content_canvas_url: string | null;
  module_name: string | null;
  link_index: number;
  href: string;
  text: string | null;
  issue_code: string | null;
  is_filename_label: boolean;
};

type SourceContentItem = {
  id: string;
  title: string | null;
  content_type: string;
  canvas_url: string | null;
  module_name: string | null;
};

type AccessibilityReview = {
  status?: string;
  page_count?: number | null;
  issues?: { code: string; message: string }[];
};

type InventoryDecision = {
  id: string;
  content_item_id: string;
  action: "keep" | "delete" | "defer";
  reason: string | null;
  applied_to_canvas: boolean | null;
  applied_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type CanvasArchive = {
  status: string;
  job_id?: string | null;
  archived_at?: string | null;
  canvas_file_id?: string | null;
  folder_id?: string | number | null;
  folder_name?: string | null;
  folder_path?: string | null;
};

type StandaloneCanvasDeployment = {
  status?: string | null;
  job_id?: string | null;
  canvas_base_url?: string | null;
  canvas_course_id?: string | null;
  canvas_file_id?: string | null;
  canvas_url?: string | null;
  canvas_file_page_url?: string | null;
  canvas_html_url?: string | null;
  canvas_preview_url?: string | null;
  canvas_download_url?: string | null;
  filename?: string | null;
  deployed_at?: string | null;
};

type DocumentRow = {
  id: string;
  canvas_id: string | null;
  title: string | null;
  filename: string | null;
  extension: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  folder_name: string | null;
  folder_path: string | null;
  canvas_url: string | null;
  published: boolean | null;
  module_canvas_id?: string | null;
  module_name: string | null;
  is_orphaned: boolean;
  uploaded_via?: string | null;
  accessibility_status?: "needs_review" | "passed_initial_check" | "not_checked" | "unsupported_file_type";
  accessibility_issue_count?: number;
  accessibility_review?: AccessibilityReview | null;
  source_content_item?: SourceContentItem | null;
  linked_from: LinkedFrom[];
  linked_count: number;
  filename_link_count: number;
  generic_link_count: number;
  document_analysis?: DocumentAnalysis | null;
  document_remediation?: DocumentRemediationPlan | null;
  replacement_candidate?: ReplacementCandidate | null;
  standalone_canvas_deployment?: StandaloneCanvasDeployment | null;
  standalone_canvas_deployments?: StandaloneCanvasDeployment[];
  inventory_decision?: InventoryDecision | null;
  decision_action?: InventoryDecision["action"] | null;
  decision_reason?: string | null;
  canvas_archive?: CanvasArchive | null;
};

type CanvasCourseOption = {
  course_id: string;
  name: string;
  course_code?: string | null;
  workflow_state?: string | null;
  term_name?: string | null;
  canvas_url: string;
};

type CanvasCredentialStatus = {
  has_credential: boolean;
  active: boolean;
  expires_at?: string | null;
  days_remaining?: number | null;
  expired?: boolean;
  warning?: boolean;
  validation_status?: string | null;
  validation_message?: string | null;
};

type AnalysisFactor = {
  key: string;
  label: string;
  score: number;
  detail: string;
};

type AnalysisFinding = {
  code: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  message: string;
  source: string;
};

type DocumentAnalysis = {
  status: string;
  analyzed_at: string;
  complexity: {
    score: number;
    label: string;
    factors: AnalysisFactor[];
  };
  findings: AnalysisFinding[];
  summary: {
    finding_count: number;
    blocking_count: number;
    linked_count: number;
    filename_link_count: number;
  };
};

type PdfProfile = {
  page_count?: number | null;
  image_count?: number | null;
  table_count?: number | null;
  font_count?: number | null;
  font_names?: string[];
  raw_font_count?: number | null;
  raw_font_names?: string[];
  normalized_font_count?: number | null;
  normalized_font_names?: string[];
  text_object_count?: number | null;
  column_signal?: string | null;
  scanned_page_count?: number | null;
  ocr_required?: boolean | null;
  confidence?: string | null;
  notes?: string[];
};

type PdfFigure = {
  id: string;
  page_number: number;
  source_page_number?: number;
  source_candidate_id?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  fragment_count?: number;
  area_ratio?: number;
  decorative_likely?: boolean;
  is_decorative?: boolean;
  needs_alt_text?: boolean;
  review_action?: "keep" | "ignore";
  alt_text?: string | null;
  long_description?: string | null;
  ai_alt_text?: string | null;
  ai_long_description?: string | null;
  figure_type?: "image" | "diagram" | "flowchart" | null;
  flowchart_guidance?: string | null;
  flowchart?: PdfFlowchartStructure | null;
  full_page_likely?: boolean | null;
  status?: string;
  confidence?: number;
  asset?: {
    status?: string | null;
    signed_url?: string | null;
    signed_url_expires_at?: string | null;
    r2_key?: string | null;
    content_type?: string | null;
    width?: number | null;
    height?: number | null;
  } | null;
};

type PdfFlowchartNode = FlowchartNode;
type PdfFlowchartConnection = FlowchartConnection;
type PdfFlowchartStructure = FlowchartStructure;

type PdfFigureInventory = {
  status: string;
  figure_count: number;
  active_figure_count?: number;
  ignored_count?: number;
  needs_alt_count: number;
  reviewed_count?: number;
  figures: PdfFigure[];
};

type TagFlowAsset = {
  status?: string | null;
  generation_status?: string | null;
  signed_url?: string | null;
  signed_url_expires_at?: string | null;
  width?: number | null;
  height?: number | null;
  stale?: boolean | null;
} | null;

type TagFlowZone = {
  id?: string | null;
  tag?: string | null;
  bounds?: {
    x?: number | null;
    y?: number | null;
    width?: number | null;
    height?: number | null;
  } | null;
};

type TagFlowPage = {
  page_number: number;
  label?: string | null;
  selection_reason?: string | null;
  is_representative?: boolean | null;
  review_status?: string | null;
  zone_count?: number | null;
  zones?: TagFlowZone[];
  preview_asset_status?: string | null;
  original_asset?: TagFlowAsset;
  tagged_asset?: TagFlowAsset;
  validation?: {
    status?: string | null;
    issue_count?: number | null;
  } | null;
  ai_suggestions?: {
    status?: string | null;
    zone_count?: number | null;
  } | null;
  ai_draft_applied?: {
    status?: string | null;
    zone_count?: number | null;
  } | null;
};

type TagFlowState = {
  status?: string | null;
  preview_generation?: {
    status?: string | null;
    job_id?: string | null;
    stale_page_numbers?: number[];
  } | null;
  summary?: {
    page_count?: number | null;
    reviewed_page_count?: number | null;
    edited_page_count?: number | null;
    remediated_page_count?: number | null;
    zone_count?: number | null;
    validation_issue_count?: number | null;
    needs_attention_page_count?: number | null;
  } | null;
  validation?: {
    status?: string | null;
    issue_count?: number | null;
  } | null;
  pages?: TagFlowPage[];
};

type DocumentRemediationPlan = {
  status: string;
  extracted_at: string;
  metadata?: {
    title?: string | null;
    language?: string | null;
    author?: string | null;
    keywords?: string | null;
    subject?: string | null;
    creator?: string | null;
    producer?: string | null;
  };
  metadata_review?: {
    title?: string | null;
    language?: string | null;
    title_set?: boolean | null;
    language_set?: boolean | null;
    language_valid?: boolean | null;
    status?: string | null;
    updated_at?: string | null;
    source?: string | null;
  };
  export_readiness?: {
    status?: string | null;
    error_count?: number | null;
    warning_count?: number | null;
    issue_count?: number | null;
    issues?: {
      code?: string | null;
      severity?: string | null;
      message?: string | null;
      page_number?: number | null;
      zone_id?: string | null;
      figure_id?: string | null;
    }[];
    checks?: Record<string, string | null>;
    metadata_status?: string | null;
    metadata_required?: string[];
    metadata_updated_at?: string | null;
  } | null;
  structural_tags?: {
    has_struct_tree?: boolean;
    has_mark_info?: boolean;
    structure_tag_count?: number;
    heading_tag_count?: number;
    heading_counts?: Record<string, number>;
    tag_names?: string[];
    tag_name_count?: number;
  };
  pdf_profile?: PdfProfile;
  figure_inventory?: PdfFigureInventory;
  tagflow_state?: TagFlowState;
  export_artifact?: PdfExportArtifact | null;
  export_artifacts?: PdfExportArtifact[];
  recommendations?: { code: string; message: string }[];
};

type PdfExportArtifact = {
  id?: string | null;
  status?: string | null;
  export_status?: string | null;
  filename?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  generated_at?: string | null;
  source?: string | null;
  generation_mode?: string | null;
  structure_tree_status?: string | null;
  tagged_pdf_status?: string | null;
  structure_plan?: {
    status?: string | null;
    page_count?: number | null;
    node_count?: number | null;
    figure_node_count?: number | null;
    artifact_count?: number | null;
    role_counts?: Record<string, number> | null;
  } | null;
  export_checks?: PdfExportChecks | null;
  export_note?: string | null;
};

type PdfExportChecks = {
  status?: string | null;
  checks?: Record<string, string | null>;
  language?: string | null;
  marked?: boolean | null;
  has_struct_tree?: boolean | null;
  role_counts?: Record<string, number> | null;
  expected_role_counts?: Record<string, number> | null;
  missing_expected_roles?: string[];
  alt_count?: number | null;
};

type PdfExportReadinessIssue = NonNullable<NonNullable<DocumentRemediationPlan["export_readiness"]>["issues"]>[number];

type PdfExportValidation = {
  status?: string | null;
  is_valid?: boolean | null;
  error_count?: number | null;
  warning_count?: number | null;
  issue_count?: number | null;
  issues?: PdfExportReadinessIssue[];
};

type PdfExportQueueResponse = {
  status?: "blocked" | "queued" | string;
  job_id?: string | null;
  queued_at?: string | null;
  document_id?: string | null;
  job_type?: string | null;
  job_payload?: Record<string, unknown> | null;
  validation?: PdfExportValidation | null;
  export_readiness?: DocumentRemediationPlan["export_readiness"];
  message?: string | null;
};

type PdfFigureDraft = {
  alt_text: string;
  long_description: string;
  is_decorative: boolean;
  review_action: "keep" | "ignore";
  figure_type: "image" | "diagram" | "flowchart";
  flowchart_guidance: string;
  flowchart: PdfFlowchartStructure;
};

type PdfMetadataDraft = {
  title: string;
  language: string;
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
  tagged_pdf_status?: string | null;
  structure_tree_status?: string | null;
  export_checks?: PdfExportChecks | null;
  initial_accessibility_review?: AccessibilityReview | null;
  reference_review?: {
    status: string;
    reviewed_at: string;
    reviewed_by: string;
    linked_count: number;
    filename_link_count: number;
    generic_link_count: number;
    content_item_ids: string[];
  } | null;
  canvas_deployment?: {
    status: string;
    canvas_file_id: string | null;
    canvas_url: string | null;
    job_id: string | null;
    queued_at?: string | null;
    deployed_at?: string | null;
    selected_reference_count?: number | null;
    revision_count?: number | null;
  };
};

type ReadinessAction = {
  key: string;
  title: string;
  detail: string;
  status: "ready" | "action";
};

type BackgroundJob = {
  id: string;
  job_type: string;
  status: "queued" | "running" | "retrying" | "succeeded" | "failed" | "cancelled" | string;
  error_message: string | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  result?: {
    analysis?: DocumentAnalysis;
    canvas_file_id?: string | null;
    canvas_url?: string | null;
    selected_reference_count?: number;
    archive_folder_id?: string | number | null;
    archive_folder_name?: string | null;
    archive_folder_path?: string | null;
    revisions?: { content_item_id: string; changed_count: number; saved: boolean; revision_number: number | null }[];
  };
  payload?: {
    replacement_id?: string | null;
    selected_references?: LinkedFrom[];
  };
};

type WorkHistoryEvent = {
  id: string;
  occurred_at: string | null;
  actor_user_id: string | null;
  session_id: string;
  document_id: string | null;
  canvas_file_id: string | null;
  type: string;
  status: string;
  label: string;
  summary: string;
  source_table: string;
  source_id: string | null;
  metadata?: Record<string, unknown>;
};

type DocumentDetailResponse = {
  document: DocumentRow;
  analysis: DocumentAnalysis;
  latest_job: BackgroundJob | null;
  jobs: BackgroundJob[];
  deployment_history: BackgroundJob[];
  archive_history: BackgroundJob[];
  work_history: WorkHistoryEvent[];
};

type DocumentStatusResponse = {
  document_id: string;
  latest_job: BackgroundJob | null;
  analysis: DocumentAnalysis | null;
};

type ReplacementUploadResponse = {
  document_id: string;
  replacement_candidate: ReplacementCandidate;
};

type ReplacementDeployResponse = ReplacementUploadResponse & {
  job_id: string;
  status: string;
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

function filenameFromContentDisposition(value: string | null, fallback: string) {
  if (!value) return fallback;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1] || fallback;
}

function pdfDownloadFilename(value: string | null | undefined, fallback: string) {
  const filename = (value || fallback).trim() || fallback;
  return filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
}

function parseCanvasCourseUrl(value: string) {
  try {
    const url = new URL(value.trim());
    const match = url.pathname.match(/\/courses\/(\d+)(?:\/|$)/);
    if (!match) return null;
    return {
      canvasBaseUrl: url.origin,
      canvasCourseId: match[1],
      canvasUrl: `${url.origin}/courses/${match[1]}`,
    };
  } catch {
    return null;
  }
}

function accessiblePdfDownloadFilename(value: string | null | undefined) {
  const filename = pdfDownloadFilename(value, "document.pdf");
  return filename.replace(/\.pdf$/i, " accessible.pdf");
}

function contentTypeLabel(contentType: string) {
  return contentType.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
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

function standaloneCanvasFilePageUrl(deployment: StandaloneCanvasDeployment | null | undefined) {
  if (!deployment) return null;
  const baseUrl = deployment.canvas_base_url || ASU_CANVAS_BASE_URL;
  try {
    const base = new URL(baseUrl);
    if (deployment.canvas_course_id && deployment.canvas_file_id) {
      return `${base.origin}/courses/${encodeURIComponent(deployment.canvas_course_id)}/files/${encodeURIComponent(deployment.canvas_file_id)}`;
    }
    const rawUrl = deployment.canvas_file_page_url || deployment.canvas_url || deployment.canvas_html_url;
    if (!rawUrl) return null;
    const parsed = new URL(rawUrl, base.origin);
    const match = parsed.pathname.match(/\/courses\/(\d+)\/files\/(\d+)/);
    if (!match) return parsed.toString();
    return `${base.origin}/courses/${match[1]}/files/${match[2]}`;
  } catch {
    return deployment.canvas_file_page_url || deployment.canvas_url || null;
  }
}

function issueLabel(issueCode: string | null) {
  if (!issueCode) return "Clear";
  return issueCode.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function complexityClass(label: string) {
  if (label === "Complex") return "bg-error-container text-error border-error/30";
  if (label === "Moderate") return "border-[#ff7f32]/45 bg-[#fff2e8] text-[#8a3b00]";
  return "border-[#2e7d32]/35 bg-[#e7f4ea] text-[#1f6b2a]";
}

function tagflowStatusLabel(status: string | null | undefined) {
  const value = String(status || "unreviewed").replace(/_/g, " ");
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function tagflowStatusClass(status: string | null | undefined) {
  const value = String(status || "").toLowerCase();
  if (value === "remediated" || value === "passed") return "bg-secondary-container text-on-secondary-container";
  if (value === "edited" || value === "needs_attention" || value === "stale") return "bg-error-container text-error";
  if (value === "generated" || value === "ai_draft") return "bg-primary/10 text-primary";
  return "bg-surface-container-high text-on-surface-variant";
}

function pdfReadinessActions(remediationPlan: DocumentRemediationPlan | null | undefined): ReadinessAction[] {
  if (!remediationPlan) {
    return [{
      key: "analyze_pdf",
      title: "Analyze PDF",
      detail: "Run analysis to extract metadata, structure, and profile signals before TagFlow.",
      status: "action",
    }];
  }

  const actions: ReadinessAction[] = [];
  if (!remediationPlan.metadata?.title) {
    actions.push({
      key: "set_title",
      title: "Set document title",
      detail: "Add a descriptive title before exporting an accessible replacement.",
      status: "action",
    });
  }
  if (!remediationPlan.metadata?.language) {
    actions.push({
      key: "set_language",
      title: "Set document language",
      detail: "Define the PDF language so assistive technologies announce content correctly.",
      status: "action",
    });
  }
  if (!remediationPlan.structural_tags?.has_struct_tree) {
    actions.push({
      key: "add_tags",
      title: "Add structure tags",
      detail: "No structure tree was detected; TagFlow should create or repair document tags.",
      status: "action",
    });
  }
  if (!remediationPlan.structural_tags?.has_mark_info) {
    actions.push({
      key: "mark_content",
      title: "Mark PDF content",
      detail: "Marked-content metadata was not detected and should be repaired during remediation.",
      status: "action",
    });
  }
  if (remediationPlan.pdf_profile?.ocr_required) {
    const scannedCount = remediationPlan.pdf_profile.scanned_page_count || 0;
    actions.push({
      key: "ocr",
      title: "Check OCR",
      detail: `${scannedCount || "Some"} scanned page${scannedCount === 1 ? "" : "s"} may need OCR before tagging.`,
      status: "action",
    });
  }
  if ((remediationPlan.pdf_profile?.table_count || 0) > 0) {
    const tableCount = remediationPlan.pdf_profile?.table_count || 0;
    actions.push({
      key: "tables",
      title: "Review tables",
      detail: `${tableCount} table signal${tableCount === 1 ? "" : "s"} detected for table-header and reading-order review.`,
      status: "action",
    });
  }
  if ((remediationPlan.pdf_profile?.image_count || 0) > 0) {
    const imageCount = remediationPlan.pdf_profile?.image_count || 0;
    const figureCount = remediationPlan.figure_inventory?.active_figure_count ?? remediationPlan.figure_inventory?.figure_count ?? 0;
    actions.push({
      key: "images",
      title: "Review images",
      detail: `${imageCount} raw PDF image object${imageCount === 1 ? "" : "s"} detected; ${figureCount} reviewable figure candidate${figureCount === 1 ? "" : "s"} grouped for alt text review.`,
      status: "action",
    });
  }

  if (actions.length === 0) {
    actions.push({
      key: "ready",
      title: "Ready for TagFlow planning",
      detail: "No blocking metadata or structure signals were detected by the current PDF review.",
      status: "ready",
    });
  }
  return actions;
}

function referenceKey(link: LinkedFrom) {
  return `${link.content_item_id}:${link.link_index}:${link.href}`;
}

function fileExtension(filename: string | null | undefined) {
  if (!filename) return "";
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return body.detail ?? fallback;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function figureDraftsFromInventory(
  figureInventory: PdfFigureInventory | null | undefined,
  existingDrafts?: Record<string, PdfFigureDraft>
): Record<string, PdfFigureDraft> {
  return Object.fromEntries((figureInventory?.figures ?? []).map((figure) => [
    figure.id,
    existingDrafts?.[figure.id] ?? {
      alt_text: figure.alt_text ?? "",
      long_description: figure.long_description ?? "",
      is_decorative: Boolean(figure.is_decorative),
      review_action: figure.review_action === "ignore" ? "ignore" : "keep",
      figure_type: figure.figure_type === "diagram" || figure.figure_type === "flowchart" ? figure.figure_type : "image",
      flowchart_guidance: figure.flowchart_guidance ?? "",
      flowchart: normalizeFlowchartStructure(figure.flowchart, figure.flowchart_guidance ?? ""),
    },
  ]));
}

function signedUrlIsFresh(signedUrl: string | null | undefined, expiresAt: string | null | undefined, freshnessTimeMs: number | null) {
  if (!signedUrl) return false;
  if (!expiresAt) return true;
  if (freshnessTimeMs === null) return false;
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > freshnessTimeMs + 30_000;
}

function tagflowPageAssetSrc(
  sessionId: string,
  documentId: string,
  pageNumber: number,
  asset: TagFlowAsset | undefined,
  freshnessTimeMs: number | null,
  variant: "original" | "tagged" = "original"
) {
  const signedUrl = asset?.signed_url;
  const expiresAt = asset?.signed_url_expires_at;
  if (signedUrl && signedUrlIsFresh(signedUrl, expiresAt, freshnessTimeMs)) {
    return signedUrl;
  }
  return `/api/session-documents/${sessionId}/${documentId}/tagflow/pages/${pageNumber}/asset?variant=${variant}`;
}

function activeDocumentWorkFromRemediation(remediationPlan: DocumentRemediationPlan | null | undefined) {
  const tagflowState = remediationPlan?.tagflow_state;
  const previewStatus = String(tagflowState?.preview_generation?.status || "").toLowerCase();
  if (ACTIVE_JOB_STATUSES.has(previewStatus)) return true;
  return (tagflowState?.pages ?? []).some((page) => {
    const originalStatus = String(page.original_asset?.generation_status || page.original_asset?.status || "").toLowerCase();
    const taggedStatus = String(page.tagged_asset?.generation_status || page.tagged_asset?.status || "").toLowerCase();
    const aiSuggestionStatus = String(page.ai_suggestions?.status || "").toLowerCase();
    const aiDraftStatus = String(page.ai_draft_applied?.status || "").toLowerCase();
    return ACTIVE_JOB_STATUSES.has(originalStatus)
      || ACTIVE_JOB_STATUSES.has(taggedStatus)
      || ACTIVE_JOB_STATUSES.has(aiSuggestionStatus)
      || ACTIVE_JOB_STATUSES.has(aiDraftStatus);
  });
}

export default function DocumentDetailManager({ sessionId, documentId }: { sessionId: string; documentId: string }) {
  const [document, setDocument] = useState<DocumentRow | null>(null);
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [latestJob, setLatestJob] = useState<BackgroundJob | null>(null);
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [deploymentHistory, setDeploymentHistory] = useState<BackgroundJob[]>([]);
  const [archiveHistory, setArchiveHistory] = useState<BackgroundJob[]>([]);
  const [workHistory, setWorkHistory] = useState<WorkHistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [uploadingReplacement, setUploadingReplacement] = useState(false);
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [selectedReferenceKeys, setSelectedReferenceKeys] = useState<string[]>([]);
  const [deployingReplacement, setDeployingReplacement] = useState(false);
  const [savingCleanupDecision, setSavingCleanupDecision] = useState<InventoryDecision["action"] | null>(null);
  const [archivingOriginal, setArchivingOriginal] = useState(false);
  const [complexityBreakdownOpen, setComplexityBreakdownOpen] = useState(false);
  const [tagflowPagesOpen, setTagflowPagesOpen] = useState(true);
  const [tagflowWorkspaceOpen, setTagflowWorkspaceOpen] = useState(false);
  const [tagflowEditorPageNumber, setTagflowEditorPageNumber] = useState<number | null>(null);
  const [tagflowEditorOpenRequestKey, setTagflowEditorOpenRequestKey] = useState(0);
  const [pdfExtractionOpen, setPdfExtractionOpen] = useState(false);
  const [pdfFiguresOpen, setPdfFiguresOpen] = useState(true);
  const [expandedTagflowPage, setExpandedTagflowPage] = useState<TagFlowPage | null>(null);
  const [figureDrafts, setFigureDrafts] = useState<Record<string, PdfFigureDraft>>({});
  const [savingFigureId, setSavingFigureId] = useState<string | null>(null);
  const [savingFlowchartFigureId, setSavingFlowchartFigureId] = useState<string | null>(null);
  const [generatingFigureId, setGeneratingFigureId] = useState<string | null>(null);
  const [showAllFigures, setShowAllFigures] = useState(false);
  const [expandedFigure, setExpandedFigure] = useState<PdfFigure | null>(null);
  const [flowchartModalFigure, setFlowchartModalFigure] = useState<PdfFigure | null>(null);
  const [signedUrlFreshnessTimeMs, setSignedUrlFreshnessTimeMs] = useState<number | null>(null);
  const [pdfMetadataDraft, setPdfMetadataDraft] = useState<PdfMetadataDraft>({ title: "", language: "" });
  const [pdfLanguageCustomMode, setPdfLanguageCustomMode] = useState(false);
  const [savingPdfMetadata, setSavingPdfMetadata] = useState(false);
  const [preparingPdfExport, setPreparingPdfExport] = useState(false);
  const [pdfExportQueueResult, setPdfExportQueueResult] = useState<PdfExportQueueResponse | null>(null);
  const [downloadingPdfExport, setDownloadingPdfExport] = useState<"original" | "artifact" | null>(null);
  const [canvasDeployModalOpen, setCanvasDeployModalOpen] = useState(false);
  const [canvasDeploying, setCanvasDeploying] = useState(false);
  const [canvasCourseUrl, setCanvasCourseUrl] = useState("");
  const [canvasCourseSearch, setCanvasCourseSearch] = useState("");
  const [canvasCourseOptions, setCanvasCourseOptions] = useState<CanvasCourseOption[]>([]);
  const [loadingCanvasCourses, setLoadingCanvasCourses] = useState(false);
  const [canvasCredentialStatus, setCanvasCredentialStatus] = useState<CanvasCredentialStatus | null>(null);
  const [loadingCanvasCredentialStatus, setLoadingCanvasCredentialStatus] = useState(false);
  const [savingCanvasPat, setSavingCanvasPat] = useState(false);
  const [canvasPat, setCanvasPat] = useState("");
  const [canvasDeploySuccess, setCanvasDeploySuccess] = useState<StandaloneCanvasDeployment | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const pendingStandaloneCanvasDeployJobIdRef = useRef<string | null>(null);
  const pendingReviewNotifiedDeploymentJobIdsRef = useRef<Set<string>>(new Set());

  const getAccessToken = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return session.access_token;
  }, []);

  const loadDocument = useCallback(async (options?: { preserveFigureDrafts?: boolean; silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    const preserveFigureDrafts = silent && options?.preserveFigureDrafts !== false;
    if (!silent) {
      setLoading(true);
      setMessage(null);
    }
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to load document"));
      const data = await res.json() as DocumentDetailResponse;
      const language = data.document.document_remediation?.metadata?.language ?? "";
      const deployment = data.document.standalone_canvas_deployment;
      if (
        deployment?.status === "succeeded"
        && pendingStandaloneCanvasDeployJobIdRef.current
        && (!deployment.job_id || deployment.job_id === pendingStandaloneCanvasDeployJobIdRef.current)
      ) {
        pendingStandaloneCanvasDeployJobIdRef.current = null;
        setCanvasDeploySuccess(deployment);
        setMessage(null);
      }
      const nextDeploymentHistory = Array.isArray(data.deployment_history) ? data.deployment_history : [];
      const completedReplacementJob = nextDeploymentHistory.find((job) => (
        job.job_type === "document_replacement_deploy"
        && job.status === "succeeded"
        && Array.isArray(job.result?.revisions)
        && job.result.revisions.some((revision) => revision.saved !== false)
        && !pendingReviewNotifiedDeploymentJobIdsRef.current.has(job.id)
      ));
      if (completedReplacementJob) {
        pendingReviewNotifiedDeploymentJobIdsRef.current.add(completedReplacementJob.id);
        window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated", {
          detail: {
            source: "document-replacement-deploy",
            jobId: completedReplacementJob.id,
          },
        }));
      }
      setDocument(data.document);
      setPdfMetadataDraft({
        title: data.document.document_remediation?.metadata?.title ?? "",
        language,
      });
      setPdfLanguageCustomMode(pdfLanguageUsesCustomMode(language));
      setFigureDrafts((current) => figureDraftsFromInventory(
        data.document.document_remediation?.figure_inventory,
        preserveFigureDrafts ? current : undefined
      ));
      setAnalysis(data.analysis);
      setLatestJob(data.latest_job ?? null);
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
      setDeploymentHistory(nextDeploymentHistory);
      setArchiveHistory(Array.isArray(data.archive_history) ? data.archive_history : []);
      setWorkHistory(Array.isArray(data.work_history) ? data.work_history : []);
    } catch (error) {
      if (!silent) {
        setDocument(null);
        setAnalysis(null);
        setLatestJob(null);
        setJobs([]);
        setDeploymentHistory([]);
        setArchiveHistory([]);
        setWorkHistory([]);
        setFigureDrafts({});
      }
      setMessage(error instanceof Error ? error.message : "Failed to load document");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [documentId, getAccessToken, sessionId]);

  const pollStatus = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/analysis/status`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to load analysis status"));
      const data = await res.json() as DocumentStatusResponse;
      setLatestJob(data.latest_job);
      if (data.analysis) setAnalysis(data.analysis);
      if (data.latest_job?.status === "succeeded" || data.latest_job?.status === "failed" || data.latest_job?.status === "cancelled") {
        void loadDocument({ silent: true });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load analysis status");
    }
  }, [documentId, getAccessToken, loadDocument, sessionId]);

  const waitForBackgroundJob = useCallback(async (jobId: string, token: string, options?: { attempts?: number; intervalMs?: number }) => {
    const attempts = options?.attempts ?? 30;
    const intervalMs = options?.intervalMs ?? 2000;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const res = await fetch(`${API_URL}/canvas/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to refresh background job"));
      const job = await res.json() as BackgroundJob;
      const status = String(job.status || "").toLowerCase();
      if (status === "succeeded") return job;
      if (TERMINAL_JOB_STATUSES.has(status)) {
        throw new Error(job.error_message || "Background job failed");
      }
      await wait(intervalMs);
    }
    return null;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDocument();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadDocument]);

  useEffect(() => {
    const updateFreshnessTime = () => setSignedUrlFreshnessTimeMs(Date.now());
    updateFreshnessTime();
    const timer = window.setInterval(updateFreshnessTime, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (latestJob?.status !== "queued" && latestJob?.status !== "running" && latestJob?.status !== "retrying") return;
    const timer = window.setInterval(() => void pollStatus(), 1500);
    return () => window.clearInterval(timer);
  }, [latestJob?.status, pollStatus]);

  useEffect(() => {
    if (!jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status))) return;
    const timer = window.setInterval(() => void loadDocument({ silent: true }), 2000);
    return () => window.clearInterval(timer);
  }, [jobs, loadDocument]);

  useEffect(() => {
    const replacementStatus = document?.replacement_candidate?.canvas_deployment?.status ?? "";
    const replacementDeploymentActive = ACTIVE_JOB_STATUSES.has(replacementStatus)
      || deploymentHistory.some((job) => job.job_type === "document_replacement_deploy" && ACTIVE_JOB_STATUSES.has(job.status));
    const archiveActive = archiveHistory.some((job) => job.job_type === "document_file_archive" && ACTIVE_JOB_STATUSES.has(job.status));
    if (!replacementDeploymentActive && !archiveActive) return;
    const timer = window.setInterval(() => void loadDocument({ silent: true }), 2000);
    return () => window.clearInterval(timer);
  }, [archiveHistory, deploymentHistory, document?.replacement_candidate?.canvas_deployment?.status, loadDocument]);

  useEffect(() => {
    if (!activeDocumentWorkFromRemediation(document?.document_remediation)) return;
    const timer = window.setInterval(() => void loadDocument({ silent: true }), 2000);
    return () => window.clearInterval(timer);
  }, [document?.document_remediation, loadDocument]);

  useEffect(() => {
    if (!document) return;
    const hash = window.location.hash;
    if (!["#pdf-extraction", "#pdf-figures", "#tagflow-pages"].includes(hash)) return;
    window.setTimeout(() => {
      if (hash === "#pdf-extraction") {
        setPdfExtractionOpen(true);
      } else if (hash === "#pdf-figures") {
        setPdfFiguresOpen(true);
      } else if (hash === "#tagflow-pages") {
        setTagflowPagesOpen(true);
      }
      globalThis.document.querySelector(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }, [document]);

  useEffect(() => {
    if (!canvasDeployModalOpen) return;
    const timer = window.setTimeout(async () => {
      const status = await loadCanvasCredentialStatus();
      if (status?.active) {
        void loadCanvasCourseOptions(canvasCourseSearch);
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- modal open intentionally kicks off a fresh credential check.
  }, [canvasDeployModalOpen]);

  useEffect(() => {
    if (!canvasDeployModalOpen || !canvasCredentialStatus?.active) return;
    const timer = window.setTimeout(() => {
      void loadCanvasCourseOptions(canvasCourseSearch);
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- search changes should reload courses with the current token.
  }, [canvasCourseSearch, canvasCredentialStatus?.active, canvasDeployModalOpen]);

  async function startAnalysis() {
    if (starting) return;
    setStarting(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const analysisRes = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/analysis`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!analysisRes.ok) throw new Error(await parseApiError(analysisRes, "Failed to start document analysis"));

      const shouldExtractPdf = Boolean(
        document
        && ((document.extension || "").toLowerCase() === "pdf" || document.mime_type === "application/pdf")
        && !jobs.some((job) => job.job_type === "document_remediation" && ACTIVE_JOB_STATUSES.has(job.status))
      );
      if (shouldExtractPdf) {
        const remediationRes = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/remediation`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!remediationRes.ok) throw new Error(await parseApiError(remediationRes, "Failed to start PDF extraction"));
      }

      setMessage(shouldExtractPdf
        ? "PDF analysis and extraction queued. Results will update automatically."
        : "Document analysis queued. Results will update automatically.");
      window.setTimeout(() => void loadDocument({ silent: true }), 750);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to start document analysis");
    } finally {
      setStarting(false);
    }
  }

  async function handleReplacementUpload(file: File | null) {
    if (!file || uploadingReplacement) return;
    if (!REPLACEMENT_EXTENSIONS.has(fileExtension(file.name))) {
      setMessage("Choose a PDF, Word, PowerPoint, CSV, or Excel replacement file.");
      return;
    }

    setUploadingReplacement(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/replacement`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to upload replacement file"));
      const data = await res.json() as ReplacementUploadResponse;
      setDocument((current) => current ? { ...current, replacement_candidate: data.replacement_candidate } : current);
      setMessage("Replacement file uploaded. Review references before deploying it to Canvas.");
      void loadDocument({ silent: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload replacement file");
    } finally {
      setUploadingReplacement(false);
      if (replacementInputRef.current) replacementInputRef.current.value = "";
    }
  }

  function openDeployModal() {
    setSelectedReferenceKeys(document?.linked_from.map(referenceKey) ?? []);
    setDeployModalOpen(true);
  }

  function openCanvasDeployModal() {
    setCanvasCourseOptions([]);
    setCanvasDeployModalOpen(true);
  }

  async function deployReplacement() {
    if (deployingReplacement || !replacement || !document) return;
    setDeployingReplacement(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const selectedReferences = document.linked_from.filter((link) => selectedReferenceKeys.includes(referenceKey(link)));
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/replacement/deploy`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          references: selectedReferences.map((link) => ({
            content_item_id: link.content_item_id,
            link_index: link.link_index,
            href: link.href,
          })),
        }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to queue replacement deployment"));
      const data = await res.json() as ReplacementDeployResponse;
      setDocument((current) => current ? { ...current, replacement_candidate: data.replacement_candidate } : current);
      setDeployModalOpen(false);
      setMessage("Replacement deployment queued. The file will upload to Canvas and selected references will become pending content revisions.");
      window.setTimeout(() => void loadDocument({ silent: true }), 1500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to queue replacement deployment");
    } finally {
      setDeployingReplacement(false);
    }
  }

  function updateFigureDraft(figureId: string, patch: Partial<PdfFigureDraft>) {
    setFigureDrafts((current) => ({
      ...current,
      [figureId]: {
        alt_text: current[figureId]?.alt_text ?? "",
        long_description: current[figureId]?.long_description ?? "",
        is_decorative: current[figureId]?.is_decorative ?? false,
        review_action: current[figureId]?.review_action ?? "keep",
        figure_type: current[figureId]?.figure_type ?? "image",
        flowchart_guidance: current[figureId]?.flowchart_guidance ?? "",
        flowchart: current[figureId]?.flowchart ?? emptyFlowchartStructure(current[figureId]?.flowchart_guidance ?? ""),
        ...patch,
      },
    }));
  }

  function figureAssetSrc(figure: PdfFigure) {
    const signedUrl = figure.asset?.signed_url;
    const expiresAt = figure.asset?.signed_url_expires_at;
    if (signedUrl && signedUrlIsFresh(signedUrl, expiresAt, signedUrlFreshnessTimeMs)) {
      return signedUrl;
    }
    return `/api/session-documents/${sessionId}/${documentId}/figures/${encodeURIComponent(figure.id)}/asset`;
  }

  async function savePdfMetadata() {
    if (savingPdfMetadata) return;
    setSavingPdfMetadata(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/metadata`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: pdfMetadataDraft.title,
          language: pdfMetadataDraft.language,
        }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to save PDF metadata"));
      const data = await res.json() as {
        document_remediation?: DocumentRemediationPlan;
        metadata?: DocumentRemediationPlan["metadata"];
      };
      setDocument((current) => current ? {
        ...current,
        document_remediation: data.document_remediation ?? current.document_remediation,
      } : current);
      const savedLanguage = data.metadata?.language ?? pdfMetadataDraft.language.trim();
      setPdfMetadataDraft({
        title: data.metadata?.title ?? pdfMetadataDraft.title.trim(),
        language: savedLanguage,
      });
      setPdfLanguageCustomMode(pdfLanguageUsesCustomMode(savedLanguage));
      setMessage("PDF title and language saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save PDF metadata");
    } finally {
      setSavingPdfMetadata(false);
    }
  }

  function applyFigureInventory(figureInventory: PdfFigureInventory | undefined) {
    if (!figureInventory) return;
    setFigureDrafts(figureDraftsFromInventory(figureInventory));
    setDocument((current) => {
      if (!current?.document_remediation) return current;
      return {
        ...current,
        document_remediation: {
          ...current.document_remediation,
          figure_inventory: figureInventory,
        },
      };
    });
  }

  async function saveFigureReview(figure: PdfFigure, overrides?: Partial<PdfFigureDraft>) {
    const draft = figureDrafts[figure.id] ? { ...figureDrafts[figure.id], ...overrides } : null;
    if (!draft || savingFigureId || generatingFigureId) return;
    setSavingFigureId(figure.id);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/figures/${figure.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(draft),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to save figure review"));
      const data = await res.json() as { figure_inventory?: PdfFigureInventory };
      applyFigureInventory(data.figure_inventory);
      setMessage(draft.review_action === "ignore" ? "Figure ignored." : "Figure review saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save figure review");
    } finally {
      setSavingFigureId(null);
    }
  }

  function addFlowchartNode(figureId: string) {
    setFigureDrafts((current) => {
      const draft = current[figureId];
      if (!draft) return current;
      const nodes = draft.flowchart.nodes;
      const nextNode: PdfFlowchartNode = {
        id: `node-${Date.now()}`,
        label: `Step ${nodes.length + 1}`,
        description: "",
        reading_order: nodes.length + 1,
      };
      return {
        ...current,
        [figureId]: {
          ...draft,
          figure_type: "flowchart",
          flowchart: {
            ...draft.flowchart,
            nodes: [...nodes, nextNode],
            reading_order: [...(draft.flowchart.reading_order ?? []), nextNode.id],
          },
        },
      };
    });
  }

  function updateFlowchartNode(figureId: string, nodeId: string, patch: Partial<PdfFlowchartNode>) {
    setFigureDrafts((current) => {
      const draft = current[figureId];
      if (!draft) return current;
      return {
        ...current,
        [figureId]: {
          ...draft,
          flowchart: {
            ...draft.flowchart,
            nodes: draft.flowchart.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node),
          },
        },
      };
    });
  }

  function removeFlowchartNode(figureId: string, nodeId: string) {
    setFigureDrafts((current) => {
      const draft = current[figureId];
      if (!draft) return current;
      const nextNodes = draft.flowchart.nodes.filter((node) => node.id !== nodeId).map((node, index) => ({ ...node, reading_order: index + 1 }));
      return {
        ...current,
        [figureId]: {
          ...draft,
          flowchart: {
            ...draft.flowchart,
            nodes: nextNodes,
            connections: draft.flowchart.connections.filter((connection) => connection.from_node_id !== nodeId && connection.to_node_id !== nodeId),
            reading_order: nextNodes.map((node) => node.id),
          },
        },
      };
    });
  }

  function addFlowchartConnection(figureId: string) {
    setFigureDrafts((current) => {
      const draft = current[figureId];
      if (!draft || draft.flowchart.nodes.length < 2) return current;
      const connections = draft.flowchart.connections;
      return {
        ...current,
        [figureId]: {
          ...draft,
          figure_type: "flowchart",
          flowchart: {
            ...draft.flowchart,
            connections: [
              ...connections,
              {
                id: `connection-${Date.now()}`,
                from_node_id: draft.flowchart.nodes[0].id,
                to_node_id: draft.flowchart.nodes[1].id,
                label: "",
                description: "",
                order: connections.length + 1,
              },
            ],
          },
        },
      };
    });
  }

  function updateFlowchartConnection(figureId: string, connectionId: string, patch: Partial<PdfFlowchartConnection>) {
    setFigureDrafts((current) => {
      const draft = current[figureId];
      if (!draft) return current;
      return {
        ...current,
        [figureId]: {
          ...draft,
          flowchart: {
            ...draft.flowchart,
            connections: draft.flowchart.connections.map((connection) => connection.id === connectionId ? { ...connection, ...patch } : connection),
          },
        },
      };
    });
  }

  function removeFlowchartConnection(figureId: string, connectionId: string) {
    setFigureDrafts((current) => {
      const draft = current[figureId];
      if (!draft) return current;
      return {
        ...current,
        [figureId]: {
          ...draft,
          flowchart: {
            ...draft.flowchart,
            connections: draft.flowchart.connections.filter((connection) => connection.id !== connectionId).map((connection, index) => ({ ...connection, order: index + 1 })),
          },
        },
      };
    });
  }

  async function saveFigureFlowchart(figure: PdfFigure) {
    const draft = figureDrafts[figure.id];
    if (!draft || savingFlowchartFigureId || savingFigureId || generatingFigureId) return;
    setSavingFlowchartFigureId(figure.id);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const flowchart = normalizeFlowchartStructure({
        ...draft.flowchart,
        guidance: draft.flowchart_guidance,
      }, draft.flowchart_guidance);
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/figures/${figure.id}/flowchart`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(flowchart),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to save flowchart structure"));
      const data = await res.json() as { figure?: PdfFigure; figure_inventory?: PdfFigureInventory };
      applyFigureInventory(data.figure_inventory);
      if (data.figure) {
        setFigureDrafts((current) => ({
          ...current,
          [data.figure!.id]: {
            ...(current[data.figure!.id] ?? draft),
            figure_type: "flowchart",
            flowchart_guidance: data.figure!.flowchart_guidance ?? draft.flowchart_guidance,
            flowchart: normalizeFlowchartStructure(data.figure!.flowchart, data.figure!.flowchart_guidance ?? draft.flowchart_guidance),
          },
        }));
      }
      setMessage("Flowchart structure saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save flowchart structure");
    } finally {
      setSavingFlowchartFigureId(null);
    }
  }

  async function preparePdfExport() {
    if (preparingPdfExport) return;
    setPreparingPdfExport(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/pdf-export/queue`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ force: false }),
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({})) as PdfExportQueueResponse;
      if (!res.ok && res.status !== 409) {
        throw new Error(data.message || "Failed to validate export readiness");
      }
      setPdfExportQueueResult(data);
      if (data.export_readiness && document?.document_remediation) {
        setDocument({
          ...document,
          document_remediation: {
            ...document.document_remediation,
            export_readiness: data.export_readiness,
          },
        });
      }
      if (data.status === "queued") {
        window.setTimeout(() => void loadDocument({ silent: true }), 2000);
      }
    } catch (error) {
      setPdfExportQueueResult(null);
      setMessage(error instanceof Error ? error.message : "Failed to validate export readiness");
    } finally {
      setPreparingPdfExport(false);
    }
  }

  async function downloadPdfExport(kind: "original" | "artifact") {
    if (downloadingPdfExport) return;
    setDownloadingPdfExport(kind);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/pdf-export/${kind}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to download PDF"));
      const blob = await res.blob();
      const sourceFilename = document?.filename || document?.title;
      const fallback = kind === "artifact"
        ? accessiblePdfDownloadFilename(sourceFilename)
        : pdfDownloadFilename(sourceFilename, "document.pdf");
      const filename = filenameFromContentDisposition(res.headers.get("content-disposition"), fallback);
      const url = URL.createObjectURL(blob);
      const anchor = globalThis.document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      globalThis.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to download PDF");
    } finally {
      setDownloadingPdfExport(null);
    }
  }

  async function loadCanvasCredentialStatus() {
    setLoadingCanvasCredentialStatus(true);
    try {
      const token = await getAccessToken();
      const params = new URLSearchParams({ canvas_base_url: ASU_CANVAS_BASE_URL });
      const res = await fetch(`${API_URL}/canvas/credentials/status?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to check Canvas token status"));
      const status = await res.json() as CanvasCredentialStatus;
      setCanvasCredentialStatus(status);
      return status;
    } catch (error) {
      setCanvasCredentialStatus({
        has_credential: false,
        active: false,
        validation_status: "unverified",
        validation_message: error instanceof Error ? error.message : "Failed to check Canvas token status",
      });
      return null;
    } finally {
      setLoadingCanvasCredentialStatus(false);
    }
  }

  async function saveCanvasPat() {
    if (savingCanvasPat || !canvasPat.trim()) return;
    setSavingCanvasPat(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/credentials`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Canvas-Pat": canvasPat.trim(),
        },
        body: JSON.stringify({ canvas_base_url: ASU_CANVAS_BASE_URL }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Canvas rejected the token"));
      setCanvasPat("");
      const status = await loadCanvasCredentialStatus();
      if (status?.active) {
        await loadCanvasCourseOptions();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save Canvas token");
    } finally {
      setSavingCanvasPat(false);
    }
  }

  async function loadCanvasCourseOptions(searchOverride?: string) {
    const search = searchOverride ?? canvasCourseSearch;
    setLoadingCanvasCourses(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/canvas-courses?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to load Canvas courses"));
      const data = await res.json() as { items?: CanvasCourseOption[] };
      setCanvasCourseOptions(data.items ?? []);
    } catch (error) {
      setCanvasCourseOptions([]);
      setMessage(error instanceof Error ? error.message : "Failed to load Canvas courses");
    } finally {
      setLoadingCanvasCourses(false);
    }
  }

  async function deployStandaloneToCanvas() {
    if (canvasDeploying) return;
    const parsed = parseCanvasCourseUrl(canvasCourseUrl);
    if (!parsed) {
      setMessage("Enter or select a valid Canvas course URL before deploying.");
      return;
    }
    setCanvasDeploying(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      if (canvasPat.trim()) headers["X-Canvas-Pat"] = canvasPat.trim();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/canvas-deploy`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          canvas_url: parsed.canvasUrl,
          filename: accessiblePdfDownloadFilename(document?.filename || document?.title),
        }),
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({})) as { job_id?: string; status?: string; detail?: string };
      if (!res.ok) throw new Error(data.detail || "Failed to queue Canvas deployment");
      pendingStandaloneCanvasDeployJobIdRef.current = data.job_id ?? null;
      setCanvasDeployModalOpen(false);
      setCanvasPat("");
      setCanvasDeploySuccess(null);
      setMessage("Canvas deployment queued. The uploaded file link will appear here when the job completes.");
      window.setTimeout(() => void loadDocument({ silent: true }), 1500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to queue Canvas deployment");
    } finally {
      setCanvasDeploying(false);
    }
  }

  function scrollToDocumentSection(selector: string) {
    window.setTimeout(() => {
      globalThis.document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function openTagFlow(pageNumber?: number | null) {
    const pages = document?.document_remediation?.tagflow_state?.pages ?? [];
    if (!pages.length) {
      setTagflowPagesOpen(true);
      scrollToDocumentSection("#tagflow-pages");
      return;
    }
    const targetPage = pageNumber
      ? pages.find((page) => page.page_number === pageNumber) ?? pages[0]
      : pages.find((page) => page.original_asset?.status === "generated") ?? pages[0];
    setTagflowPagesOpen(true);
    setExpandedTagflowPage(null);
    setTagflowWorkspaceOpen(true);
    setTagflowEditorPageNumber(targetPage?.page_number ?? null);
    setTagflowEditorOpenRequestKey((current) => current + 1);
  }

  function handleExportReadinessIssue(issue: PdfExportReadinessIssue) {
    const code = issue.code || "";
    if (code.includes("title") || code.includes("language")) {
      setPdfExtractionOpen(true);
      scrollToDocumentSection("#pdf-extraction");
      return;
    }
    if (issue.figure_id || code.includes("pdf_figure") || code.includes("pdf_flowchart")) {
      setPdfFiguresOpen(true);
      setShowAllFigures(true);
      const figure = (document?.document_remediation?.figure_inventory?.figures ?? []).find((candidate) => candidate.id === issue.figure_id);
      if (figure && code.includes("flowchart")) {
        updateFigureDraft(figure.id, {
          figure_type: "flowchart",
          flowchart: normalizeFlowchartStructure(figure.flowchart, figure.flowchart_guidance ?? ""),
        });
        setFlowchartModalFigure(figure);
      }
      scrollToDocumentSection(issue.figure_id ? `#pdf-figure-${CSS.escape(issue.figure_id)}` : "#pdf-figures");
      return;
    }
    if (issue.page_number) {
      openTagFlow(issue.page_number);
      return;
    }
    setTagflowPagesOpen(true);
    scrollToDocumentSection("#tagflow-pages");
  }

  async function generateFigureText(figure: PdfFigure, mode: "alt" | "long_desc" | "both") {
    if (savingFigureId || generatingFigureId) return;
    setGeneratingFigureId(figure.id);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/figures/${figure.id}/generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode,
          figure_type: figureDrafts[figure.id]?.figure_type ?? figure.figure_type ?? "image",
          guidance: figureDrafts[figure.id]?.flowchart_guidance ?? figure.flowchart_guidance ?? "",
        }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to generate figure text"));
      const data = await res.json() as { figure?: PdfFigure; figure_inventory?: PdfFigureInventory; job_id?: string; created?: boolean };
      if (data.job_id) {
        setMessage(data.created === false
          ? "Figure text generation is already queued. Waiting for the worker to finish."
          : "Figure text generation queued. Waiting for the worker to finish.");
        const completedJob = await waitForBackgroundJob(data.job_id, token);
        await loadDocument({ preserveFigureDrafts: false, silent: true });
        if (!completedJob) {
          setMessage("Figure text generation is still running. This panel will update after refresh.");
          return;
        }
        setMessage(mode === "long_desc" ? "Figure long description generated." : mode === "both" ? "Figure text generated." : "Figure alt text generated.");
        return;
      }
      applyFigureInventory(data.figure_inventory);
      if (data.figure) {
        setFigureDrafts((current) => ({
          ...current,
          [data.figure!.id]: {
            alt_text: data.figure!.alt_text ?? "",
            long_description: data.figure!.long_description ?? "",
            is_decorative: Boolean(data.figure!.is_decorative),
            review_action: data.figure!.review_action === "ignore" ? "ignore" : "keep",
            figure_type: data.figure!.figure_type === "diagram" || data.figure!.figure_type === "flowchart" ? data.figure!.figure_type : "image",
            flowchart_guidance: data.figure!.flowchart_guidance ?? "",
            flowchart: normalizeFlowchartStructure(data.figure!.flowchart, data.figure!.flowchart_guidance ?? ""),
          },
        }));
      }
      setMessage(mode === "long_desc" ? "Figure long description generated." : mode === "both" ? "Figure text generated." : "Figure alt text generated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to generate figure text");
    } finally {
      setGeneratingFigureId(null);
    }
  }

  async function saveCleanupDecision(action: InventoryDecision["action"]) {
    if (!document || savingCleanupDecision) return;
    setSavingCleanupDecision(action);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const reason = action === "delete"
        ? "Replacement deployed; original file is ready for cleanup review"
        : action === "defer"
          ? "Deferred original file cleanup after replacement"
          : "Keep original file after replacement";
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/inventory-decisions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content_item_id: document.id,
          action,
          reason,
        }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to save cleanup decision"));
      const decision = await res.json() as InventoryDecision;
      setDocument((current) => current ? {
        ...current,
        inventory_decision: decision,
        decision_action: decision.action,
        decision_reason: decision.reason,
      } : current);
      setMessage(action === "delete" ? "Original marked for cleanup review." : "Cleanup decision saved.");
      void loadDocument({ silent: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save cleanup decision");
    } finally {
      setSavingCleanupDecision(null);
    }
  }

  async function archiveOriginalFile() {
    if (!document || archivingOriginal) return;
    setArchivingOriginal(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/archive`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to queue archive job"));
      setMessage("Archive job queued. The original file will move to CanvasCurate Archive.");
      window.setTimeout(() => void loadDocument({ silent: true }), 1500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to queue archive job");
    } finally {
      setArchivingOriginal(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl rounded-3xl bg-surface-container-lowest px-6 py-12 text-center text-sm text-on-surface-variant shadow-sm">
        Loading document...
      </div>
    );
  }

  if (!document || !analysis) {
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <Link href={`/sessions/${sessionId}/documents`} className="text-sm font-semibold text-primary hover:underline">
          Back to documents
        </Link>
        <div className="rounded-3xl bg-surface-container-lowest px-6 py-12 text-center text-sm text-on-surface-variant shadow-sm">
          {message || "Document not found."}
        </div>
      </div>
    );
  }

  const fileUrl = canvasFilePageUrl(document.canvas_url);
  const jobActive = latestJob?.status === "queued" || latestJob?.status === "running" || latestJob?.status === "retrying";
  const remediationJobActive = jobs.some((job) => job.job_type === "document_remediation" && ["queued", "running", "retrying"].includes(job.status));
  const documentReviewActive = jobActive || remediationJobActive;
  const isPdfDocument = (document.extension || "").toLowerCase() === "pdf" || document.mime_type === "application/pdf";
  const remediationPlan = document.document_remediation;
  const analysisActionActive = starting || documentReviewActive;
  const analysisButtonLabel = analysisActionActive
    ? "Analyzing"
    : isPdfDocument
      ? remediationPlan || analysis.analyzed_at
        ? "Re-analyze PDF"
        : "Analyze PDF"
      : "Re-analyze";
  const tagflowState = remediationPlan?.tagflow_state;
  const tagflowPages = tagflowState?.pages ?? [];
  const visibleTagflowPages = tagflowPages.slice(0, 6);
  const tagflowValidationIssueCount = tagflowState?.validation?.issue_count
    ?? tagflowState?.summary?.validation_issue_count
    ?? tagflowPages.reduce((sum, page) => sum + (page.validation?.issue_count ?? 0), 0);
  const pdfMetadataTitle = remediationPlan?.metadata?.title ?? "";
  const pdfMetadataLanguage = remediationPlan?.metadata?.language ?? "";
  const pdfMetadataReady = Boolean(
    remediationPlan?.metadata_review?.status === "ready"
    || (pdfMetadataTitle && pdfMetadataLanguage)
  );
  const exportReadiness = remediationPlan?.export_readiness;
  const exportReadinessStatus = exportReadiness?.status ?? (pdfMetadataReady && tagflowValidationIssueCount === 0 ? "ready" : "needs_attention");
  const exportReadinessIssueCount = exportReadiness?.issue_count ?? exportReadiness?.issues?.length ?? 0;
  const complexityFactors = analysis.complexity.factors.filter((factor) => factor.key !== "pdf_tags" && factor.label !== "PDF Tags");
  const pdfMetadataDirty = pdfMetadataDraft.title.trim() !== pdfMetadataTitle || pdfMetadataDraft.language.trim() !== pdfMetadataLanguage;
  const pdfLanguageSelectValue = pdfLanguageCustomMode ? CUSTOM_PDF_LANGUAGE_VALUE : pdfMetadataDraft.language;
  const figureInventory = remediationPlan?.figure_inventory;
  const pdfFigures = figureInventory?.figures ?? [];
  const visiblePdfFigures = showAllFigures ? pdfFigures : pdfFigures.slice(0, 8);
  const flowchartModalDraft = flowchartModalFigure ? figureDrafts[flowchartModalFigure.id] ?? {
    alt_text: flowchartModalFigure.alt_text ?? "",
    long_description: flowchartModalFigure.long_description ?? "",
    is_decorative: Boolean(flowchartModalFigure.is_decorative),
    review_action: flowchartModalFigure.review_action === "ignore" ? "ignore" : "keep",
    figure_type: "flowchart",
    flowchart_guidance: flowchartModalFigure.flowchart_guidance ?? "",
    flowchart: normalizeFlowchartStructure(flowchartModalFigure.flowchart, flowchartModalFigure.flowchart_guidance ?? ""),
  } : null;
  const readinessActions = isPdfDocument ? pdfReadinessActions(remediationPlan) : [];
  const replacement = document.replacement_candidate;
  const standaloneCanvasDeployment = document.standalone_canvas_deployment ?? null;
  const standaloneCanvasFileUrl = standaloneCanvasFilePageUrl(standaloneCanvasDeployment);
  const canvasDeploySuccessUrl = standaloneCanvasFilePageUrl(canvasDeploySuccess);
  const replacementDeployment = replacement?.canvas_deployment ?? null;
  const replacementDeploymentStatus = replacementDeployment?.status ?? "not_deployed";
  const replacementDeploymentActive = ["queued", "running", "retrying"].includes(replacementDeploymentStatus);
  const referencesReviewed = replacement?.status === "references_reviewed" || replacement?.reference_review?.status === "reviewed";
  const replacementCanvasDeployed = Boolean(
    replacementDeploymentStatus === "succeeded"
    || deploymentHistory.some((job) => (
      job.status === "succeeded"
      && Boolean(replacement?.id)
      && job.payload?.replacement_id === replacement?.id
    ))
  );
  const replacementDeployed = Boolean(
    replacementCanvasDeployed
    || document.canvas_archive?.status === "succeeded"
  );
  const replacementStatusText = replacementCanvasDeployed
    ? "deployed to Canvas"
    : replacementDeploymentActive
      ? "deployment queued"
      : referencesReviewed
        ? "references reviewed"
        : replacement?.source === "generated_pdf_export"
          ? "generated export"
          : replacement?.status ?? "candidate";
  const showOriginalCleanup = Boolean(replacementDeployed || document.inventory_decision || document.canvas_archive);
  const cleanupDecision = document.decision_action ?? document.inventory_decision?.action ?? null;
  const latestArchiveJob = archiveHistory[0] ?? null;
  const archiveActive = latestArchiveJob?.status === "queued" || latestArchiveJob?.status === "running" || latestArchiveJob?.status === "retrying";
  const archiveSucceeded = document.canvas_archive?.status === "succeeded" || latestArchiveJob?.status === "succeeded";
  const hasModulePlacement = Boolean(document.module_canvas_id || document.module_name);
  const hasActiveCanvasPlacement = document.linked_count > 0 || hasModulePlacement;
  const isStandaloneDocument = document.uploaded_via === "standalone_document_upload" && !document.canvas_id;
  const standaloneCanvasDeployJobActive = jobs.some((job) => job.job_type === "standalone_document_canvas_deploy" && ACTIVE_JOB_STATUSES.has(job.status));
  const canvasCourseSelectionValid = Boolean(parseCanvasCourseUrl(canvasCourseUrl));
  const canvasCredentialUsable = Boolean(canvasCredentialStatus?.active || canvasPat.trim());
  const archiveBlockedByPlacement = replacementDeployed && hasActiveCanvasPlacement && !archiveSucceeded;
  const archiveBlockReason = document.linked_count > 0
    ? `${document.linked_count} active reference${document.linked_count === 1 ? "" : "s"} still point to the original.`
    : hasModulePlacement && document.module_name
      ? `The original is still placed in ${document.module_name}.`
      : "The original is still placed in a Canvas module.";
  const expandedTagflowPageIndex = expandedTagflowPage
    ? tagflowPages.findIndex((page) => page.page_number === expandedTagflowPage.page_number)
    : -1;

  function renderPdfFigureReview() {
    return (
      <>
        {pdfFigures.length ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {visiblePdfFigures.map((figure) => {
              const draft = figureDrafts[figure.id] ?? {
                alt_text: figure.alt_text ?? "",
                long_description: figure.long_description ?? "",
                is_decorative: Boolean(figure.is_decorative),
                review_action: figure.review_action === "ignore" ? "ignore" : "keep",
                figure_type: figure.figure_type === "diagram" || figure.figure_type === "flowchart" ? figure.figure_type : "image",
                flowchart_guidance: figure.flowchart_guidance ?? "",
                flowchart: normalizeFlowchartStructure(figure.flowchart, figure.flowchart_guidance ?? ""),
              };
              const isBusy = savingFigureId === figure.id || generatingFigureId === figure.id || savingFlowchartFigureId === figure.id;
              const isIgnored = draft.review_action === "ignore";
              const flowchartNodes = draft.flowchart.nodes;
              return (
                <div id={`pdf-figure-${figure.id}`} key={figure.id} className={`scroll-mt-24 rounded-2xl border border-outline-variant/35 p-4 ${isIgnored ? "bg-surface-container-low/60 opacity-75" : "bg-surface-container-low"}`}>
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setExpandedFigure(figure)}
                      className="shrink-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface-container-low"
                      aria-label={`Expand figure preview from page ${figure.page_number}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- PDF figure crops may use signed R2 URLs and do not need Next image optimization. */}
                      <img
                        src={figureAssetSrc(figure)}
                        alt=""
                        className="h-28 w-36 rounded-xl border border-outline-variant/40 bg-surface-container-lowest object-contain"
                        loading="lazy"
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-on-surface">Page {figure.page_number}</p>
                        <span className="rounded-full bg-surface-container-lowest px-2 py-0.5 text-[11px] font-semibold text-on-surface-variant">
                          {figure.fragment_count || 1} fragment{(figure.fragment_count || 1) === 1 ? "" : "s"}
                        </span>
                        {figure.full_page_likely ? (
                          <span className="rounded-full bg-tertiary-container px-2 py-0.5 text-[11px] font-semibold text-on-tertiary-container">
                            full-page fallback
                          </span>
                        ) : null}
                        <span className="rounded-full bg-surface-container-lowest px-2 py-0.5 text-[11px] font-semibold text-on-surface-variant">
                          {isIgnored ? "ignored" : figure.status || "needs_review"}
                        </span>
                      </div>
                      <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-on-surface-variant">
                        <input
                          type="checkbox"
                          checked={draft.is_decorative}
                          onChange={(event) => updateFigureDraft(figure.id, { is_decorative: event.target.checked })}
                          disabled={isIgnored}
                          className="h-4 w-4 rounded border-outline text-primary focus:ring-primary"
                        />
                        Decorative
                      </label>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    <label className="block">
                        <span className="text-xs font-semibold text-on-surface-variant">Figure type</span>
                      <select
                        value={draft.figure_type}
                        onChange={(event) => {
                          const figureType = event.target.value as PdfFigureDraft["figure_type"];
                          updateFigureDraft(figure.id, {
                            figure_type: figureType,
                            flowchart: figureType === "flowchart" ? draft.flowchart : emptyFlowchartStructure(draft.flowchart_guidance),
                          });
                        }}
                        disabled={draft.is_decorative || isIgnored}
                        className="mt-1 w-full rounded-xl border border-outline-variant/45 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary disabled:opacity-60"
                      >
                        <option value="image">Image</option>
                        <option value="diagram">Diagram</option>
                        <option value="flowchart">Flowchart</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-on-surface-variant">Alt text</span>
                      <input
                        value={draft.alt_text}
                        onChange={(event) => updateFigureDraft(figure.id, { alt_text: event.target.value })}
                        disabled={draft.is_decorative || isIgnored}
                        className="mt-1 w-full rounded-xl border border-outline-variant/45 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary disabled:opacity-60"
                        placeholder={isIgnored ? "Ignored figures do not need alt text" : draft.is_decorative ? "Decorative figures do not need alt text" : "Describe the figure"}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-on-surface-variant">Long description</span>
                      <textarea
                        value={draft.long_description}
                        onChange={(event) => updateFigureDraft(figure.id, { long_description: event.target.value })}
                        disabled={draft.is_decorative || isIgnored}
                        rows={3}
                        className="mt-1 w-full resize-y rounded-xl border border-outline-variant/45 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary disabled:opacity-60"
                        placeholder="Optional detailed description"
                      />
                    </label>
                    {draft.figure_type === "diagram" || draft.figure_type === "flowchart" ? (
                      <div className="space-y-2">
                        <label className="block">
                          <span className="text-xs font-semibold text-on-surface-variant">Flowchart guidance</span>
                          <textarea
                            value={draft.flowchart_guidance}
                            onChange={(event) => updateFigureDraft(figure.id, { flowchart_guidance: event.target.value })}
                            disabled={draft.is_decorative || isIgnored}
                            rows={3}
                            className="mt-1 w-full resize-y rounded-xl border border-outline-variant/45 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary disabled:opacity-60"
                            placeholder="Example: Start -> Decision; Decision -> Yes path; Decision -> No path"
                          />
                        </label>
                        {draft.figure_type === "flowchart" ? (
                          <div className="flex flex-col gap-2 rounded-xl border border-outline-variant/45 bg-surface-container-lowest p-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-xs text-on-surface-variant">
                              <span className="font-semibold text-on-surface">{flowchartNodes.length}</span> node{flowchartNodes.length === 1 ? "" : "s"} / <span className="font-semibold text-on-surface">{draft.flowchart.connections.length}</span> connection{draft.flowchart.connections.length === 1 ? "" : "s"}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                updateFigureDraft(figure.id, { figure_type: "flowchart" });
                                setFlowchartModalFigure(figure);
                              }}
                              disabled={draft.is_decorative || isIgnored}
                              className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:opacity-50"
                            >
                              Build flowchart
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void saveFigureReview(figure)}
                      disabled={isBusy}
                      className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:opacity-60"
                    >
                      {savingFigureId === figure.id ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const reviewAction = isIgnored ? "keep" : "ignore";
                        updateFigureDraft(figure.id, { review_action: reviewAction });
                        void saveFigureReview(figure, { review_action: reviewAction });
                      }}
                      disabled={isBusy}
                      className="rounded-xl border border-outline-variant/60 px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-lowest disabled:opacity-50"
                    >
                      {isIgnored ? "Restore" : "Ignore"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void generateFigureText(figure, "alt")}
                      disabled={isBusy || draft.is_decorative || isIgnored}
                      className="rounded-xl bg-secondary-container px-3 py-2 text-xs font-semibold text-on-secondary-container transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {generatingFigureId === figure.id ? "Generating..." : "Generate alt"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void generateFigureText(figure, "long_desc")}
                      disabled={isBusy || draft.is_decorative || isIgnored}
                      className="rounded-xl border border-outline-variant/60 px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-lowest disabled:opacity-50"
                    >
                      Generate long
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-xl bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
            No grouped PDF figures were found. Re-run PDF review after extraction improvements to refresh this inventory.
          </p>
        )}
        {pdfFigures.length > 8 ? (
          <button
            type="button"
            onClick={() => setShowAllFigures((current) => !current)}
            className="mt-4 rounded-xl border border-outline-variant/60 px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
          >
            {showAllFigures ? "Show fewer figures" : `Show all ${pdfFigures.length} figures`}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <input
        ref={replacementInputRef}
        type="file"
        accept={REPLACEMENT_ACCEPT}
        className="hidden"
        onChange={(event) => void handleReplacementUpload(event.target.files?.[0] ?? null)}
      />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <nav className="mb-2 flex items-center gap-2 text-xs text-on-surface-variant">
            <Link href="/dashboard" className="transition-colors hover:text-primary">Dashboard</Link>
            <span>/</span>
            <Link href={`/sessions/${sessionId}/documents`} className="transition-colors hover:text-primary">Documents</Link>
            <span>/</span>
            <span className="font-semibold text-on-surface">Detail</span>
          </nav>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-on-surface-variant">
            <FileText size={16} className="text-primary" />
            Document Detail
          </div>
          <h1 className="mt-2 break-words font-headline text-3xl font-extrabold tracking-tight text-on-surface">
            {document.title || document.filename || "Untitled document"}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-on-surface-variant">
            <span>{document.mime_type || "Unknown type"}</span>
            <span>{formatBytes(document.size_bytes)}</span>
            {document.folder_path || document.folder_name ? <span>{document.folder_path || document.folder_name}</span> : null}
            {analysis.analyzed_at ? <span>Analyzed {new Date(analysis.analyzed_at).toLocaleString()}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/sessions/${sessionId}/documents`}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-surface-container-high px-4 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container"
          >
            <ArrowLeft size={15} />
            Back to documents
          </Link>
          <button
            type="button"
            onClick={() => void startAnalysis()}
            disabled={analysisActionActive}
            className="inline-flex items-center gap-2 rounded-xl bg-surface-container-high px-4 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:opacity-60"
          >
            <RefreshCw size={15} className={analysisActionActive ? "animate-spin" : ""} />
            {analysisButtonLabel}
          </button>
          {fileUrl ? (
            <Link
              href={fileUrl}
              target="_blank"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container"
            >
              <ExternalLink size={15} />
              Open in Canvas
            </Link>
          ) : null}
          {!isStandaloneDocument ? (
            <button
              type="button"
              onClick={() => replacementInputRef.current?.click()}
              disabled={uploadingReplacement}
              className="inline-flex items-center gap-2 rounded-xl bg-secondary-container px-4 py-2 text-sm font-semibold text-on-secondary-container transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <UploadCloud size={15} />
              {uploadingReplacement ? "Uploading" : "Upload replacement"}
            </button>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-3 text-sm text-on-surface">
          {message}
        </div>
      ) : null}

      {canvasDeploySuccess ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-secondary/30 bg-secondary-container/30 px-4 py-3 text-sm text-on-secondary-container sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">
              {canvasDeploySuccess.filename || "Accessible PDF"} was uploaded to Canvas.
            </p>
            <p className="mt-1 text-xs text-on-surface-variant">
              Course {canvasDeploySuccess.canvas_course_id}
              {canvasDeploySuccess.deployed_at ? ` / ${new Date(canvasDeploySuccess.deployed_at).toLocaleString()}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canvasDeploySuccessUrl ? (
              <Link
                href={canvasDeploySuccessUrl}
                target="_blank"
                className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-on-primary transition-colors hover:bg-primary-container"
              >
                Open Canvas file
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => setCanvasDeploySuccess(null)}
              className="rounded-xl bg-surface-container-high px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <section className="rounded-3xl bg-surface-container-lowest p-5 shadow-sm">
        <button
          type="button"
          onClick={() => setComplexityBreakdownOpen((current) => !current)}
          className="flex w-full items-start justify-between gap-4 text-left"
          aria-expanded={complexityBreakdownOpen}
        >
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-headline text-xl font-bold text-on-surface">Complexity Breakdown</h2>
              <Tooltip
                content="The score is a weighted 0-100 total: pages 15%, images 20%, tables 20%, fonts 15%, columns 15%, and scanned pages 15%. Simple is 0-33, Moderate is 34-66, and Complex is 67-100."
                side="bottom"
                align="start"
              >
                <span
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
                  aria-hidden="true"
                >
                  <HelpCircle size={15} />
                </span>
              </Tooltip>
            </div>
            <p className="mt-1 text-sm text-on-surface-variant">
              Six weighted document signals used for the Simple, Moderate, or Complex rating.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className={`rounded-full border px-3 py-1 text-xs font-bold ${complexityClass(analysis.complexity.label)}`}>
              {analysis.complexity.label} ({analysis.complexity.score})
            </span>
            <ChevronDown
              size={20}
              className={`text-on-surface-variant transition-transform ${complexityBreakdownOpen ? "rotate-180" : ""}`}
            />
          </div>
        </button>
        {complexityBreakdownOpen ? (
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {complexityFactors.map((factor) => (
              <div key={factor.key} className="rounded-2xl bg-surface-container-low p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-headline text-base font-bold text-on-surface">{factor.label}</div>
                  <span className="text-xs font-bold text-on-surface-variant">{factor.score}/100</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-surface-container-high">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, Math.min(100, factor.score))}%` }} />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-on-surface-variant">{factor.detail}</p>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {isPdfDocument ? (
        <TagFlowPagesPanel
          sessionId={sessionId}
          documentId={document.id}
          pages={tagflowPages}
          visiblePages={visibleTagflowPages}
          open={tagflowPagesOpen}
          signedUrlFreshnessTimeMs={signedUrlFreshnessTimeMs}
          onToggle={() => setTagflowPagesOpen((current) => !current)}
          onExpandPage={setExpandedTagflowPage}
          onOpenTagFlow={() => openTagFlow()}
          statusLabel={tagflowStatusLabel}
          statusClass={tagflowStatusClass}
          pageAssetSrc={tagflowPageAssetSrc}
        />
      ) : null}

      {isPdfDocument && tagflowWorkspaceOpen && tagflowPages.length ? (
        <TagFlowStructurePreview
          sessionId={sessionId}
          documentId={document.id}
          pages={tagflowPages as TagFlowPreviewPage[]}
          metadataTitle={pdfMetadataDraft.title}
          metadataLanguage={pdfMetadataDraft.language}
          initialEditorPageNumber={tagflowEditorPageNumber}
          openEditorRequestKey={tagflowEditorOpenRequestKey}
          showPageGrid={false}
          onFigureTextGenerated={() => loadDocument({ preserveFigureDrafts: false, silent: true })}
          onTagFlowUpdated={() => loadDocument({ preserveFigureDrafts: false, silent: true })}
        />
      ) : null}

      {isPdfDocument ? (
        <section id="pdf-figures" className="scroll-mt-24 rounded-3xl bg-surface-container-lowest p-5 shadow-sm">
          <button
            type="button"
            onClick={() => setPdfFiguresOpen((current) => !current)}
            className="flex w-full items-center justify-between gap-3 text-left"
            aria-expanded={pdfFiguresOpen}
          >
            <div>
              <h2 className="font-headline text-xl font-bold text-on-surface">PDF Figures</h2>
              <p className="mt-1 text-sm text-on-surface-variant">
                Review extracted figure crops and add alt text before export.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="rounded-full border border-outline-variant/60 bg-surface-container-low px-3 py-1 text-xs font-semibold text-on-surface-variant">
                {figureInventory?.active_figure_count ?? figureInventory?.figure_count ?? 0} active
                {figureInventory?.ignored_count ? ` / ${figureInventory.ignored_count} ignored` : ""}
              </span>
              <ChevronDown
                size={20}
                className={`text-on-surface-variant transition-transform ${pdfFiguresOpen ? "rotate-180" : ""}`}
              />
            </div>
          </button>
          {pdfFiguresOpen ? (
            <div className="mt-5">
              {renderPdfFigureReview()}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          <AccessibilityFindingsPanel findings={analysis.findings} />

          <ReferenceReviewPanel linkedFrom={document.linked_from}>
            {isStandaloneDocument && remediationPlan?.export_artifact ? (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-headline text-lg font-bold text-on-surface">Canvas deployment</h3>
                    <p className="mt-1 text-sm text-on-surface-variant">
                      Upload the accessible PDF export to an ASU Canvas course.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openCanvasDeployModal}
                    disabled={standaloneCanvasDeployJobActive}
                    className="shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:opacity-60"
                  >
                    {standaloneCanvasDeployJobActive ? "Deploying" : standaloneCanvasDeployment?.status === "succeeded" ? "Deploy again" : "Push to Canvas"}
                  </button>
                </div>
                {standaloneCanvasDeployment?.status === "succeeded" ? (
                  <div className="mt-4 rounded-2xl bg-secondary-container/25 px-4 py-3 text-sm text-on-secondary-container">
                    <p className="font-semibold">{standaloneCanvasDeployment.filename || "Accessible PDF"} uploaded to Canvas.</p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      Course {standaloneCanvasDeployment.canvas_course_id}
                      {standaloneCanvasDeployment.deployed_at ? ` / ${new Date(standaloneCanvasDeployment.deployed_at).toLocaleString()}` : ""}
                    </p>
                    {standaloneCanvasFileUrl ? (
                      <Link href={standaloneCanvasFileUrl} target="_blank" className="mt-2 inline-flex text-xs font-semibold text-primary hover:underline">
                        Open Canvas file
                      </Link>
                    ) : null}
                  </div>
                ) : standaloneCanvasDeployJobActive ? (
                  <p className="mt-4 rounded-2xl bg-surface-container-lowest px-4 py-3 text-sm text-on-surface-variant">
                    Canvas upload is running. This panel refreshes while the deployment job is active.
                  </p>
                ) : null}
              </div>
            ) : null}
          </ReferenceReviewPanel>

          {!isStandaloneDocument ? (
            <ReplacementCandidatePanel
              replacement={replacement}
              replacementStatusText={replacementStatusText}
              replacementDeploymentStatus={replacementDeploymentStatus}
              replacementCanvasDeployed={replacementCanvasDeployed}
              replacementDeploymentActive={replacementDeploymentActive}
              referencesReviewed={referencesReviewed}
              linkedCount={document.linked_count}
              deployingReplacement={deployingReplacement}
              onOpenDeployModal={openDeployModal}
            />
          ) : null}

          {showOriginalCleanup ? (
            <OriginalCleanupPanel
              cleanupDecision={cleanupDecision}
              decisionReason={document.decision_reason ?? null}
              replacementDeployed={replacementDeployed}
              archiveBlockedByPlacement={archiveBlockedByPlacement}
              archiveBlockReason={archiveBlockReason}
              canvasArchive={document.canvas_archive}
              latestArchiveJob={latestArchiveJob}
              archiveActive={archiveActive}
              archiveSucceeded={archiveSucceeded}
              hasActiveCanvasPlacement={hasActiveCanvasPlacement}
              savingCleanupDecision={savingCleanupDecision}
              archivingOriginal={archivingOriginal}
              onSaveCleanupDecision={(action) => void saveCleanupDecision(action)}
              onArchiveOriginal={() => void archiveOriginalFile()}
            />
          ) : null}
        </div>

        <div className="space-y-5">
          <RemediationReadinessPanel
            isPdfDocument={isPdfDocument}
            readinessActions={readinessActions}
            exportReadinessStatus={exportReadinessStatus}
            exportReadinessIssueCount={exportReadinessIssueCount}
            exportReadinessIssues={exportReadiness?.issues ?? []}
            pdfExportArtifact={remediationPlan?.export_artifact}
            pdfExportQueueResult={pdfExportQueueResult}
            downloadingPdfExport={downloadingPdfExport}
            preparingPdfExport={preparingPdfExport}
            linkedCount={document.linked_count}
            isOrphaned={document.is_orphaned}
            hasActiveCanvasPlacement={hasActiveCanvasPlacement}
            archiveBlockReason={archiveBlockReason}
            onOpenTagFlow={() => openTagFlow()}
            onExportReadinessIssue={(issue) => handleExportReadinessIssue(issue)}
            onDownloadPdfExport={(kind) => void downloadPdfExport(kind)}
            onPreparePdfExport={() => void preparePdfExport()}
          />

          {isPdfDocument ? (
            <PdfExtractionPanel
              open={pdfExtractionOpen}
              remediationPlan={remediationPlan}
              figureInventory={figureInventory}
              metadataReady={pdfMetadataReady}
              metadataDraft={pdfMetadataDraft}
              languageCustomMode={pdfLanguageCustomMode}
              languageSelectValue={pdfLanguageSelectValue}
              metadataDirty={pdfMetadataDirty}
              savingMetadata={savingPdfMetadata}
              onToggle={() => setPdfExtractionOpen((current) => !current)}
              onTitleChange={(title) => setPdfMetadataDraft((current) => ({ ...current, title }))}
              onLanguageSelectChange={(value) => {
                if (value === CUSTOM_PDF_LANGUAGE_VALUE) {
                  setPdfLanguageCustomMode(true);
                  setPdfMetadataDraft((current) => ({
                    ...current,
                    language: pdfLanguageUsesCustomMode(current.language) ? current.language : "",
                  }));
                  return;
                }
                setPdfLanguageCustomMode(false);
                setPdfMetadataDraft((current) => ({
                  ...current,
                  language: value,
                }));
              }}
              onCustomLanguageChange={(language) => setPdfMetadataDraft((current) => ({ ...current, language }))}
              onSaveMetadata={() => void savePdfMetadata()}
            />
          ) : null}

          <DocumentWorkHistoryPanel workHistory={workHistory} />
        </div>
      </section>

      {expandedTagflowPage ? (
        <TagFlowPagePreviewModal
          page={expandedTagflowPage}
          originalImageSrc={tagflowPageAssetSrc(sessionId, documentId, expandedTagflowPage.page_number, expandedTagflowPage.original_asset, signedUrlFreshnessTimeMs, "original")}
          taggedImageSrc={tagflowPageAssetSrc(sessionId, documentId, expandedTagflowPage.page_number, expandedTagflowPage.tagged_asset, signedUrlFreshnessTimeMs, "tagged")}
          canGoPrevious={expandedTagflowPageIndex > 0}
          canGoNext={expandedTagflowPageIndex >= 0 && expandedTagflowPageIndex < tagflowPages.length - 1}
          statusLabel={tagflowStatusLabel}
          onPrevious={() => {
            if (expandedTagflowPageIndex > 0) {
              setExpandedTagflowPage(tagflowPages[expandedTagflowPageIndex - 1]);
            }
          }}
          onNext={() => {
            if (expandedTagflowPageIndex >= 0 && expandedTagflowPageIndex < tagflowPages.length - 1) {
              setExpandedTagflowPage(tagflowPages[expandedTagflowPageIndex + 1]);
            }
          }}
          onOpenTagFlow={(pageNumber) => openTagFlow(pageNumber)}
          onClose={() => setExpandedTagflowPage(null)}
        />
      ) : null}

      {flowchartModalFigure && flowchartModalDraft ? (
        <FlowchartBuilderModal
          subtitle={`Page ${flowchartModalFigure.page_number} figure structure`}
          preview={(
            <FlowchartVisualAnnotator
              imageSrc={figureAssetSrc(flowchartModalFigure)}
              structure={flowchartModalDraft.flowchart}
              guidance={flowchartModalDraft.flowchart_guidance}
              onStructureChange={(flowchart) => updateFigureDraft(flowchartModalFigure.id, { figure_type: "flowchart", flowchart })}
              onGuidanceChange={(flowchart_guidance) => updateFigureDraft(flowchartModalFigure.id, { flowchart_guidance })}
            />
          )}
          structure={flowchartModalDraft.flowchart}
          guidance={flowchartModalDraft.flowchart_guidance}
          saving={savingFlowchartFigureId === flowchartModalFigure.id}
          onGuidanceChange={(value) => updateFigureDraft(flowchartModalFigure.id, { flowchart_guidance: value })}
          onAddNode={() => addFlowchartNode(flowchartModalFigure.id)}
          onUpdateNode={(nodeId, patch) => updateFlowchartNode(flowchartModalFigure.id, nodeId, patch)}
          onRemoveNode={(nodeId) => removeFlowchartNode(flowchartModalFigure.id, nodeId)}
          onAddConnection={() => addFlowchartConnection(flowchartModalFigure.id)}
          onUpdateConnection={(connectionId, patch) => updateFlowchartConnection(flowchartModalFigure.id, connectionId, patch)}
          onRemoveConnection={(connectionId) => removeFlowchartConnection(flowchartModalFigure.id, connectionId)}
          onClose={() => setFlowchartModalFigure(null)}
          onSave={() => void saveFigureFlowchart(flowchartModalFigure)}
        />
      ) : null}

      {expandedFigure ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/55 px-4 py-8" role="dialog" aria-modal="true">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-surface-container-lowest shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-outline-variant/40 px-5 py-4">
              <div>
                <h2 className="font-headline text-xl font-bold text-on-surface">PDF figure preview</h2>
                <p className="mt-1 text-sm text-on-surface-variant">
                  Page {expandedFigure.page_number} / {expandedFigure.fragment_count || 1} fragment{(expandedFigure.fragment_count || 1) === 1 ? "" : "s"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExpandedFigure(null)}
                className="rounded-full bg-surface-container-low p-2 text-on-surface-variant transition-colors hover:text-on-surface"
                aria-label="Close figure preview"
              >
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 overflow-auto bg-surface-container-low p-4">
              <div className="flex min-h-[50vh] items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- PDF figure previews may be signed R2 URLs and should preserve intrinsic aspect ratio. */}
                <img
                  src={figureAssetSrc(expandedFigure)}
                  alt=""
                  className="max-h-[72vh] w-auto max-w-full rounded-2xl border border-outline-variant/40 bg-surface-container-lowest object-contain"
                />
              </div>
            </div>
            <div className="border-t border-outline-variant/40 px-5 py-4 text-sm text-on-surface-variant">
              {expandedFigure.review_action === "ignore"
                ? "Ignored for remediation."
                : expandedFigure.is_decorative
                  ? "Marked decorative."
                  : expandedFigure.alt_text
                    ? `Alt text: ${expandedFigure.alt_text}`
                    : "No alt text saved yet."}
            </div>
          </div>
        </div>
      ) : null}

      {canvasDeployModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/45 px-4 py-8">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-3xl bg-surface-container-lowest shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-outline-variant/40 px-6 py-5">
              <div>
                <h2 className="font-headline text-xl font-bold text-on-surface">Push accessible PDF to Canvas</h2>
                <p className="mt-1 text-sm text-on-surface-variant">
                  Select an ASU Canvas course for the accessible PDF export.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCanvasDeployModalOpen(false)}
                className="rounded-full bg-surface-container-low p-2 text-on-surface-variant transition-colors hover:text-on-surface"
                aria-label="Close Canvas deployment dialog"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[58vh] space-y-4 overflow-y-auto px-6 py-5">
              <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-3 text-sm">
                {loadingCanvasCredentialStatus ? (
                  <span className="text-on-surface-variant">Checking ASU Canvas token...</span>
                ) : canvasCredentialStatus?.active ? (
                  <div>
                    <p className="font-semibold text-on-surface">ASU Canvas token active</p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {canvasCredentialStatus.expires_at
                        ? `Curator token window expires ${new Date(canvasCredentialStatus.expires_at).toLocaleString()}.`
                        : "Ready to search ASU Canvas courses."}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="font-semibold text-error">ASU Canvas token needed</p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {canvasCredentialStatus?.validation_message || "Provide a Canvas personal access token before searching courses."}
                    </p>
                  </div>
                )}
              </div>

              {canvasCredentialStatus?.active ? (
                <>
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Search courses</span>
                    <input
                      type="search"
                      value={canvasCourseSearch}
                      onChange={(event) => setCanvasCourseSearch(event.target.value)}
                      placeholder="Course name, code, term, or ID"
                      className="w-full rounded-xl border border-outline-variant/60 bg-surface-container-low px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary"
                    />
                  </label>
                  <div className="max-h-56 space-y-2 overflow-y-auto rounded-2xl border border-outline-variant/40 bg-surface-container-low p-2">
                    {loadingCanvasCourses ? (
                      <p className="px-3 py-2 text-sm text-on-surface-variant">Searching ASU Canvas courses...</p>
                    ) : canvasCourseOptions.length ? (
                      canvasCourseOptions.map((course) => (
                        <button
                          key={course.course_id}
                          type="button"
                          onClick={() => setCanvasCourseUrl(course.canvas_url)}
                          className={`block w-full rounded-xl px-4 py-3 text-left text-sm transition-colors hover:bg-surface-container-high ${
                            canvasCourseUrl === course.canvas_url ? "bg-primary/10" : "bg-surface-container-lowest"
                          }`}
                        >
                          <span className="font-semibold text-on-surface">{course.name}</span>
                          <span className="mt-1 block text-xs text-on-surface-variant">
                            {course.course_code || "No code"} / {course.term_name || "No term"} / #{course.course_id}
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="px-3 py-2 text-sm text-on-surface-variant">
                        {canvasCourseSearch.trim() ? "No matching courses found." : "No courses found for this token."}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Canvas personal access token</span>
                    <input
                      type="password"
                      value={canvasPat}
                      onChange={(event) => setCanvasPat(event.target.value)}
                      placeholder="Paste ASU Canvas PAT"
                      className="w-full rounded-xl border border-outline-variant/60 bg-surface-container-low px-4 py-2.5 font-mono text-sm text-on-surface outline-none focus:border-primary"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void saveCanvasPat()}
                    disabled={savingCanvasPat || !canvasPat.trim()}
                    className="self-end rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:opacity-60"
                  >
                    {savingCanvasPat ? "Checking" : "Use token"}
                  </button>
                </div>
              )}
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Selected course URL</span>
                <input
                  type="url"
                  value={canvasCourseUrl}
                  onChange={(event) => {
                    setCanvasCourseUrl(event.target.value);
                  }}
                  placeholder="https://canvas.asu.edu/courses/12345"
                  className="w-full rounded-xl border border-outline-variant/60 bg-surface-container-low px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary"
                />
              </label>
            </div>

            <div className="flex flex-col gap-3 border-t border-outline-variant/40 bg-surface-container-low px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-on-surface-variant">
                The accessible PDF will upload to Canvas Files in the selected course.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCanvasDeployModalOpen(false)}
                  className="rounded-xl bg-surface-container-high px-4 py-2 text-sm font-semibold text-on-surface"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void deployStandaloneToCanvas()}
                  disabled={canvasDeploying || !canvasCourseSelectionValid || !canvasCredentialUsable}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:opacity-60"
                >
                  {canvasDeploying ? "Queuing deployment" : "Queue deployment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {deployModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/45 px-4 py-8">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-3xl bg-surface-container-lowest shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-outline-variant/40 px-6 py-5">
              <div>
                <h2 className="font-headline text-xl font-bold text-on-surface">Deploy replacement to Canvas</h2>
                <p className="mt-1 text-sm text-on-surface-variant">
                  Select the course references that should point to the replacement file. The replacement will upload to Canvas Files and selected links will become pending content revisions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeployModalOpen(false)}
                className="rounded-full bg-surface-container-low p-2 text-on-surface-variant transition-colors hover:text-on-surface"
                aria-label="Close deployment dialog"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[58vh] overflow-y-auto px-6 py-5">
              {document.linked_from.length === 0 ? (
                <div className="rounded-2xl bg-surface-container-low p-4 text-sm text-on-surface-variant">
                  No course references were detected. The replacement can still be uploaded to Canvas Files without creating content revisions.
                </div>
              ) : (
                <div className="space-y-3">
                  {document.linked_from.map((link) => {
                    const key = referenceKey(link);
                    const checked = selectedReferenceKeys.includes(key);
                    return (
                      <label key={key} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-outline-variant/35 bg-surface-container-low p-4">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            setSelectedReferenceKeys((current) => event.target.checked
                              ? [...current, key]
                              : current.filter((value) => value !== key));
                          }}
                          className="mt-1 h-4 w-4 rounded border-outline-variant text-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-on-surface">{link.content_title || "Untitled content"}</p>
                            {link.issue_code ? (
                              <span className="rounded-full bg-error-container px-2.5 py-0.5 text-xs font-semibold text-error">
                                {issueLabel(link.issue_code)}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-on-surface-variant">
                            {contentTypeLabel(link.content_type)}
                            {link.module_name ? ` / ${link.module_name}` : ""}
                            {` / Link #${link.link_index}`}
                          </p>
                          <p className="mt-2 truncate rounded-full bg-surface-container-lowest px-3 py-1 text-xs text-on-surface-variant">
                            {link.text || "No readable link text"}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-outline-variant/40 bg-surface-container-low px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-on-surface-variant">
                {selectedReferenceKeys.length} of {document.linked_from.length} references selected.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDeployModalOpen(false)}
                  className="rounded-xl bg-surface-container-high px-4 py-2 text-sm font-semibold text-on-surface"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void deployReplacement()}
                  disabled={deployingReplacement}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:opacity-60"
                >
                  {deployingReplacement ? "Queuing deployment" : "Queue deployment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
