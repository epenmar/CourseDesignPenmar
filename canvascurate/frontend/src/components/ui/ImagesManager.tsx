"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckSquare, Square } from "lucide-react";

import Alert from "@/components/edplus/Alert";
import BulkActionBar from "@/components/edplus/BulkActionBar";
import Button, { ButtonLink } from "@/components/edplus/Button";
import Card, { CardBody } from "@/components/edplus/Card";
import EmptyState from "@/components/edplus/EmptyState";
import Pagination from "@/components/edplus/Pagination";
import SearchInput from "@/components/edplus/SearchInput";
import { CardSkeleton } from "@/components/edplus/Skeleton";
import { createClient } from "@/lib/supabase/client";
import SyncCourseButton from "@/components/ui/SyncCourseButton";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";
const PAGE_SIZE = 24;
const EMPTY_STATUS_COUNTS: Record<StatusFilter, number> = {
  all: 0,
  deployed: 0,
  broken: 0,
  orphaned: 0,
};

type AltFilter = "all" | "missing" | "complete";
type ReviewAction = "keep" | "delete" | "defer";
type StatusFilter = "all" | "deployed" | "broken" | "orphaned";
type GenerateMode = "alt" | "long_desc" | "both";

type ImageItem = {
  id: string;
  content_item_id: string | null;
  canvas_url: string;
  canvas_file_id: string | null;
  image_file_name?: string | null;
  image_file_url?: string | null;
  existing_alt_text: string | null;
  edited_alt_text: string | null;
  effective_alt_text: string | null;
  alt_issue_code?: string | null;
  alt_issue_label?: string | null;
  long_description: string | null;
  is_decorative: boolean;
  review_action: ReviewAction;
  width: number | null;
  height: number | null;
  is_broken: boolean;
  updated_at: string;
  proxy_available?: boolean;
  preview_available?: boolean;
  content_title?: string | null;
  content_type?: string | null;
  content_canvas_url?: string | null;
  module_name?: string | null;
  content_is_orphaned?: boolean;
  deployment_label?: string;
  status_label?: StatusFilter;
  content_accessibility_applied?: boolean;
};

type ImagesResponse = {
  items: ImageItem[];
  total_count: number;
  limit: number;
  offset: number;
  next_offset: number | null;
  counts: {
    all: number;
    missing_alt: number;
    complete_alt: number;
  };
  status_counts: Record<StatusFilter, number>;
  warning?: string | null;
};

type DraftState = {
  edited_alt_text: string;
  long_description: string;
  is_decorative: boolean;
  review_action: ReviewAction;
};

type PreviewResponse = {
  id: string;
  title: string | null;
  content_type: string;
  canvas_url: string | null;
  canvas_base_url: string | null;
  canvas_course_url: string | null;
  module_name: string | null;
  html: string;
  plain_text: string;
};

type PreviewState = {
  image: ImageItem;
  content: PreviewResponse | null;
  loading: boolean;
  error: string | null;
};

type BulkGenerateResponse = {
  status?: string;
  job_id?: string;
  created?: boolean;
  requested_count: number;
  processed_count?: number;
  processed_image_ids?: string[];
  skipped_count?: number;
  skipped?: Array<{ image_id: string; detail: string }>;
  error_count?: number;
  errors?: Array<{ image_id: string; detail: string }>;
  apply_result?: BulkApplyResponse | null;
};

type GenerateImageResponse = Partial<ImageItem> & {
  status?: string;
  job_id?: string;
  created?: boolean;
  image_id?: string;
  message?: string;
};

type BulkApplyResponse = {
  counts: {
    requested: number;
    applied: number;
    skipped: number;
    errors: number;
  };
};

type ImageGenerateJobResult = {
  image_id?: string;
  mode?: GenerateMode;
  has_alt_text?: boolean;
  has_long_description?: boolean;
  apply_result?: BulkApplyResponse | null;
};

