"use client";

/**
 * Documents inventory screen for Canvas files, PDF remediation entry points,
 * replacement deployment status, and original cleanup tracking.
 */

import Link from "next/link";
import { RefreshCw, Upload } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import Alert from "@/components/edplus/Alert";
import Button, { ButtonLink } from "@/components/edplus/Button";
import Card, { CardBody } from "@/components/edplus/Card";
import EmptyState from "@/components/edplus/EmptyState";
import Pagination from "@/components/edplus/Pagination";
import SearchInput from "@/components/edplus/SearchInput";
import { CardSkeleton } from "@/components/edplus/Skeleton";
import { createClient } from "@/lib/supabase/client";
import type {
  DocumentJobSummary,
  DocumentRow,
  DocumentsResponse,
  FileTypeFilter,
  InventoryDecision,
  PdfReviewType,
  ReviewingDocument,
  SortOption,
  StatusFilter,
} from "@/modules/documents/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";
const PAGE_SIZE = 50;
const STATUS_FILTERS = new Set<StatusFilter>([
  "all",
  "linked",
  "unlinked",
  "filename_links",
  "replacement_deployed",
  "ready_to_archive",
  "still_placed",
  "cleanup_marked",
  "archived",
]);
const FILE_TYPE_FILTERS = new Set<FileTypeFilter>(["all", "pdf", "word", "powerpoint", "spreadsheet", "image", "other"]);
const SORT_OPTIONS = new Set<SortOption>(["priority", "name_asc", "name_desc"]);

function replacementDeployed(item: DocumentRow) {
  return item.replacement_candidate?.canvas_deployment?.status === "succeeded";
}

function hasCanvasPlacement(item: DocumentRow) {
  return item.linked_count > 0 || Boolean(item.module_canvas_id || item.module_name);
}

const EMPTY_COUNTS: DocumentsResponse["counts"] = {
  all: 0,
  linked: 0,
  unlinked: 0,
  filename_links: 0,
  replacement_deployed: 0,
  ready_to_archive: 0,
  still_placed: 0,
  cleanup_marked: 0,
  archived: 0,
};

const EMPTY_FILE_TYPE_COUNTS: Record<FileTypeFilter, number> = {
  all: 0,
  pdf: 0,
  word: 0,
  powerpoint: 0,
  spreadsheet: 0,
  image: 0,
  other: 0,
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

function issueLabel(issueCode: string | null) {
  if (!issueCode) return "Clear";
  return issueCode.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function contentTypeLabel(contentType: string) {
  return contentType.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warning" | "error";
}) {
  const toneClass = tone === "error"
    ? "bg-error-container text-error"
    : tone === "warning"
      ? "bg-secondary-container/30 text-on-secondary-container"
      : "bg-surface-container-lowest text-on-surface-variant";
  const valueClass = tone === "error" ? "text-error" : "text-on-surface";

  return (
    <Card className={`min-h-24 ${toneClass}`}>
      <CardBody className="flex h-full flex-col px-4 py-3">
        <div className="text-sm">{label}</div>
        <div className={`mt-auto pt-2 font-headline text-2xl font-extrabold ${valueClass}`}>{value}</div>
      </CardBody>
    </Card>
  );
}

function accessibilityStatusLabel(item: DocumentRow) {
  if (item.pdf_review_type && item.accessibility_status !== "not_checked") {
    const issueCount = item.accessibility_issue_count ?? 0;
    return {
      label: `${item.pdf_review_type.label} PDF`,
      detail: issueCount > 0
        ? `${item.pdf_review_type.detail || "PDF review completed."} ${issueCount} finding${issueCount === 1 ? "" : "s"} detected.`
        : item.pdf_review_type.detail || "PDF review completed.",
      className: pdfReviewTypeClass(item.pdf_review_type.level),
    };
  }
  if (item.accessibility_status === "needs_review") {
    const count = item.accessibility_issue_count ?? 0;
    return {
      label: count > 0 ? `${count} PDF item${count === 1 ? "" : "s"}` : "Needs review",
      detail: "Initial PDF check found accessibility signals to review.",
      className: "border-error/30 bg-error-container text-error",
    };
  }
  if (item.accessibility_status === "passed_initial_check") {
    return {
      label: "Initial PDF check passed",
      detail: "No issues were detected by the initial PDF probe.",
      className: "border-secondary/30 bg-secondary-container/30 text-on-secondary-container",
    };
  }
  if (item.accessibility_status === "not_checked") {
    return {
      label: "PDF not checked",
      detail: "Run a future document review to inspect this PDF.",
      className: "border-outline-variant/60 bg-surface-container-low text-on-surface-variant",
    };
  }
  return {
    label: "Unsupported for PDF check",
    detail: "Initial document accessibility checks are PDF-only for now.",
    className: "border-outline-variant/60 bg-surface-container-low text-on-surface-variant",
  };
}

function pdfReviewTypeClass(level: PdfReviewType["level"]) {
  if (level === "complex") return "border-error/30 bg-error-container text-error";
  if (level === "moderate") return "border-[#ff7f32]/45 bg-[#fff2e8] text-[#8a3b00]";
  return "border-[#2e7d32]/35 bg-[#e7f4ea] text-[#1f6b2a]";
}

function isPdfDocument(item: DocumentRow) {
  return (item.extension || "").toLowerCase() === "pdf" || item.mime_type === "application/pdf";
}

type PdfPrepStage = "not_started" | "starting" | "previews" | "zones" | "ready" | "review_again";

type PdfPrepStatus = {
  stage: PdfPrepStage;
  actionLabel: string;
  detail: string | null;
  active: boolean;
  openTagFlow: boolean;
  showSpinner: boolean;
};

function lowerStatus(value: string | null | undefined) {
  return (value || "").toLowerCase();
}

const ACTIVE_DOCUMENT_JOB_STATUSES = new Set(["queued", "retrying", "running"]);
const FAILED_DOCUMENT_JOB_STATUSES = new Set(["failed", "canceled"]);

function documentJobLabel(jobType: string | null | undefined) {
  switch (jobType) {
    case "document_analysis":
      return "PDF analysis";
    case "document_remediation":
      return "PDF extraction";
    case "document_structure_preview":
      return "TagFlow previews";
    case "tagflow_ai_suggestions":
      return "AI zones";
    case "pdf_export":
      return "Tagged PDF export";
    case "standalone_document_canvas_deploy":
      return "Canvas deploy";
    case "document_replacement_deploy":
      return "Replacement deploy";
    case "document_file_archive":
      return "Canvas archive";
    default:
      return "Background job";
  }
}

function documentJobStatusLabel(status: string | null | undefined) {
  const normalized = lowerStatus(status);
  if (normalized === "running") return "Running";
  if (normalized === "retrying") return "Retrying";
  if (normalized === "queued") return "Queued";
  if (normalized === "failed") return "Needs attention";
  if (normalized === "canceled") return "Canceled";
  return status || "Pending";
}

function documentJobDetail(job: DocumentJobSummary) {
  const payload = job.payload ?? {};
  if (typeof payload.page_count === "number" && payload.page_count > 0) {
    return `${payload.page_count} page${payload.page_count === 1 ? "" : "s"}`;
  }
  const pageNumbers = Array.isArray(payload.page_numbers) ? payload.page_numbers.length : null;
  if (typeof pageNumbers === "number" && pageNumbers > 0) {
    return `${pageNumbers} page${pageNumbers === 1 ? "" : "s"}`;
  }
  if (typeof payload.page_limit === "number") {
    return `Up to ${payload.page_limit} page${payload.page_limit === 1 ? "" : "s"}`;
  }
  if (job.error_message) return job.error_message;
  return null;
}

function documentQueueStatus(item: DocumentRow) {
  const jobs = item.document_jobs ?? [];
  const activeJobs = jobs.filter((job) => ACTIVE_DOCUMENT_JOB_STATUSES.has(lowerStatus(job.status)));
  if (activeJobs.length) {
    return null;
  }

  const latestJob = jobs[0];
  if (latestJob && FAILED_DOCUMENT_JOB_STATUSES.has(lowerStatus(latestJob.status))) {
    return {
      level: "failed" as const,
      label: `${documentJobStatusLabel(latestJob.status)}: ${documentJobLabel(latestJob.job_type)}`,
      detail: documentJobDetail(latestJob) || "Open details or retry the related action.",
      showSpinner: false,
    };
  }

  return null;
}

function hasFailedPdfPrepJob(item: DocumentRow) {
  const latestJob = item.document_jobs?.[0];
  if (!latestJob || !FAILED_DOCUMENT_JOB_STATUSES.has(lowerStatus(latestJob.status))) return false;
  return ["document_analysis", "document_remediation", "document_structure_preview", "tagflow_ai_suggestions"].includes(latestJob.job_type);
}

function pdfPrepStatus(item: DocumentRow, isLocallyReviewing: boolean): PdfPrepStatus {
  if (!isPdfDocument(item)) {
    return {
      stage: "not_started",
      actionLabel: "",
      detail: null,
      active: false,
      openTagFlow: false,
      showSpinner: false,
    };
  }
  const remediation = item.document_remediation;
  const exportReadinessStatus = lowerStatus(remediation?.export_readiness?.status);
  const exportIssueCount = remediation?.export_readiness?.issue_count ?? 0;
  const replacementStatus = lowerStatus(item.replacement_candidate?.status);
  const deploymentStatus = lowerStatus(item.replacement_candidate?.canvas_deployment?.status);
  const tagflowState = remediation?.tagflow_state;
  const pages = Array.isArray(tagflowState?.pages) ? tagflowState.pages : [];
  const previewGenerationStatus = lowerStatus(tagflowState?.preview_generation?.status);
  const aiGenerationStatus = lowerStatus(tagflowState?.ai_suggestion_generation?.status);
  const previewStatuses = pages.map((page) => lowerStatus(page.preview_asset_status || page.original_asset?.status));
  const originalGeneratedCount = pages.filter((page) => lowerStatus(page.original_asset?.status) === "generated").length;
  const originalPreviewMissing = pages.length > 0 && originalGeneratedCount < pages.length;
  const previewRunning = ["queued", "running", "pending"].includes(previewGenerationStatus)
    || previewStatuses.some((status) => ["queued", "running", "pending"].includes(status));
  const previewFailed = previewGenerationStatus === "failed" || (pages.length > 0 && originalGeneratedCount === 0 && previewStatuses.includes("failed"));
  const aiRunning = ["queued", "running", "pending"].includes(aiGenerationStatus)
    || pages.some((page) => ["queued", "running", "pending"].includes(lowerStatus(page.ai_suggestions?.status)));
  const aiGenerated = ["generated", "partial", "failed"].includes(aiGenerationStatus)
    || pages.some((page) => ["generated", "failed"].includes(lowerStatus(page.ai_suggestions?.status)));
  const autoApplied = pages.some((page) => lowerStatus(page.ai_draft_applied?.status) === "applied" || (page.zone_count || 0) > 0 || (page.zones?.length || 0) > 0);

  if (isLocallyReviewing && !remediation) {
    return {
      stage: "starting",
      actionLabel: "Starting review",
      detail: "Initial analysis and remediation planning are being queued.",
      active: true,
      openTagFlow: false,
      showSpinner: true,
    };
  }
  if (!remediation) {
    if (hasFailedPdfPrepJob(item)) {
      return {
        stage: "not_started",
        actionLabel: "Error - retry scan",
        detail: "The previous PDF analysis request did not complete.",
        active: false,
        openTagFlow: false,
        showSpinner: false,
      };
    }
    return {
      stage: "not_started",
      actionLabel: "Analyze PDF",
      detail: null,
      active: false,
      openTagFlow: false,
      showSpinner: false,
    };
  }
  if (!autoApplied && !aiGenerated && originalGeneratedCount === 0 && (previewRunning || originalPreviewMissing)) {
    return {
      stage: "previews",
      actionLabel: previewFailed ? "Error - retry scan" : "Preparing previews",
      detail: previewFailed
        ? "Page preview generation did not complete. Retry the scan before TagFlow review."
        : "Page previews are still being prepared in the background.",
      active: !previewFailed,
      openTagFlow: false,
      showSpinner: !previewFailed,
    };
  }
  if (aiRunning) {
    return {
      stage: "zones",
      actionLabel: "Generating zones",
      detail: "AI tagged zones are still being generated and auto-applied.",
      active: true,
      openTagFlow: false,
      showSpinner: true,
    };
  }
  if (autoApplied || aiGenerated || originalGeneratedCount > 0) {
    if (deploymentStatus === "succeeded") {
      return {
        stage: "ready",
        actionLabel: "Open TagFlow",
        detail: "Replacement deployed. Original cleanup can be reviewed from document details.",
        active: false,
        openTagFlow: true,
        showSpinner: false,
      };
    }
    if (replacementStatus === "uploaded" || replacementStatus === "ready" || item.replacement_candidate?.export_artifact_id) {
      return {
        stage: "ready",
        actionLabel: "Open TagFlow",
        detail: "Accessible PDF has been generated. Deploy or review from document details.",
        active: false,
        openTagFlow: true,
        showSpinner: false,
      };
    }
    if (exportReadinessStatus === "ready" || exportReadinessStatus === "passed") {
      return {
        stage: "ready",
        actionLabel: "Open TagFlow",
        detail: "Export is ready from document details.",
        active: false,
        openTagFlow: true,
        showSpinner: false,
      };
    }
    if (exportIssueCount > 0 || exportReadinessStatus === "needs_attention") {
      return {
        stage: "ready",
        actionLabel: "Open TagFlow",
        detail: "TagFlow review is ready. Open details to finish export readiness items.",
        active: false,
        openTagFlow: true,
        showSpinner: false,
      };
    }
    return {
      stage: "ready",
      actionLabel: "Open TagFlow",
      detail: autoApplied
        ? "Previews and draft tagged zones are ready for manual TagFlow review."
        : "Page previews are ready for manual TagFlow review.",
      active: false,
      openTagFlow: true,
      showSpinner: false,
    };
  }
  return {
    stage: "review_again",
    actionLabel: "Review again",
    detail: null,
    active: false,
    openTagFlow: false,
    showSpinner: false,
  };
}

function decisionLabel(action: InventoryDecision["action"] | null | undefined) {
  if (action === "delete") return "Cleanup marked";
  if (action === "defer") return "Cleanup deferred";
  if (action === "keep") return "Keep original";
  return null;
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

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return body.detail ?? fallback;
}

function parseStatusFilter(value: string | null): StatusFilter {
  return value && STATUS_FILTERS.has(value as StatusFilter) ? value as StatusFilter : "all";
}

function parseFileTypeFilter(value: string | null): FileTypeFilter {
  return value && FILE_TYPE_FILTERS.has(value as FileTypeFilter) ? value as FileTypeFilter : "all";
}

function parseSortOption(value: string | null): SortOption {
  return value && SORT_OPTIONS.has(value as SortOption) ? value as SortOption : "priority";
}

function parseOffset(value: string | null) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed / PAGE_SIZE) * PAGE_SIZE;
}