type BackgroundJobResponse = {
  id: string;
  status: "queued" | "running" | "retrying" | "succeeded" | "failed" | string;
  result?: BulkGenerateResponse | ImageGenerateJobResult | null;
  error_message?: string | null;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function previewDocument(data: PreviewResponse) {
  const baseSource = data.canvas_course_url || data.canvas_base_url;
  const baseHref = baseSource ? `${baseSource.replace(/\/$/, "")}/` : "";
  const baseTag = baseHref ? `<base href="${escapeAttribute(baseHref)}" target="_blank">` : "";
  const body = data.html || `<pre>${escapeHtml(data.plain_text || "No body content was saved for this item.")}</pre>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${baseTag}
  <style>
    :root { color: #0b1c30; background: #ffffff; font-family: Inter, Arial, sans-serif; }
    body { margin: 0; padding: 28px; line-height: 1.55; font-size: 15px; }
    h1, h2, h3, h4, h5, h6 { font-family: Manrope, Arial, sans-serif; line-height: 1.2; margin: 1.2em 0 0.45em; }
    h1 { font-size: 1.8rem; } h2 { font-size: 1.45rem; } h3 { font-size: 1.2rem; }
    p, ul, ol, table, blockquote, pre { margin: 0.75rem 0; }
    a { color: #8c1d40; text-decoration: underline; overflow-wrap: anywhere; }
    img, video, iframe, embed, object { max-width: 100%; }
    img { height: auto; }
    iframe { width: 100%; min-height: 320px; border: 1px solid #ddbfc3; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddbfc3; padding: 0.5rem; vertical-align: top; }
    th { background: #eff4ff; text-align: left; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #eff4ff; padding: 1rem; border-radius: 8px; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function normalizeStatusCounts(
  value: Partial<Record<StatusFilter, number>> | null | undefined,
): Record<StatusFilter, number> {
  return {
    all: value?.all ?? 0,
    deployed: value?.deployed ?? 0,
    broken: value?.broken ?? 0,
    orphaned: value?.orphaned ?? 0,
  };
}

function normalizeDraftValue(value: string | null | undefined) {
  return (value ?? "").trim();
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "error";
}) {
  const toneClass = tone === "error"
    ? "bg-error-container text-error"
    : tone === "success"
      ? "bg-secondary-container/30 text-on-secondary-container"
      : "bg-surface-container-lowest text-on-surface-variant";
  const valueClass = tone === "error" ? "text-error" : "text-on-surface";

  return (
    <Card className={toneClass}>
      <CardBody className="px-4 py-3">
        <div className="text-sm">{label}</div>
        <div className={`mt-1 font-headline text-2xl font-extrabold ${valueClass}`}>{value}</div>
      </CardBody>
    </Card>
  );
}

function imageHasTextForContent(draft: DraftState, image: ImageItem) {
  if (draft.is_decorative) return true;
  if (normalizeDraftValue(draft.edited_alt_text)) return true;
  return Boolean(normalizeDraftValue(image.existing_alt_text)) && !image.alt_issue_code;
}

function imageAccessibilityDraftChanged(draft: DraftState, image: ImageItem) {
  return normalizeDraftValue(draft.edited_alt_text) !== normalizeDraftValue(image.edited_alt_text) ||
    draft.is_decorative !== image.is_decorative;
}

function imageAccessibilityApplied(draft: DraftState, image: ImageItem) {
  return Boolean(image.content_accessibility_applied) && !imageAccessibilityDraftChanged(draft, image);
}

function imageHasSavedGeneratedAlt(image: ImageItem) {
  const editedAlt = normalizeDraftValue(image.edited_alt_text);
  return Boolean(editedAlt) && editedAlt !== normalizeDraftValue(image.existing_alt_text);
}

function displayImageUrl(value: string) {
  return value.replace(/\/download(?=([?#]|$))/, "/preview");
}

function canvasImagePageUrl(value: string) {
  return value.replace(/\/(preview|download)(?=([?#]|$))/, "");
}

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return body.detail ?? fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function summarizeBulkGenerateResult(label: string, result: BulkGenerateResponse) {
  const processedCount = result.processed_count ?? 0;
  const skippedCount = result.skipped_count ?? 0;
  const errorCount = result.error_count ?? 0;
  const decorativeSkipped = result.skipped?.filter((item) => item.detail.toLowerCase().includes("decorative")).length ?? 0;
  const existingSkipped = Math.max(0, skippedCount - decorativeSkipped);
  const firstError = result.errors?.[0]?.detail;

  let message = `${label} completed. Generated text for ${processedCount} image${processedCount === 1 ? "" : "s"}.`;
  if (decorativeSkipped) {
    message += ` ${decorativeSkipped} skipped because ${decorativeSkipped === 1 ? "it is" : "they are"} decorative.`;
  }
  if (existingSkipped) {
    message += ` ${existingSkipped} skipped because requested text already exists.`;
  }
  if (errorCount) {
    message += ` ${errorCount} error${errorCount === 1 ? "" : "s"}${firstError ? `: ${firstError}` : "."}`;
  }
  const appliedCount = result.apply_result?.counts.applied ?? 0;
  if (appliedCount) {
    message += ` Applied ${appliedCount} generated alt text update${appliedCount === 1 ? "" : "s"} to content.`;
  }
  return message;
}

export default function ImagesManager({ sessionId }: { sessionId: string }) {
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [draftAltFilter, setDraftAltFilter] = useState<AltFilter>("all");
  const [altFilter, setAltFilter] = useState<AltFilter>("all");
  const [draftStatusFilter, setDraftStatusFilter] = useState<StatusFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<ImageItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<ImagesResponse["counts"]>({ all: 0, missing_alt: 0, complete_alt: 0 });
  const [statusCounts, setStatusCounts] = useState<Record<StatusFilter, number>>(EMPTY_STATUS_COUNTS);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [openGenerateMenuId, setOpenGenerateMenuId] = useState<string | null>(null);
  const generateMenuRef = useRef<HTMLDivElement | null>(null);
  const imageCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const itemCountRef = useRef(0);

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const selectedCount = selectedIds.size;
  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));

  const getAccessToken = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return session.access_token;
  }, []);

  const restoreImagePosition = useCallback((imageId: string | undefined, fallbackScrollY: number) => {
    if (typeof window === "undefined") return;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const imageCard = imageId ? imageCardRefs.current[imageId] : null;
        if (imageCard?.isConnected) {
          imageCard.scrollIntoView({ block: "center" });
          return;
        }
        window.scrollTo({ top: fallbackScrollY });
      });
    });
  }, []);

  const loadImages = useCallback(async (options?: { focusImageId?: string; preserveMessage?: boolean }) => {
    const fallbackScrollY = typeof window === "undefined" ? 0 : window.scrollY;
    const showBlockingLoading = !options?.preserveMessage || itemCountRef.current === 0;
    if (showBlockingLoading) setLoading(true);
    if (!options?.preserveMessage) setMessage(null);

    try {
      const token = await getAccessToken();
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        alt: altFilter,
        status: statusFilter,
      });
      if (query.trim()) params.set("q", query.trim());

      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/images?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to load image inventory"));
      }

      const data = await res.json() as ImagesResponse;
      itemCountRef.current = data.items.length;
      setItems(data.items);
      setCounts(data.counts);
      setStatusCounts(normalizeStatusCounts(data.status_counts));
      setTotalCount(data.total_count);
      setWarning(data.warning ?? null);
      setSelectedIds(new Set());
      setDrafts((current) => {
        const next = { ...current };
        for (const item of data.items) {
          next[item.id] = {
            edited_alt_text: item.edited_alt_text ?? "",
            long_description: item.long_description ?? "",
            is_decorative: item.is_decorative,
            review_action: item.review_action ?? "keep",
          };
        }
        return next;
      });
      if (options?.focusImageId) {
        restoreImagePosition(options.focusImageId, fallbackScrollY);
      }
    } catch (error) {
      if (!options?.preserveMessage) {
        setItems([]);
        itemCountRef.current = 0;
        setCounts({ all: 0, missing_alt: 0, complete_alt: 0 });
        setStatusCounts(EMPTY_STATUS_COUNTS);
        setTotalCount(0);
        setWarning(null);
      }
      if (!options?.preserveMessage) {
        setMessage(error instanceof Error ? error.message : "Failed to load image inventory");
      }
    } finally {
      setLoading(false);
    }
  }, [altFilter, getAccessToken, offset, query, restoreImagePosition, sessionId, statusFilter]);

  const waitForImageBulkJob = useCallback(async (jobId: string): Promise<BulkGenerateResponse | null> => {
    const maxAttempts = 30;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await sleep(attempt < 3 ? 1500 : 2500);
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to refresh image generation job"));
      }
      const job = await res.json() as BackgroundJobResponse;
      if (job.status === "failed") {
        throw new Error(job.error_message || "Bulk image generation failed");
      }
      if (job.status === "succeeded") {
        return (job.result as BulkGenerateResponse | null) ?? null;
      }
    }
    return null;
  }, [getAccessToken]);

  const waitForImageJob = useCallback(async (jobId: string): Promise<ImageGenerateJobResult | null> => {
    const maxAttempts = 30;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await sleep(attempt < 3 ? 1500 : 2500);
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to refresh image generation job"));
      }
      const job = await res.json() as BackgroundJobResponse;
      if (job.status === "failed") {
        throw new Error(job.error_message || "Image generation failed");
      }
      if (job.status === "succeeded") {
        return (job.result as ImageGenerateJobResult | null) ?? null;
      }
    }
    return null;
  }, [getAccessToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadImages();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadImages]);

  useEffect(() => {
    if (!openGenerateMenuId) return;

    function handlePointerDown(event: MouseEvent) {
      if (!generateMenuRef.current) return;
      if (generateMenuRef.current.contains(event.target as Node)) return;
      setOpenGenerateMenuId(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenGenerateMenuId(null);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [openGenerateMenuId]);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );

  async function openPreview(image: ImageItem) {
    setPreview({ image, content: null, loading: Boolean(image.preview_available), error: null });
    if (!image.preview_available || !image.content_item_id) {
      return;
    }

    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${image.content_item_id}/preview`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to load content preview"));
      }

      const content = await res.json() as PreviewResponse;
      setPreview({ image, content, loading: false, error: null });
    } catch (error) {
      setPreview({
        image,
        content: null,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load content preview",
      });
    }
  }

  function updateDraft(imageId: string, patch: Partial<DraftState>) {
    setDrafts((current) => ({
      ...current,
      [imageId]: {
        ...current[imageId],
        ...patch,
      },
    }));
  }

  function applyItemUpdate(updated: ImageItem) {
    setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setDrafts((current) => ({
      ...current,
      [updated.id]: {
        edited_alt_text: updated.edited_alt_text ?? "",
        long_description: updated.long_description ?? "",
        is_decorative: updated.is_decorative,
        review_action: updated.review_action ?? "keep",
      },
    }));
  }

  async function loadImage(imageId: string): Promise<ImageItem> {
    const token = await getAccessToken();
    const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/images/${imageId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(await parseApiError(res, "Failed to load generated image text"));
    }
    return await res.json() as ImageItem;
  }

  async function saveImage(imageId: string): Promise<ImageItem | null> {
    const draft = drafts[imageId];
    if (!draft) return null;

    setSavingId(imageId);
    setMessage(null);

    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/images/${imageId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to save image changes"));
      }

      const updated = await res.json() as ImageItem;
      applyItemUpdate(updated);
      setMessage("Saved image changes.");
      return updated;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save image changes");
      return null;
    } finally {
      setSavingId(null);
    }
  }

  async function applyImageToContent(image: ImageItem) {
    const draft = drafts[image.id];
    const isDirty = draft
      ? normalizeDraftValue(draft.edited_alt_text) !== normalizeDraftValue(image.edited_alt_text) ||
        normalizeDraftValue(draft.long_description) !== normalizeDraftValue(image.long_description) ||
        draft.is_decorative !== image.is_decorative ||
        draft.review_action !== (image.review_action ?? "keep")
      : false;

    setApplyingId(image.id);
    setMessage(null);
    try {
      if (isDirty) {
        const saved = await saveImage(image.id);
        if (!saved) return;
      }

      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/images/${image.id}/apply-to-content`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to apply image text to content"));
      }
      const result = await res.json() as { matched_count: number; saved: boolean; revision_number: number | null };
      await loadImages({ focusImageId: image.id, preserveMessage: true });
      if (result.revision_number) {
        window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
      }
      setMessage(
        result.revision_number
          ? `Applied image text to content and created revision ${result.revision_number}.`
          : result.saved
            ? `Applied image text to ${result.matched_count} image tag${result.matched_count === 1 ? "" : "s"}.`
            : "Image accessibility text was already applied to content."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to apply image text to content");
    } finally {
      setApplyingId(null);
    }
  }

  async function saveImageRow(image: ImageItem) {
    const draft = drafts[image.id];
    if (!draft) return;
    if (
      imageHasTextForContent(draft, image) &&
      (imageAccessibilityDraftChanged(draft, image) || imageHasSavedGeneratedAlt(image))
    ) {
      await applyImageToContent(image);
      return;
    }
    await saveImage(image.id);
  }

  async function bulkApplyImagesToContent() {
    if (selectedIds.size === 0) return;

    const dirtySelected = items.filter((image) => {
      if (!selectedIds.has(image.id)) return false;
      const draft = drafts[image.id];
      if (!draft) return false;
      return normalizeDraftValue(draft.edited_alt_text) !== normalizeDraftValue(image.edited_alt_text) ||
        normalizeDraftValue(draft.long_description) !== normalizeDraftValue(image.long_description) ||
        draft.is_decorative !== image.is_decorative ||
        draft.review_action !== (image.review_action ?? "keep");
    });

    setBulkBusy("Apply selected");
    setMessage(null);
    try {
      for (const image of dirtySelected) {
        const saved = await saveImage(image.id);
        if (!saved) {
          throw new Error("Save selected image changes before applying them to content.");
        }
      }

      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/images/apply-to-content-bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ image_ids: Array.from(selectedIds) }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to apply selected images to content"));
      }

      const result = await res.json() as BulkApplyResponse;
      await loadImages({ focusImageId: selectedItems[0]?.id, preserveMessage: true });
      if (result.counts.applied > 0) {
        window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
      }
      setMessage(
        `Applied ${result.counts.applied} image${result.counts.applied === 1 ? "" : "s"} to content` +
        `${result.counts.skipped ? `, ${result.counts.skipped} skipped` : ""}` +
        `${result.counts.errors ? `, ${result.counts.errors} errors` : ""}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to apply selected images to content");
    } finally {
      setBulkBusy(null);
    }
  }

  async function bulkUpdate(patch: Partial<Pick<DraftState, "is_decorative" | "review_action">>, label: string) {
    if (selectedIds.size === 0) return;
    const selectedImageIds = Array.from(selectedIds);

    setBulkBusy(label);
    setMessage(null);

    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/images/bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          image_ids: selectedImageIds,
          ...patch,
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, `Failed to ${label.toLowerCase()}`));
      }

      let nextMessage = `${label} completed for ${selectedImageIds.length} images.`;
      if (patch.is_decorative === true) {
        const applyRes = await fetch(`${API_URL}/canvas/sessions/${sessionId}/images/apply-to-content-bulk`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ image_ids: selectedImageIds }),
        });
        if (!applyRes.ok) {
          throw new Error(await parseApiError(applyRes, "Failed to apply decorative image changes to content"));
        }
        const applyResult = await applyRes.json() as BulkApplyResponse;
        if (applyResult.counts.applied > 0) {
          window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
        }
        nextMessage =
          `${label} completed for ${selectedImageIds.length} images. ` +
          `Applied ${applyResult.counts.applied} to content` +
          `${applyResult.counts.skipped ? `, ${applyResult.counts.skipped} skipped` : ""}` +
          `${applyResult.counts.errors ? `, ${applyResult.counts.errors} errors` : ""}.`;
      }
      setMessage(nextMessage);
      await loadImages({ focusImageId: selectedImageIds[0], preserveMessage: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to ${label.toLowerCase()}`);
    } finally {
      setBulkBusy(null);
    }
  }

  async function generateForImage(imageId: string, mode: GenerateMode) {
    setGeneratingId(imageId);
    setOpenGenerateMenuId(null);
    setMessage(null);

    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/images/${imageId}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          mode,
          overwrite_existing: true,
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, `Failed to generate ${mode === "alt" ? "alt text" : "long description"}`));
      }

      const updated = await res.json() as GenerateImageResponse;
      if (updated.job_id) {
        setMessage(updated.created === false
          ? "AI image text is already queued for this image. Waiting for the worker to finish."
          : "AI image text queued. Waiting for the worker to finish.");
        const completedResult = await waitForImageJob(updated.job_id);
        if (!completedResult) {
          setMessage("AI image text is still running. The image list will refresh again shortly.");
          window.setTimeout(() => void loadImages({ focusImageId: imageId, preserveMessage: true }), 6000);
          window.setTimeout(() => void loadImages({ focusImageId: imageId, preserveMessage: true }), 30000);
          return;
        }
        const refreshed = await loadImage(completedResult.image_id || imageId);
        applyItemUpdate(refreshed);
        await loadImages({ focusImageId: refreshed.id, preserveMessage: true });
        const appliedCount = completedResult.apply_result?.counts.applied ?? 0;
        if (appliedCount > 0) {
          window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
        }
        setMessage(
          mode === "alt"
            ? `AI alt text generated and saved${appliedCount ? "; content was sent to Pending Review." : "."}`
            : mode === "long_desc"
              ? "AI long description generated and saved."
              : `AI alt text and long description generated and saved${appliedCount ? "; content was sent to Pending Review." : "."}`
        );
        return;
      }
      applyItemUpdate(updated as ImageItem);
      if (mode !== "long_desc") {
        await applyImageToContent(updated as ImageItem);
        return;
      }
      setMessage("AI long description generated and saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to generate AI image text");
    } finally {
      setGeneratingId(null);
    }
  }

  async function bulkGenerate(mode: GenerateMode) {
    if (selectedIds.size === 0) return;

    const label = mode === "alt" ? "Generate alt text" : mode === "long_desc" ? "Generate long descriptions" : "Generate alt text and long descriptions";
    const selectedImageIds = Array.from(selectedIds);
    setBulkBusy(label);
    setMessage(null);

    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/images/generate-bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          image_ids: selectedImageIds,
          mode,
          overwrite_existing: false,
          skip_decorative: true,
        }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, `Failed to ${label.toLowerCase()}`));
      }

      const result = await res.json() as BulkGenerateResponse;
      if (result.status === "queued" || result.status === "retrying" || result.status === "running") {
        setMessage(
          result.created === false
            ? `${label} is already queued for this selection. Updates will appear as the worker finishes.`
            : `${label} queued for ${result.requested_count} image${result.requested_count === 1 ? "" : "s"}. You can keep working while the worker generates and saves the text.`
        );
        if (result.job_id) {
          const completedResult = await waitForImageBulkJob(result.job_id);
          if (completedResult) {
            setMessage(summarizeBulkGenerateResult(label, completedResult));
            if ((completedResult.apply_result?.counts.applied ?? 0) > 0) {
              window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
            }
            await loadImages({
              focusImageId: completedResult.processed_image_ids?.[0] ?? selectedImageIds[0],
              preserveMessage: true,
            });
            return;
          }
        }
        setMessage(`${label} is still running. The image list will refresh again shortly.`);
        window.setTimeout(() => void loadImages({ focusImageId: selectedImageIds[0], preserveMessage: true }), 6000);
        window.setTimeout(() => void loadImages({ focusImageId: selectedImageIds[0], preserveMessage: true }), 30000);
        return;
      }

      let nextMessage = summarizeBulkGenerateResult(label, result);
      const processedImageIds = result.processed_image_ids ?? [];
      if (mode !== "long_desc" && processedImageIds.length) {
        const applyRes = await fetch(`${API_URL}/canvas/sessions/${sessionId}/images/apply-to-content-bulk`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ image_ids: processedImageIds }),
        });
        if (!applyRes.ok) {
          throw new Error(await parseApiError(applyRes, "Failed to apply generated alt text to content"));
        }
        const applyResult = await applyRes.json() as BulkApplyResponse;
        nextMessage +=
          ` Applied ${applyResult.counts.applied} generated alt text update${applyResult.counts.applied === 1 ? "" : "s"} to content` +
          `${applyResult.counts.skipped ? `, ${applyResult.counts.skipped} skipped` : ""}` +
          `${applyResult.counts.errors ? `, ${applyResult.counts.errors} errors` : ""}.`;
        if (applyResult.counts.applied > 0) {
          window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
        }
      }
      setMessage(nextMessage);
      await loadImages({ focusImageId: processedImageIds[0], preserveMessage: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to ${label.toLowerCase()}`);
    } finally {
      setBulkBusy(null);
    }
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
            <span className="text-on-surface font-semibold">Images</span>
          </nav>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface tracking-tight">
            Image Inventory
          </h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Manage keep/remove decisions, decorative state, alt text, and long descriptions, with AI generation available for image descriptions.
          </p>
          <p className="mt-1 text-xs text-on-surface-variant">
            AI generation saves directly. Manual text edits still require Save.
          </p>
        </div>
        <SyncCourseButton sessionId={sessionId} variant="secondary" />
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <StatCard label="Images" value={counts.all} />
        <StatCard label="Needs Alt Review" value={counts.missing_alt} tone="error" />
        <StatCard label="Resolved or Decorative" value={counts.complete_alt} tone="success" />
      </div>

      <form
        className="rounded-3xl bg-surface-container-low p-4 shadow-sm flex flex-col gap-3 lg:flex-row lg:items-center"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setQuery(draftQuery);
          setAltFilter(draftAltFilter);
          setStatusFilter(draftStatusFilter);
        }}
      >
        <SearchInput
          value={draftQuery}
          onChange={setDraftQuery}
          placeholder="Search URLs, alt text, or descriptions"
          debounceMs={0}
          className="flex-1"
        />
        <select
          value={draftAltFilter}
          onChange={(event) => setDraftAltFilter(event.target.value as AltFilter)}
          className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary"
        >
          <option value="all">All alt states</option>
          <option value="missing">Needs alt review</option>
          <option value="complete">Resolved or decorative</option>
        </select>
        <select
          value={draftStatusFilter}
          onChange={(event) => setDraftStatusFilter(event.target.value as StatusFilter)}
          className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary"
        >
          <option value="all">All image states</option>
          <option value="deployed">Deployed</option>
          <option value="broken">Broken</option>
          <option value="orphaned">Orphaned</option>
        </select>
        <Button
          type="submit"
        >
          Apply
        </Button>
      </form>

      {message ? (
        <Alert variant="info">
          {message}
        </Alert>
      ) : null}
      {warning ? (
        <Alert variant="error">
          {warning}
        </Alert>
      ) : null}
      {statusFilter === "broken" && statusCounts.broken > 0 ? (
        <Alert variant="error">
          {statusCounts.broken} images could not be loaded. These may have been deleted or belong to an inaccessible course. Click Preview to see the page in context, then compare with a past version to identify what should be there.
        </Alert>
      ) : null}
      {statusFilter === "orphaned" && statusCounts.orphaned > 0 ? (
        <Alert variant="warning">
          {statusCounts.orphaned} images found in content not assigned to any module. These are automatically marked for removal. Click Keep on any image you want to preserve.
        </Alert>
      ) : null}

      {selectedCount === 0 ? (
        <Card>
          <CardBody className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
          <Button
            type="button"
            onClick={() => {
              setSelectedIds(new Set(items.map((item) => item.id)));
            }}
            variant="ghost"
            disabled={!items.length}
            icon={<Square size={16} />}
          >
            Select visible images
          </Button>
          <p className="text-xs text-on-surface-variant">
            Select the images shown here to apply review, decorative-state, generation, or content-update actions.
          </p>
          </CardBody>
        </Card>
      ) : (
        <BulkActionBar
          selectedCount={selectedCount}
          totalCount={items.length}
          allSelected={allSelected}
          noun="image"
          placement="fixed"
          onClearSelection={() => setSelectedIds(new Set())}
          onSelectAll={() => setSelectedIds(new Set(items.map((item) => item.id)))}
          actions={[
            {
              label: "Apply Selected",
              onClick: () => void bulkApplyImagesToContent(),
              disabled: bulkBusy !== null,
              loading: bulkBusy === "Apply selected",
            },
            {
              label: "Keep Selected",
              onClick: () => void bulkUpdate({ review_action: "keep" }, "Marked keep"),
              disabled: bulkBusy !== null,
              loading: bulkBusy === "Marked keep",
            },
            {
              label: "Remove Selected",
              variant: "destructive",
              onClick: () => void bulkUpdate({ review_action: "delete" }, "Marked remove"),
              disabled: bulkBusy !== null,
              loading: bulkBusy === "Marked remove",
            },
            {
              label: "Mark Decorative",
              onClick: () => void bulkUpdate({ is_decorative: true }, "Marked decorative"),
              disabled: bulkBusy !== null,
              loading: bulkBusy === "Marked decorative",
            },
            {
              label: "Clear Decorative",
              onClick: () => void bulkUpdate({ is_decorative: false }, "Cleared decorative"),
              disabled: bulkBusy !== null,
              loading: bulkBusy === "Cleared decorative",
            },
            {
              label: "Generate Alt Text",
              onClick: () => void bulkGenerate("alt"),
              disabled: bulkBusy !== null,
              loading: bulkBusy === "Generate alt text",
            },
            {
              label: "Generate Long Desc",
              onClick: () => void bulkGenerate("long_desc"),
              disabled: bulkBusy !== null,
              loading: bulkBusy === "Generate long descriptions",
            },
          ]}
        />
      )}

      {loading ? (
        <CardSkeleton lines={4} className="rounded-3xl" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title="No images matched this view"
            description="Adjust the filters or re-sync the course to refresh extracted image references."
            size="lg"
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((image, index) => {
            const draft = drafts[image.id] ?? {
              edited_alt_text: image.edited_alt_text ?? "",
              long_description: image.long_description ?? "",
              is_decorative: image.is_decorative,
              review_action: image.review_action ?? "keep",
            };
            const isDirty =
              normalizeDraftValue(draft.edited_alt_text) !== normalizeDraftValue(image.edited_alt_text) ||
              normalizeDraftValue(draft.long_description) !== normalizeDraftValue(image.long_description) ||
              draft.is_decorative !== image.is_decorative ||
              draft.review_action !== (image.review_action ?? "keep");
            const hasSavedGeneratedAlt = imageHasSavedGeneratedAlt(image);
            const accessibilityApplied = imageAccessibilityApplied(draft, image);
            const canSaveRow = isDirty || hasSavedGeneratedAlt;

            return (
              <article
                key={image.id}
                ref={(node) => {
                  imageCardRefs.current[image.id] = node;
                }}
                className="rounded-3xl bg-surface-container-lowest p-5 shadow-sm border border-outline-variant/40"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          if (next.has(image.id)) next.delete(image.id);
                          else next.add(image.id);
                          return next;
                        });
                      }}
                    className="inline-flex h-9 items-center gap-2 rounded-xl bg-surface-container-low px-3 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
                    aria-pressed={selectedIds.has(image.id)}
                  >
                    {selectedIds.has(image.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                    Select
                  </button>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    draft.review_action === "delete"
                      ? "bg-error-container text-error"
                      : draft.review_action === "defer"
                        ? "bg-surface-container-high text-on-surface"
                        : "bg-[#78be20]/15 text-[#446D12]"
                  }`}>
                    {draft.review_action === "delete" ? "Remove" : draft.review_action === "defer" ? "Defer" : "Keep"}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => void openPreview(image)}
                  className="mb-4 block w-full overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-low aspect-[4/3] relative"
                >
                  {image.proxy_available ? (
                    <Image
                      src={`/api/session-images/${sessionId}/${image.id}?variant=thumb`}
                      alt={image.effective_alt_text || image.existing_alt_text || "Course image preview"}
                      fill
                      unoptimized
                      priority={index < 3}
                      loading={index < 3 ? "eager" : "lazy"}
                      sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                      className="object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-on-surface-variant">
                      Thumbnail proxy will appear after the image inventory is persisted.
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-2 text-left text-xs font-semibold text-white">
                    Click to preview
                  </div>
                </button>

                <div className="space-y-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-on-surface-variant">
                      {image.image_file_name || (image.canvas_file_id ? `Canvas file ${image.canvas_file_id}` : "Extracted image")}
                    </p>
                    <p className="mt-2 text-sm text-on-surface break-all">{displayImageUrl(image.canvas_url)}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        image.status_label === "broken"
                          ? "bg-error-container text-error"
                          : image.status_label === "orphaned"
                            ? "bg-secondary-container/30 text-on-secondary-container"
                            : "bg-primary/10 text-primary"
                      }`}>
                        {image.status_label === "broken"
                          ? "Broken"
                          : image.status_label === "orphaned"
                            ? "Orphaned"
                            : "Deployed"}
                      </span>
                      <span className="rounded-full bg-surface-container-high px-3 py-1 text-xs font-semibold text-on-surface">
                        {image.deployment_label || "Content"}
                      </span>
                      {image.module_name ? (
                        <span className="rounded-full bg-surface-container-high px-3 py-1 text-xs font-semibold text-on-surface">
                          {image.module_name}
                        </span>
                      ) : null}
                      {image.alt_issue_label ? (
                        <span className="rounded-full bg-error-container px-3 py-1 text-xs font-semibold text-error">
                          {image.alt_issue_label}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm text-on-surface">
                      <span className="mb-1 block font-semibold">Review</span>
                      <select
                        value={draft.review_action}
                        onChange={(event) => updateDraft(image.id, { review_action: event.target.value as ReviewAction })}
                        className="w-full rounded-xl border border-outline-variant/60 bg-surface-container-low px-3 py-2 text-sm outline-none focus:border-primary"
                      >
                        <option value="keep">Keep</option>
                        <option value="delete">Remove</option>
                        <option value="defer">Defer</option>
                      </select>
                    </label>

                    <label className="self-end flex h-10 items-center gap-3 rounded-xl bg-surface-container-low px-4 text-sm font-medium text-on-surface">
                      <input
                        type="checkbox"
                        checked={draft.is_decorative}
                        onChange={(event) => updateDraft(image.id, { is_decorative: event.target.checked })}
                      />
                      Decorative
                    </label>
                  </div>

                  <label className="block text-sm text-on-surface">
                    <span className="mb-1 block font-semibold">Alt Text</span>
                    <textarea
                      value={draft.edited_alt_text}
                      disabled={draft.is_decorative}
                      onChange={(event) => updateDraft(image.id, { edited_alt_text: event.target.value })}
                      rows={3}
                      placeholder={draft.is_decorative ? "Decorative images do not need alt text." : (image.alt_issue_label ? `${image.alt_issue_label}: write replacement alt text` : (image.existing_alt_text || "Write alt text"))}
                      className="w-full rounded-2xl border border-outline-variant/60 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none focus:border-primary disabled:opacity-60"
                    />
                    {image.alt_issue_label && !draft.is_decorative ? (
                      <span className="mt-1 block text-xs text-error">
                        {image.alt_issue_label}. Generate or write descriptive alt text before applying.
                      </span>
                    ) : null}
                  </label>

                  <label className="block text-sm text-on-surface">
                    <span className="mb-1 block font-semibold">Long Description</span>
                    <textarea
                      value={draft.long_description}
                      onChange={(event) => updateDraft(image.id, { long_description: event.target.value })}
                      rows={4}
                      placeholder="Add a long description for complex images."
                      className="w-full rounded-2xl border border-outline-variant/60 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none focus:border-primary"
                    />
                  </label>

                  <div className="flex items-center justify-between text-xs text-on-surface-variant">
                    <span>
                      {image.width && image.height ? `${image.width} × ${image.height}` : "Dimensions not captured yet"}
                    </span>
                    <span>Updated {formatDate(image.updated_at)}</span>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        onClick={() => void openPreview(image)}
                        variant="ghost"
                      >
                        Preview
                      </Button>
                      {image.content_canvas_url ? (
                        <ButtonLink
                          href={image.content_canvas_url}
                          target="_blank"
                          variant="ghost"
                        >
                          Open in Canvas
                        </ButtonLink>
                      ) : null}
                      <div
                        ref={openGenerateMenuId === image.id ? generateMenuRef : null}
                        className="relative"
                      >
                        <Button
                          type="button"
                          disabled={draft.is_decorative || generatingId === image.id}
                          onClick={() => setOpenGenerateMenuId((current) => (current === image.id ? null : image.id))}
                          variant="ghost"
                          loading={generatingId === image.id}
                        >
                          {generatingId === image.id ? "Generating…" : "AI Generation"}
                        </Button>
                        {openGenerateMenuId === image.id ? (
                          <div className="absolute left-0 top-full z-10 mt-2 min-w-40 rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-2 shadow-lg">
                            <button
                              type="button"
                              onClick={() => void generateForImage(image.id, "alt")}
                              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-on-surface hover:bg-surface-container-low"
                            >
                              Alt Text
                            </button>
                            <button
                              type="button"
                              onClick={() => void generateForImage(image.id, "long_desc")}
                              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-on-surface hover:bg-surface-container-low"
                            >
                              Long Description
                            </button>
                            <button
                              type="button"
                              onClick={() => void generateForImage(image.id, "both")}
                              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-on-surface hover:bg-surface-container-low"
                            >
                              Both
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      type="button"
                      disabled={!canSaveRow || savingId === image.id || generatingId === image.id || applyingId === image.id}
                      onClick={() => void saveImageRow(image)}
                      loading={savingId === image.id || applyingId === image.id || generatingId === image.id}
                    >
                      {savingId === image.id || applyingId === image.id
                        ? "Saving…"
                        : generatingId === image.id
                          ? "Generating…"
                          : accessibilityApplied && !isDirty
                            ? "Saved"
                            : "Save"}
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="rounded-2xl bg-surface-container-low px-4 py-3">
        <Pagination
          page={Math.min(currentPage, totalPages)}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={(page) => setOffset((page - 1) * PAGE_SIZE)}
        />
        {selectedItems.length ? (
          <p className="mt-2 text-xs text-on-surface-variant">{selectedItems.length} selected on this page</p>
        ) : null}
      </div>

      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6" role="dialog" aria-modal="true">
          <div className="w-full max-w-6xl max-h-[92vh] overflow-hidden rounded-xl bg-surface-container-lowest shadow-2xl border border-outline-variant/40">
            <div className="px-5 py-4 bg-surface-container-low flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
                  Image Preview
                </p>
                <h3 className="font-headline text-xl font-bold text-on-surface truncate mt-1">
                  {preview.image.content_title || preview.image.image_file_name || preview.image.canvas_file_id || "Course image"}
                </h3>
                <p className="text-xs text-on-surface-variant mt-1">
                  {preview.image.deployment_label || "Image"}
                  {preview.image.module_name ? ` · ${preview.image.module_name}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={canvasImagePageUrl(preview.image.canvas_url)}
                  target="_blank"
                  className="px-3 py-2 rounded-lg border border-outline-variant/40 text-xs font-bold text-primary hover:bg-surface-container-lowest transition-colors"
                >
                  Open in Canvas
                </Link>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="w-9 h-9 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                  aria-label="Close preview"
                  title="Close"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="grid gap-3 bg-surface-container-low p-3 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/30 overflow-hidden min-h-[32rem] relative">
                {preview.image.proxy_available ? (
                  <Image
                    src={`/api/session-images/${sessionId}/${preview.image.id}?variant=original`}
                    alt={preview.image.effective_alt_text || preview.image.existing_alt_text || "Course image preview"}
                    fill
                    unoptimized
                    sizes="50vw"
                    className="object-contain bg-surface"
                  />
                ) : (
                  <div className="h-[32rem] flex items-center justify-center px-5 text-sm text-on-surface-variant text-center">
                    The proxied image is not available yet.
                  </div>
                )}
              </div>
              <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/30 overflow-hidden">
                {preview.image.preview_available ? (
                  preview.loading ? (
                    <div className="h-[32rem] flex items-center justify-center text-sm text-on-surface-variant">
                      Loading content preview...
                    </div>
                  ) : preview.error ? (
                    <div className="h-[32rem] flex items-center justify-center px-5 text-sm text-on-surface-variant text-center">
                      {preview.error}
                    </div>
                  ) : preview.content ? (
                    <iframe
                      title={`Preview ${preview.content.title ?? "content"}`}
                      srcDoc={previewDocument(preview.content)}
                      sandbox="allow-popups allow-popups-to-escape-sandbox allow-forms"
                      className="w-full h-[32rem] bg-white"
                    />
                  ) : null
                ) : (
                  <div className="h-[32rem] flex items-center justify-center px-5 text-sm text-on-surface-variant text-center">
                    This image is not currently attached to previewable course content.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