function buildDocumentsQueryString({
  query,
  status,
  fileType,
  sort,
  offset,
}: {
  query: string;
  status: StatusFilter;
  fileType: FileTypeFilter;
  sort: SortOption;
  offset: number;
}) {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (status !== "all") params.set("status", status);
  if (fileType !== "all") params.set("type", fileType);
  if (sort !== "priority") params.set("sort", sort);
  if (offset > 0) params.set("offset", String(offset));
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export default function DocumentsManager({ sessionId, sessionType }: { sessionId: string; sessionType?: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const initialStatus = parseStatusFilter(searchParams.get("status"));
  const initialFileType = parseFileTypeFilter(searchParams.get("type"));
  const initialSort = parseSortOption(searchParams.get("sort"));
  const initialOffset = parseOffset(searchParams.get("offset"));
  const [draftQuery, setDraftQuery] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [draftStatus, setDraftStatus] = useState<StatusFilter>(initialStatus);
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [draftFileType, setDraftFileType] = useState<FileTypeFilter>(initialFileType);
  const [fileType, setFileType] = useState<FileTypeFilter>(initialFileType);
  const [draftSort, setDraftSort] = useState<SortOption>(initialSort);
  const [sort, setSort] = useState<SortOption>(initialSort);
  const [offset, setOffset] = useState(initialOffset);
  const [items, setItems] = useState<DocumentRow[]>([]);
  const [counts, setCounts] = useState<DocumentsResponse["counts"]>(EMPTY_COUNTS);
  const [fileTypeCounts, setFileTypeCounts] = useState<Record<FileTypeFilter, number>>(EMPTY_FILE_TYPE_COUNTS);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [reviewingDocuments, setReviewingDocuments] = useState<Record<string, ReviewingDocument>>({});
  const [expandedFindingIds, setExpandedFindingIds] = useState<Set<string>>(() => new Set());
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(() => new Set());
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [queueingSelectedPdfs, setQueueingSelectedPdfs] = useState(false);
  const [prepWatchUntil, setPrepWatchUntil] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const visiblePdfItems = items.filter(isPdfDocument);
  const isStandaloneDocumentSession = sessionType === "document";
  const selectedPdfItems = visiblePdfItems.filter((item) => selectedDocumentIds.has(item.id));
  const selectedPdfItemsReadyToQueue = selectedPdfItems.filter((item) => !reviewingDocuments[item.id] && !pdfPrepStatus(item, false).active);
  const allVisiblePdfsSelected = visiblePdfItems.length > 0 && visiblePdfItems.every((item) => selectedDocumentIds.has(item.id));
  const hasActivePdfPrep = visiblePdfItems.some((item) => pdfPrepStatus(item, Boolean(reviewingDocuments[item.id])).active);
  const prepWatchActive = prepWatchUntil > nowMs;

  const replaceDocumentsUrl = useCallback((nextState: {
    query: string;
    status: StatusFilter;
    fileType: FileTypeFilter;
    sort: SortOption;
    offset: number;
  }) => {
    router.replace(
      `/sessions/${sessionId}/documents${buildDocumentsQueryString(nextState)}`,
      { scroll: false },
    );
  }, [router, sessionId]);

  const getAccessToken = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return session.access_token;
  }, []);

  const loadDocuments = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!silent) {
      setLoading(true);
      setMessage(null);
    }
    try {
      const token = await getAccessToken();
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        status,
        file_type: fileType,
        sort,
      });
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to load documents"));
      const data = await res.json() as DocumentsResponse;
      setItems(data.items);
      setCounts({ ...EMPTY_COUNTS, ...data.counts });
      setFileTypeCounts({ ...EMPTY_FILE_TYPE_COUNTS, ...(data.file_type_counts ?? {}) });
      setTotalCount(data.total_count);
    } catch (error) {
      if (!silent) {
        setItems([]);
        setCounts(EMPTY_COUNTS);
        setFileTypeCounts(EMPTY_FILE_TYPE_COUNTS);
        setTotalCount(0);
      }
      setMessage(error instanceof Error ? error.message : "Failed to load documents");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [fileType, getAccessToken, offset, query, sessionId, sort, status]);

  const startPdfReview = useCallback(async (item: DocumentRow) => {
    if (!isPdfDocument(item) || reviewingDocuments[item.id]) return;
    setReviewingDocuments((current) => ({
      ...current,
      [item.id]: {
        previousReviewedAt: item.pdf_reviewed_at ?? null,
        startedAt: Date.now(),
      },
    }));
    setPrepWatchUntil(Date.now() + 180000);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const analysisRes = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${item.id}/analysis`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!analysisRes.ok) throw new Error(await parseApiError(analysisRes, "Failed to start document analysis"));

      const remediationRes = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${item.id}/remediation`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!remediationRes.ok) throw new Error(await parseApiError(remediationRes, "Failed to start PDF extraction"));

      setMessage(`PDF analysis queued for ${item.filename || item.title || "document"}. Previews and AI zones will continue preparing in the background.`);
      window.setTimeout(() => void loadDocuments({ silent: true }), 750);
      window.setTimeout(() => {
        void loadDocuments({ silent: true });
      }, 15000);
    } catch (error) {
      setReviewingDocuments((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setMessage(error instanceof Error ? error.message : "Failed to start PDF analysis");
    }
  }, [getAccessToken, loadDocuments, reviewingDocuments, sessionId]);

  const uploadStandaloneDocument = useCallback(async () => {
    if (!isStandaloneDocumentSession || !uploadFile || uploading) return;
    setUploading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append("file", uploadFile);
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to upload document"));
      const data = await res.json() as { document?: DocumentRow; queued_jobs?: { job_type: string }[] };
      if (data.queued_jobs?.length) setPrepWatchUntil(Date.now() + 180000);
      setUploadFile(null);
      setMessage(
        data.queued_jobs?.length
          ? `Uploaded ${data.document?.filename || "document"} and queued PDF analysis.`
          : `Uploaded ${data.document?.filename || "document"}.`,
      );
      setOffset(0);
      await loadDocuments({ silent: true });
      window.setTimeout(() => void loadDocuments({ silent: true }), 2500);
      window.setTimeout(() => void loadDocuments({ silent: true }), 15000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload document");
    } finally {
      setUploading(false);
    }
  }, [getAccessToken, isStandaloneDocumentSession, loadDocuments, sessionId, uploadFile, uploading]);

  const toggleDocumentSelection = useCallback((itemId: string) => {
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const toggleVisiblePdfSelection = useCallback(() => {
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      const shouldSelect = visiblePdfItems.some((item) => !next.has(item.id));
      for (const item of visiblePdfItems) {
        if (shouldSelect) {
          next.add(item.id);
        } else {
          next.delete(item.id);
        }
      }
      return next;
    });
  }, [visiblePdfItems]);

  const startSelectedPdfReviews = useCallback(async () => {
    if (queueingSelectedPdfs) return;
    const queueItems = selectedPdfItems.filter((item) => !reviewingDocuments[item.id] && !pdfPrepStatus(item, false).active);
    if (queueItems.length === 0) return;
    setQueueingSelectedPdfs(true);
    const startedAt = Date.now();
    setPrepWatchUntil(startedAt + 180000);
    setReviewingDocuments((current) => {
      const next = { ...current };
      for (const item of queueItems) {
        next[item.id] = {
          previousReviewedAt: item.pdf_reviewed_at ?? null,
          startedAt,
        };
      }
      return next;
    });
    setMessage(null);
    try {
      const token = await getAccessToken();
      const failures: string[] = [];
      const failedIds: string[] = [];
      for (const item of queueItems) {
        try {
          const analysisRes = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${item.id}/analysis`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          if (!analysisRes.ok) throw new Error(await parseApiError(analysisRes, "Failed to start document analysis"));

          const remediationRes = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${item.id}/remediation`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          if (!remediationRes.ok) throw new Error(await parseApiError(remediationRes, "Failed to start PDF extraction"));
        } catch (error) {
          failedIds.push(item.id);
          failures.push(`${item.filename || item.title || "document"}: ${error instanceof Error ? error.message : "queue failed"}`);
        }
      }
      if (failures.length > 0) {
        setReviewingDocuments((current) => {
          const next = { ...current };
          for (const itemId of failedIds) delete next[itemId];
          return next;
        });
        setMessage(`Queued ${queueItems.length - failures.length} PDF analys${queueItems.length - failures.length === 1 ? "is" : "es"}. ${failures.length} failed to queue.`);
      } else {
        setSelectedDocumentIds((current) => {
          const next = new Set(current);
          for (const item of queueItems) next.delete(item.id);
          return next;
        });
        setMessage(`Queued ${queueItems.length} PDF analys${queueItems.length === 1 ? "is" : "es"}. Previews and AI zones will continue preparing in the background.`);
      }
      window.setTimeout(() => void loadDocuments({ silent: true }), 750);
      window.setTimeout(() => void loadDocuments({ silent: true }), 15000);
    } catch (error) {
      setReviewingDocuments((current) => {
        const next = { ...current };
        for (const item of queueItems) delete next[item.id];
        return next;
      });
      setMessage(error instanceof Error ? error.message : "Failed to queue selected PDF analyses");
    } finally {
      setQueueingSelectedPdfs(false);
    }
  }, [getAccessToken, loadDocuments, queueingSelectedPdfs, reviewingDocuments, selectedPdfItems, sessionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDocuments();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadDocuments]);

  useEffect(() => {
    if (Object.keys(reviewingDocuments).length === 0 && !hasActivePdfPrep && !prepWatchActive) return;
    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNowMs(currentTime);
      if (prepWatchUntil > 0 && currentTime > prepWatchUntil) {
        setPrepWatchUntil(0);
      }
      void loadDocuments({ silent: true });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [hasActivePdfPrep, loadDocuments, prepWatchActive, prepWatchUntil, reviewingDocuments]);

  useEffect(() => {
    if (Object.keys(reviewingDocuments).length === 0) return;
    const timer = window.setTimeout(() => {
      let changed = false;
      let nextMessage: string | null = null;
      const next = { ...reviewingDocuments };
      const currentTime = Date.now();
      for (const item of items) {
        const reviewState = next[item.id];
        if (!reviewState) continue;
        const prepStatus = pdfPrepStatus(item, false);
        if (item.pdf_reviewed_at && item.pdf_reviewed_at !== reviewState.previousReviewedAt) {
          delete next[item.id];
          changed = true;
          nextMessage = prepStatus.active
            ? `PDF analysis started for ${item.filename || item.title || "document"}. ${prepStatus.detail || "Preparation is continuing in the background."}`
            : `PDF analysis prep is ready for ${item.filename || item.title || "document"}.`;
        } else if (currentTime - reviewState.startedAt > 45000) {
          delete next[item.id];
          changed = true;
          nextMessage = "PDF analysis is still running. Results will continue to appear after the next refresh.";
        }
      }
      if (changed) setReviewingDocuments(next);
      if (nextMessage) setMessage(nextMessage);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [items, reviewingDocuments]);

  function toggleFindings(itemId: string) {
    setExpandedFindingIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  return (
    <div className="max-w-7xl mx-auto space-y-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <nav className="flex items-center gap-2 text-on-surface-variant text-xs mb-2">
            <Link href="/dashboard" className="hover:text-primary transition-colors">Dashboard</Link>
            <span>›</span>
            <Link href={`/sessions/${sessionId}/health`} className="hover:text-primary transition-colors">Course Health</Link>
            <span>›</span>
            <span className="text-on-surface font-semibold">Documents</span>
          </nav>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface tracking-tight">
            Document Inventory
          </h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Review Canvas course files, uploaded editor documents, link usage, and initial PDF accessibility status.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-6">
          <StatCard label="Files" value={counts.all} />
          <StatCard label="Ready Archive" value={counts.ready_to_archive} tone="warning" />
          <StatCard label="Still Placed" value={counts.still_placed} />
          <StatCard label="Cleanup Marked" value={counts.cleanup_marked} />
          <StatCard label="Archived" value={counts.archived} />
          <StatCard label="Filename Links" value={counts.filename_links} tone="error" />
        </div>
      </div>

      <form
        className="rounded-3xl bg-surface-container-low p-4 shadow-sm flex flex-col gap-3 lg:flex-row lg:items-center"
        onSubmit={(event) => {
          event.preventDefault();
          const nextQuery = draftQuery.trim();
          setOffset(0);
          setQuery(nextQuery);
          setStatus(draftStatus);
          setFileType(draftFileType);
          setSort(draftSort);
          setSelectedDocumentIds(new Set());
          replaceDocumentsUrl({
            query: nextQuery,
            status: draftStatus,
            fileType: draftFileType,
            sort: draftSort,
            offset: 0,
          });
        }}
      >
        <SearchInput
          value={draftQuery}
          onChange={setDraftQuery}
          placeholder="Search filename, type, or folder"
          debounceMs={0}
          className="flex-1"
        />
        <select
          value={draftStatus}
          onChange={(event) => setDraftStatus(event.target.value as StatusFilter)}
          className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary"
        >
          <option value="all">All files</option>
          <option value="linked">Linked files</option>
          <option value="unlinked">No content links</option>
          <option value="filename_links">Filename link text</option>
          <option value="replacement_deployed">Replacement deployed</option>
          <option value="ready_to_archive">Ready to archive</option>
          <option value="still_placed">Still placed</option>
          <option value="cleanup_marked">Cleanup marked</option>
          <option value="archived">Archived</option>
        </select>
        <select
          value={draftFileType}
          onChange={(event) => setDraftFileType(event.target.value as FileTypeFilter)}
          className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary"
        >
          <option value="all">All types ({fileTypeCounts.all})</option>
          <option value="pdf">PDFs ({fileTypeCounts.pdf})</option>
          <option value="word">Word ({fileTypeCounts.word})</option>
          <option value="powerpoint">PowerPoint ({fileTypeCounts.powerpoint})</option>
          <option value="spreadsheet">Excel/CSV ({fileTypeCounts.spreadsheet})</option>
          <option value="image">Images ({fileTypeCounts.image})</option>
          <option value="other">Other ({fileTypeCounts.other})</option>
        </select>
        <select
          value={draftSort}
          onChange={(event) => setDraftSort(event.target.value as SortOption)}
          className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary"
        >
          <option value="priority">Priority</option>
          <option value="name_asc">Name A-Z</option>
          <option value="name_desc">Name Z-A</option>
        </select>
        <Button type="submit">
          Apply
        </Button>
      </form>

      {isStandaloneDocumentSession ? (
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-headline text-base font-bold text-on-surface">Upload document</h2>
              <p className="mt-1 text-xs text-on-surface-variant">
                Add a standalone PDF, Word, PowerPoint, CSV, or Excel file. PDFs start the remediation prep queue automatically.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="file"
                accept=".pdf,.doc,.docx,.ppt,.pptx,.csv,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                className="max-w-full rounded-xl border border-outline-variant/60 bg-surface-container-low px-3 py-2 text-xs text-on-surface file:mr-3 file:rounded-lg file:border-0 file:bg-surface-container-high file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-on-surface"
              />
              <Button
                type="button"
                size="sm"
                onClick={() => void uploadStandaloneDocument()}
                disabled={!uploadFile || uploading}
                icon={uploading ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
              >
                {uploading ? "Uploading…" : "Upload"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {visiblePdfItems.length > 1 && !isStandaloneDocumentSession ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-outline-variant/40 bg-surface-container-lowest px-4 py-3 text-sm shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <label className="inline-flex items-center gap-3 font-semibold text-on-surface">
            <input
              type="checkbox"
              checked={allVisiblePdfsSelected}
              onChange={toggleVisiblePdfSelection}
              className="h-4 w-4 rounded border-outline-variant text-primary"
            />
            Select visible PDFs
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-on-surface-variant">
              {selectedPdfItems.length} selected on this page
            </span>
            <Button
              type="button"
              size="sm"
              onClick={() => void startSelectedPdfReviews()}
              disabled={queueingSelectedPdfs || selectedPdfItemsReadyToQueue.length === 0}
              icon={queueingSelectedPdfs ? <RefreshCw size={14} className="animate-spin" /> : undefined}
            >
              {queueingSelectedPdfs ? "Queueing analyses..." : "Analyze selected PDFs"}
            </Button>
          </div>
        </div>
      ) : null}

      {message ? (
        <Alert variant="info">
          {message}
        </Alert>
      ) : null}

      <div className="space-y-4">
        {loading ? (
          <CardSkeleton lines={4} className="rounded-3xl" />
        ) : items.length === 0 ? (
          <Card>
            <EmptyState
              title="No documents matched this view"
              description="Try a different filter or re-sync the course if files changed recently."
              size="lg"
            />
          </Card>
        ) : (
          <>
            {items.map((item) => (
              <article key={item.id} className="rounded-3xl border border-outline-variant/40 bg-surface-container-lowest p-5 shadow-sm">
                {(() => {
                  const accessibilityStatus = accessibilityStatusLabel(item);
                  const prepStatus = pdfPrepStatus(item, Boolean(reviewingDocuments[item.id]));
                  const queueStatus = documentQueueStatus(item);
                  return (
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {isPdfDocument(item) ? (
                        <label className="inline-flex items-center gap-2 rounded-full border border-outline-variant/60 bg-surface-container-low px-3 py-1 text-xs font-semibold text-on-surface-variant">
                          <input
                            type="checkbox"
                            checked={selectedDocumentIds.has(item.id)}
                            onChange={() => toggleDocumentSelection(item.id)}
                            className="h-3.5 w-3.5 rounded border-outline-variant text-primary"
                          />
                          Select
                        </label>
                      ) : null}
                      {item.extension ? (
                        <span className="inline-flex rounded-full border border-outline-variant/60 bg-surface-container-low px-3 py-1 text-xs font-semibold uppercase text-on-surface-variant">
                          {item.extension}
                        </span>
                      ) : null}
                      {item.filename_link_count > 0 ? (
                        <span className="inline-flex rounded-full border border-error/30 bg-error-container px-3 py-1 text-xs font-semibold text-error">
                          Filename link text
                        </span>
                      ) : null}
                      {item.linked_count > 0 ? (
                        <span className="inline-flex rounded-full border border-secondary/30 bg-secondary-container/30 px-3 py-1 text-xs font-semibold text-on-secondary-container">
                          Linked {item.linked_count}
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full border border-outline-variant/60 bg-surface-container-low px-3 py-1 text-xs font-semibold text-on-surface-variant">
                          No content links
                        </span>
                      )}
                      {item.module_canvas_id || item.module_name ? (
                        <span className="inline-flex rounded-full border border-outline-variant/60 bg-surface-container-low px-3 py-1 text-xs font-semibold text-on-surface-variant">
                          In module
                        </span>
                      ) : null}
                      {item.uploaded_via === "editor_file_upload" ? (
                        <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                          Editor upload
                        </span>
                      ) : null}
                      {item.replacement_candidate ? (
                        <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                          {replacementDeployed(item) ? "Replacement deployed" : "Replacement candidate"}
                        </span>
                      ) : null}
                      {item.is_replacement_file ? (
                        <span className="inline-flex rounded-full border border-secondary/30 bg-secondary-container/30 px-3 py-1 text-xs font-semibold text-on-secondary-container">
                          Replacement file
                        </span>
                      ) : null}
                      {replacementDeployed(item) ? (
                        <span className="inline-flex rounded-full border border-outline-variant/60 bg-surface-container-low px-3 py-1 text-xs font-semibold text-on-surface-variant">
                          {hasCanvasPlacement(item) ? "Original still placed" : "Original ready to archive"}
                        </span>
                      ) : null}
                      {replacementDeployed(item) && decisionLabel(item.decision_action) ? (
                        <span className="inline-flex rounded-full border border-secondary/30 bg-secondary-container/30 px-3 py-1 text-xs font-semibold text-on-secondary-container">
                          {decisionLabel(item.decision_action)}
                        </span>
                      ) : null}
                      {item.canvas_archive?.status === "succeeded" ? (
                        <span className="inline-flex rounded-full border border-outline-variant/60 bg-surface-container-low px-3 py-1 text-xs font-semibold text-on-surface-variant">
                          Archived in Canvas
                        </span>
                      ) : null}
                      {item.non_embedded_image_file ? (
                        <span className="inline-flex rounded-full border border-outline-variant/60 bg-surface-container-low px-3 py-1 text-xs font-semibold text-on-surface-variant">
                          Non-embedded image file
                        </span>
                      ) : null}
                      <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${accessibilityStatus.className}`}>
                        {accessibilityStatus.label}
                      </span>
                    </div>
                    <h2 className="break-words font-headline text-xl font-bold text-on-surface">
                      {item.title || item.filename || "Untitled file"}
                    </h2>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-on-surface-variant">
                      <span>{item.mime_type || "Unknown type"}</span>
                      <span>{formatBytes(item.size_bytes)}</span>
                      {item.folder_path || item.folder_name ? <span>{item.folder_path || item.folder_name}</span> : null}
                    </div>
                    <p className="text-sm text-on-surface-variant">{prepStatus.detail || accessibilityStatus.detail}</p>
                    {queueStatus ? (
                      <div
                        className="inline-flex max-w-full items-start gap-2 rounded-2xl border border-error/30 bg-error-container/70 px-3 py-2 text-xs text-error"
                      >
                        <RefreshCw size={14} className="mt-0.5 shrink-0" />
                        <span className="min-w-0">
                          <span className="block font-semibold">{queueStatus.label}</span>
                          <span className="block break-words">{queueStatus.detail}</span>
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {prepStatus.openTagFlow ? (
                      <ButtonLink
                        href={`/sessions/${sessionId}/documents/${item.id}#tagflow-pages`}
                        size="sm"
                        className="text-xs"
                      >
                        {prepStatus.actionLabel}
                      </ButtonLink>
                    ) : isPdfDocument(item) ? (
                      <Button
                        type="button"
                        onClick={() => void startPdfReview(item)}
                        disabled={prepStatus.active}
                        loading={prepStatus.showSpinner}
                        variant="ghost"
                        size="sm"
                        icon={<RefreshCw size={14} />}
                        className="text-xs"
                      >
                        {prepStatus.actionLabel}
                      </Button>
                    ) : null}
                    <ButtonLink
                      href={`/sessions/${sessionId}/documents/${item.id}`}
                      variant="ghost"
                      size="sm"
                      className="text-xs text-on-surface"
                    >
                      Review details
                    </ButtonLink>
                    {item.canvas_url ? (
                      <ButtonLink
                        href={canvasFilePageUrl(item.canvas_url) ?? item.canvas_url}
                        target="_blank"
                        size="sm"
                        className="text-xs"
                      >
                        Open in Canvas
                      </ButtonLink>
                    ) : null}
                  </div>
                </div>
                  );
                })()}

                {item.source_content_item ? (
                  <div className="mt-5 rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-3">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-on-surface-variant">Uploaded From</p>
                        <p className="mt-1 truncate font-semibold text-on-surface">
                          {item.source_content_item.title || "Untitled content"}
                        </p>
                        <p className="mt-0.5 text-xs text-on-surface-variant">
                          {contentTypeLabel(item.source_content_item.content_type)}
                          {item.source_content_item.module_name ? ` · ${item.source_content_item.module_name}` : ""}
                        </p>
                      </div>
                      {item.source_content_item.canvas_url ? (
                        <Link href={item.source_content_item.canvas_url} target="_blank" className="text-xs font-semibold text-primary hover:underline">
                          Open source
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {item.accessibility_review?.issues?.length ? (
                  <div className="mt-5 rounded-2xl border border-error/20 bg-error-container/45 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-error">Initial PDF Findings</h3>
                        <p className="mt-1 text-xs text-on-surface-variant">
                          {item.accessibility_review.issues.length} finding{item.accessibility_review.issues.length === 1 ? "" : "s"} stored for remediation planning.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleFindings(item.id)}
                        className="rounded-xl bg-surface-container-lowest px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container"
                      >
                        {expandedFindingIds.has(item.id) ? "Hide findings" : "Show findings"}
                      </button>
                    </div>
                    {expandedFindingIds.has(item.id) ? (
                      <>
                        <ul className="mt-3 space-y-2">
                          {item.accessibility_review.issues.slice(0, 4).map((issue) => (
                            <li key={`${item.id}:${issue.code}`} className="text-sm text-on-surface">
                              {issue.message}
                            </li>
                          ))}
                        </ul>
                        {item.accessibility_review.issues.length > 4 ? (
                          <p className="mt-2 text-xs text-on-surface-variant">
                            Showing 4 of {item.accessibility_review.issues.length} findings.
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-5 rounded-2xl border border-outline-variant/40 bg-surface-container-low p-4">
                  <div className="flex items-center justify-between gap-3 border-b border-outline-variant/40 pb-3">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-on-surface-variant">Linked From</h3>
                    <span className="text-xs text-on-surface-variant">{item.linked_count} references</span>
                  </div>
                  {item.linked_from.length === 0 ? (
                    <p className="mt-4 text-sm text-on-surface-variant">No links to this file were found in stored page, assignment, discussion, or quiz HTML.</p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {item.linked_from.slice(0, 5).map((link) => (
                        <div key={`${link.content_item_id}:${link.link_index}:${link.href}`} className="rounded-xl bg-surface-container-lowest px-3 py-3">
                          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <p className="font-semibold text-on-surface">{link.content_title || "Untitled content"}</p>
                              <p className="mt-1 text-xs text-on-surface-variant">
                                {contentTypeLabel(link.content_type)}
                                {link.module_name ? ` · ${link.module_name}` : ""}
                                {` · Link #${link.link_index}`}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {link.content_canvas_url ? (
                                <Link href={link.content_canvas_url} target="_blank" className="text-xs font-semibold text-primary hover:underline">
                                  Open source
                                </Link>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-surface-container-low px-3 py-1 text-xs text-on-surface-variant">
                              {link.text || "No readable link text"}
                            </span>
                            {link.issue_code ? (
                              <span className="rounded-full bg-error-container px-3 py-1 text-xs font-semibold text-error">
                                {issueLabel(link.issue_code)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                      {item.linked_from.length > 5 ? (
                        <p className="text-xs text-on-surface-variant">
                          Showing 5 of {item.linked_from.length} references.
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </>
        )}
      </div>

      <div className="rounded-2xl bg-surface-container-low px-4 py-3">
        <Pagination
          page={Math.min(currentPage, totalPages)}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={(page) => {
            const nextOffset = (page - 1) * PAGE_SIZE;
            setOffset(nextOffset);
            replaceDocumentsUrl({ query, status, fileType, sort, offset: nextOffset });
          }}
        />
      </div>
    </div>
  );
}
