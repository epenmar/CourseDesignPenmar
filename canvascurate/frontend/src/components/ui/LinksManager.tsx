"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckSquare, Link2, Sparkles, Square } from "lucide-react";

import Alert from "@/components/edplus/Alert";
import BulkActionBar from "@/components/edplus/BulkActionBar";
import Button, { ButtonLink } from "@/components/edplus/Button";
import Card, { CardBody } from "@/components/edplus/Card";
import EmptyState from "@/components/edplus/EmptyState";
import Pagination from "@/components/edplus/Pagination";
import SearchInput from "@/components/edplus/SearchInput";
import { CardSkeleton } from "@/components/edplus/Skeleton";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";
const PAGE_SIZE = 50;
const LINK_CONTEXT_STYLES = `
  .cc-link-context {
    font-size: 0.875rem;
    line-height: 1.55;
    color: rgb(var(--color-on-surface, 29 27 32));
    word-break: break-word;
  }
  .cc-link-context h1,
  .cc-link-context h2,
  .cc-link-context h3,
  .cc-link-context h4,
  .cc-link-context h5,
  .cc-link-context h6 {
    margin: 0 0 0.35rem;
    font-weight: 700;
  }
  .cc-link-context p,
  .cc-link-context ul,
  .cc-link-context ol {
    margin: 0.35rem 0;
  }
  .cc-link-context ul,
  .cc-link-context ol {
    padding-left: 1.25rem;
  }
  .cc-link-context ul { list-style: disc; }
  .cc-link-context ol { list-style: decimal; }
  .cc-link-context a {
    color: rgb(var(--color-primary, 103 80 164));
    text-decoration: underline;
    pointer-events: none;
  }
  .cc-link-context img,
  .cc-link-context iframe {
    max-width: 100%;
    max-height: 5rem;
  }
  .cc-link-context mark.cc-link-highlight {
    background: rgb(254 243 199);
    border: 1px solid rgb(245 158 11);
    border-radius: 0.25rem;
    padding: 0 0.15rem;
  }
  .cc-link-context ::selection,
  .cc-link-context::selection {
    background: rgb(191 219 254);
    color: rgb(17 24 39);
  }
`;

type StatusFilter = "all" | "flagged" | "good";

type LinkRow = {
  content_item_id: string;
  content_title: string | null;
  content_type: string;
  content_canvas_url: string | null;
  module_name: string | null;
  link_index: number;
  href: string;
  text: string | null;
  accessible_name: string | null;
  link_kind: "text" | "image";
  issue_code: string | null;
  is_flagged: boolean;
  surrounding_text: string | null;
  original_text: string | null;
  original_before: string | null;
  original_after: string | null;
  original_context: string | null;
  suggested_text: string | null;
  html_context: string | null;
};

type LinksResponse = {
  items: LinkRow[];
  total_count: number;
  next_offset: number | null;
  counts: {
    all: number;
    flagged: number;
    good: number;
  };
};

type BulkSuggestionResponse = {
  status?: string;
  job_id?: string;
  created?: boolean;
  requested_count?: number;
  result?: BulkSuggestionResult | null;
  message?: string;
};

type BulkSuggestionResult = {
  requested_count?: number;
  processed_count?: number;
  suggestion_count?: number;
  error_count?: number;
  message?: string;
  suggestions: Array<{
    content_item_id: string;
    link_index: number;
    href: string;
    suggested_text: string;
  }>;
  errors: Array<{
    content_item_id: string;
    link_index: number;
    href: string;
    detail: string;
  }>;
};

type BackgroundJobResponse = {
  id: string;
  job_type: string;
  status: string;
  result?: BulkSuggestionResult | null;
  error_message?: string | null;
};

type BulkApplyResponse = {
  applied: Array<{
    content_item_id: string;
    link_index: number;
    href: string;
    replacement_text: string;
  }>;
  errors: Array<{
    content_item_id: string;
    link_index: number;
    href: string;
    detail: string;
  }>;
  revisions: Array<{
    content_item_id: string;
    saved: boolean;
    revision_number: number | null;
    applied_count: number;
  }>;
};

function issueLabel(issueCode: string | null) {
  if (!issueCode) return "Clear";
  return issueCode.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function issueTone(isFlagged: boolean) {
  return isFlagged
    ? "border-error/30 bg-error-container text-error"
    : "border-secondary/30 bg-secondary-container/30 text-on-secondary-container";
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

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return body.detail ?? fallback;
}

function activeJobStatus(status?: string | null) {
  return status === "queued" || status === "running" || status === "retrying";
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function LinkContextPreview({
  item,
  selectedContext,
  onUseContext,
  onMakeLinkText,
}: {
  item: LinkRow;
  selectedContext: string;
  onUseContext: (value: string) => void;
  onMakeLinkText: (value: string) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const selectedRangeRef = useRef<Range | null>(null);
  const [selectionAction, setSelectionAction] = useState<{ text: string; top: number; left: number } | null>(null);
  const [highlightRects, setHighlightRects] = useState<Array<{ top: number; left: number; width: number; height: number }>>([]);

  const rectsForRange = useCallback((range: Range) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return [];
    const wrapperRect = wrapper.getBoundingClientRect();
    return Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        top: rect.top - wrapperRect.top,
        left: rect.left - wrapperRect.left,
        width: rect.width,
        height: rect.height,
      }));
  }, []);

  const captureSelection = useCallback(() => {
    const selection = window.getSelection();
    const preview = previewRef.current;
    const wrapper = wrapperRef.current;
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !preview || !wrapper || !selection.anchorNode || !selection.focusNode) {
      selectedRangeRef.current = null;
      setSelectionAction(null);
      return;
    }
    if (!preview.contains(selection.anchorNode) || !preview.contains(selection.focusNode)) {
      selectedRangeRef.current = null;
      setSelectionAction(null);
      return;
    }
    const text = selection.toString().replace(/\s+/g, " ").trim();
    if (!text) {
      selectedRangeRef.current = null;
      setSelectionAction(null);
      return;
    }
    const range = selection.getRangeAt(0);
    selectedRangeRef.current = range.cloneRange();
    setHighlightRects(rectsForRange(range));
    const rect = range.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    setSelectionAction({
      text,
      top: rect.bottom - wrapperRect.top + 8,
      left: Math.max(0, rect.left - wrapperRect.left),
    });
  }, [rectsForRange]);

  const clearBrowserSelection = (clearHighlight = false) => {
    selectedRangeRef.current = null;
    window.getSelection()?.removeAllRanges();
    setSelectionAction(null);
    if (clearHighlight) setHighlightRects([]);
  };

  useLayoutEffect(() => {
    if (!selectionAction || !selectedRangeRef.current) return;
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(selectedRangeRef.current);
  }, [selectionAction]);

  useEffect(() => {
    if (selectedContext) return;
    const timer = window.setTimeout(() => setHighlightRects([]), 0);
    return () => window.clearTimeout(timer);
  }, [selectedContext]);

  const fallbackContext = item.original_context || item.surrounding_text || "No surrounding page context was captured for this link.";

  return (
    <div ref={wrapperRef} className="relative">
      {highlightRects.map((rect, index) => (
        <div
          key={`${index}-${rect.top}-${rect.left}`}
          className="pointer-events-none absolute z-10 rounded-sm bg-blue-200/75 ring-1 ring-blue-300/70"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}
      <div
        ref={previewRef}
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
        className="max-h-52 overflow-auto rounded-xl bg-surface-container-lowest px-3 py-2"
      >
        {item.html_context ? (
          <div className="cc-link-context" dangerouslySetInnerHTML={{ __html: item.html_context }} />
        ) : (
          <p className="text-sm leading-relaxed text-on-surface-variant">{fallbackContext}</p>
        )}
      </div>
      {selectionAction ? (
        <div
          className="absolute z-20 flex flex-wrap gap-1 rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-1 shadow-lg"
          style={{ top: selectionAction.top, left: selectionAction.left }}
        >
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              onUseContext(selectionAction.text);
              clearBrowserSelection();
            }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary-container/40"
          >
            <Sparkles size={12} />
            Use for AI
          </button>
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              onMakeLinkText(selectionAction.text);
              clearBrowserSelection();
            }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary-container/40"
          >
            <Link2 size={12} />
            Make link text
          </button>
        </div>
      ) : null}
      {selectedContext ? (
        <div className="mt-2 flex items-start justify-between gap-3 rounded-xl border border-primary/20 bg-primary-container/10 px-3 py-2 text-xs text-on-surface-variant">
          <span className="line-clamp-2">
            <span className="font-semibold text-primary">AI context:</span> {selectedContext}
          </span>
          <button
            type="button"
            onClick={() => {
              clearBrowserSelection(true);
              onUseContext("");
            }}
            className="shrink-0 font-semibold text-primary hover:underline"
          >
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function LinksManager({ sessionId }: { sessionId: string }) {
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [draftStatus, setDraftStatus] = useState<StatusFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<LinkRow[]>([]);
  const [counts, setCounts] = useState<LinksResponse["counts"]>({ all: 0, flagged: 0, good: 0 });
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, string>>({});
  const [selectedContexts, setSelectedContexts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<"suggest" | "apply" | null>(null);

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const eligibleItems = items.filter((item) => item.is_flagged && item.link_kind !== "image");
  const selectedItems = items.filter((item) => selected[linkKey(item)] && item.link_kind !== "image");
  const selectedWithSuggestions = selectedItems.filter((item) => suggestions[linkKey(item)]?.trim());
  const selectedCount = selectedItems.length;
  const allEligibleSelected = eligibleItems.length > 0 && eligibleItems.every((item) => selected[linkKey(item)]);

  const getAccessToken = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return session.access_token;
  }, []);

  const loadLinks = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        status,
      });
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/links?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to load links"));
      const data = await res.json() as LinksResponse;
      setItems(data.items);
      setCounts(data.counts);
      setTotalCount(data.total_count);
    } catch (error) {
      setItems([]);
      setCounts({ all: 0, flagged: 0, good: 0 });
      setTotalCount(0);
      setMessage(error instanceof Error ? error.message : "Failed to load links");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, offset, query, sessionId, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLinks();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadLinks]);

  function linkKey(item: LinkRow) {
    return `${item.content_item_id}:${item.link_index}:${item.href}`;
  }

  function linkSuggestionPayload(item: LinkRow) {
    return {
      content_item_id: item.content_item_id,
      link_index: item.link_index,
      href: item.href,
      text: item.text,
      before_text: item.original_before || undefined,
      after_text: item.original_after || undefined,
      html_context: item.html_context || undefined,
    };
  }

  function setCurrentPageFlaggedSelected(nextValue: boolean) {
    setSelected((current) => {
      const next = { ...current };
      for (const item of eligibleItems) {
        next[linkKey(item)] = nextValue;
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected({});
  }

  function applySuggestionResult(data: BulkSuggestionResult) {
    setSuggestions((current) => {
      const next = { ...current };
      for (const suggestion of data.suggestions ?? []) {
        next[`${suggestion.content_item_id}:${suggestion.link_index}:${suggestion.href}`] = suggestion.suggested_text;
      }
      return next;
    });
    const generated = data.suggestions?.length ?? data.suggestion_count ?? 0;
    const failed = data.errors?.length ?? data.error_count ?? 0;
    setMessage(failed ? `Generated ${generated} suggestions. ${failed} links need manual review.` : `Generated ${generated} suggestions.`);
  }

  async function pollBulkSuggestionJob(token: string, jobId: string) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const res = await fetch(`${API_URL}/canvas/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to refresh link suggestion job"));
      const job = await res.json() as BackgroundJobResponse;
      const result = job.result;

      if (job.status === "succeeded" && result) {
        applySuggestionResult(result);
        return;
      }
      if (job.status === "failed" || job.status === "cancelled") {
        throw new Error(job.error_message || "Link suggestion job failed");
      }

      const requested = result?.requested_count ?? selectedItems.length;
      const processed = result?.processed_count ?? 0;
      setMessage(result?.message ?? `Generating link text suggestions. ${processed} of ${requested} links processed.`);
      await wait(2500);
    }
    setMessage("Link text suggestions are still processing. You can refresh this page in a moment to check again.");
  }

  async function bulkSuggestText() {
    const links = selectedItems;
    if (links.length === 0) return;
    setBulkBusy("suggest");
    setMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/links/suggest-text/bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          links: links.map((item) => ({
            ...linkSuggestionPayload(item),
            content_item_id: item.content_item_id,
            link_index: item.link_index,
            href: item.href,
            text: item.text,
            selected_context: selectedContexts[linkKey(item)] || undefined,
          })),
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to generate link text suggestions"));
      const data = await res.json() as BulkSuggestionResponse;
      if (data.result?.suggestions?.length || data.result?.errors?.length) {
        applySuggestionResult(data.result);
      } else if (data.job_id && activeJobStatus(data.status)) {
        setMessage(
          data.created === false
            ? `Link text suggestions are already queued for ${data.requested_count ?? links.length} links.`
            : `Queued link text suggestions for ${data.requested_count ?? links.length} links.`
        );
        await pollBulkSuggestionJob(token, data.job_id);
      } else {
        setMessage(data.message ?? "Link text suggestions queued.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to generate link text suggestions");
    } finally {
      setBulkBusy(null);
    }
  }

  async function bulkApplyText() {
    const links = selectedWithSuggestions;
    if (links.length === 0) return;
    setBulkBusy("apply");
    setMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/links/apply-text/bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          links: links.map((item) => ({
            content_item_id: item.content_item_id,
            link_index: item.link_index,
            href: item.href,
            text: item.text,
            replacement_text: suggestions[linkKey(item)]?.trim(),
          })),
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to send link text suggestions to review"));
      const data = await res.json() as BulkApplyResponse;
      const appliedKeys = new Set(data.applied.map((item) => `${item.content_item_id}:${item.link_index}:${item.href}`));
      setSuggestions((current) => {
        const next = { ...current };
        for (const key of appliedKeys) {
          delete next[key];
        }
        return next;
      });
      setSelectedContexts((current) => {
        const next = { ...current };
        for (const key of appliedKeys) {
          delete next[key];
        }
        return next;
      });
      setSelected((current) => {
        const next = { ...current };
        for (const key of appliedKeys) {
          delete next[key];
        }
        return next;
      });
      const applied = data.applied.length;
      const revisions = data.revisions.filter((revision) => revision.saved).length;
      const failed = data.errors.length;
      setItems((current) => {
        const replacementByKey = new Map(
          data.applied.map((item) => [
            `${item.content_item_id}:${item.link_index}:${item.href}`,
            item.replacement_text,
          ])
        );
        const nextItems = current.map((item) => {
          const replacement = replacementByKey.get(linkKey(item));
          if (!replacement) return item;
          return {
            ...item,
            text: replacement,
            accessible_name: replacement,
            issue_code: null,
            is_flagged: false,
          };
        });
        return status === "flagged" ? nextItems.filter((item) => item.is_flagged) : nextItems;
      });
      if (applied > 0) {
        setCounts((current) => {
          if (status === "flagged") {
            return {
              all: Math.max(0, current.all - applied),
              flagged: Math.max(0, current.flagged - applied),
              good: current.good,
            };
          }
          return {
            all: current.all,
            flagged: Math.max(0, current.flagged - applied),
            good: current.good + applied,
          };
        });
        if (status === "flagged") {
          setTotalCount((current) => Math.max(0, current - applied));
        }
      }
      if (revisions > 0) {
        window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
      }
      setMessage(failed ? `Sent ${applied} link updates to Pending Review across ${revisions} revisions. ${failed} links were not applied.` : `Sent ${applied} link updates to Pending Review across ${revisions} revisions.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to send link text suggestions to review");
    } finally {
      setBulkBusy(null);
    }
  }

  async function suggestText(item: LinkRow) {
    const key = linkKey(item);
    setBusyKey(key);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/links/suggest-text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...linkSuggestionPayload(item),
          content_item_id: item.content_item_id,
          link_index: item.link_index,
          href: item.href,
          text: item.text,
          selected_context: selectedContexts[key] || undefined,
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to suggest link text"));
      const data = await res.json() as { suggested_text: string };
      setSuggestions((current) => ({ ...current, [key]: data.suggested_text }));
      setMessage("Suggested link text generated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to suggest link text");
    } finally {
      setBusyKey(null);
    }
  }

  async function applyText(item: LinkRow) {
    const key = linkKey(item);
    const replacement = suggestions[key]?.trim();
    if (!replacement) return;
    setBusyKey(key);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/links/apply-text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content_item_id: item.content_item_id,
          link_index: item.link_index,
          href: item.href,
          text: item.text,
          replacement_text: replacement,
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to apply link text"));
      const data = await res.json() as { revision_number: number | null };
      setMessage(data.revision_number ? `Applied link text and created revision ${data.revision_number}.` : "Link text was already applied.");
      if (data.revision_number) {
        window.dispatchEvent(new CustomEvent("canvascurate:pending-changes-updated"));
      }
      setSuggestions((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setSelectedContexts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      await loadLinks();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to apply link text");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-7">
      <style>{LINK_CONTEXT_STYLES}</style>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <nav className="flex items-center gap-2 text-on-surface-variant text-xs mb-2">
            <Link href="/dashboard" className="hover:text-primary transition-colors">Dashboard</Link>
            <span>›</span>
            <Link href={`/sessions/${sessionId}/health`} className="hover:text-primary transition-colors">Course Health</Link>
            <span>›</span>
            <span className="text-on-surface font-semibold">Links</span>
          </nav>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface tracking-tight">
            Link Inventory
          </h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Review vague or empty link text, generate a better label, then send the change to Pending Review.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <StatCard label="Links" value={counts.all} />
          <StatCard label="Flagged" value={counts.flagged} tone="error" />
          <StatCard label="Clear" value={counts.good} tone="success" />
        </div>
      </div>

      <form
        className="rounded-3xl bg-surface-container-low p-4 shadow-sm flex flex-col gap-3 lg:flex-row lg:items-center"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setQuery(draftQuery);
          setStatus(draftStatus);
        }}
      >
        <SearchInput
          value={draftQuery}
          onChange={setDraftQuery}
          placeholder="Search link text or destination"
          debounceMs={0}
          className="flex-1"
        />
        <select
          value={draftStatus}
          onChange={(event) => setDraftStatus(event.target.value as StatusFilter)}
          className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary"
        >
          <option value="all">All links</option>
          <option value="flagged">Flagged only</option>
          <option value="good">Clear only</option>
        </select>
        <Button type="submit">
          Apply
        </Button>
      </form>

      {message ? (
        <Alert variant="info">
          {message}
        </Alert>
      ) : null}

      {selectedCount === 0 ? (
        <Card>
          <CardBody className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-on-surface">Bulk link text review</p>
              <p className="mt-1 text-xs text-on-surface-variant">
                {eligibleItems.length} flagged text link{eligibleItems.length === 1 ? "" : "s"} eligible on this page.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCurrentPageFlaggedSelected(true)}
              disabled={eligibleItems.length === 0 || Boolean(bulkBusy)}
              icon={<Square size={16} />}
            >
              Select flagged
            </Button>
          </CardBody>
        </Card>
      ) : (
        <BulkActionBar
          selectedCount={selectedCount}
          totalCount={eligibleItems.length}
          allSelected={allEligibleSelected}
          noun="link"
          placement="fixed"
          onClearSelection={clearSelection}
          onSelectAll={() => setCurrentPageFlaggedSelected(true)}
          actions={[
            {
              label: "Generate Selected",
              onClick: () => void bulkSuggestText(),
              disabled: Boolean(bulkBusy),
              loading: bulkBusy === "suggest",
            },
            {
              label: `Send Ready (${selectedWithSuggestions.length})`,
              onClick: () => void bulkApplyText(),
              disabled: selectedWithSuggestions.length === 0 || Boolean(bulkBusy),
              loading: bulkBusy === "apply",
            },
          ]}
        />
      )}

      <div className="space-y-4">
        {loading ? (
          <CardSkeleton lines={4} className="rounded-3xl" />
        ) : items.length === 0 ? (
          <Card>
            <EmptyState
              title="No links matched this view"
              description="Try a different filter or re-sync the course if content changed recently."
              size="lg"
            />
          </Card>
        ) : (
          <>
            {items.map((item) => {
              const key = linkKey(item);
              const suggestion = suggestions[key] ?? "";
              const isImageLink = item.link_kind === "image";
              const isEligible = item.is_flagged && !isImageLink;
              const accessibleName = item.accessible_name?.trim();
              const currentText = item.text?.trim() || accessibleName || (isImageLink ? "Image link without accessible text" : "No readable link text");
              const isBusy = busyKey === key;
              const canSuggestText = !isImageLink;
              return (
                <article key={key} className="rounded-3xl border border-outline-variant/40 bg-surface-container-lowest p-5 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {isEligible ? (
                          <button
                            type="button"
                            onClick={() => setSelected((current) => ({ ...current, [key]: !current[key] }))}
                            className="inline-flex h-9 items-center gap-2 rounded-xl bg-surface-container-low px-3 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high"
                            aria-pressed={Boolean(selected[key])}
                          >
                            {selected[key] ? <CheckSquare size={16} /> : <Square size={16} />}
                            Select
                          </button>
                        ) : null}
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${issueTone(item.is_flagged)}`}>
                          {issueLabel(item.issue_code)}
                        </span>
                        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                          Link #{item.link_index}
                        </span>
                        {isImageLink ? (
                          <span className="inline-flex rounded-full border border-outline-variant/60 bg-surface-container-low px-3 py-1 text-xs font-semibold text-on-surface-variant">
                            Image link
                          </span>
                        ) : null}
                      </div>
                      <h2 className="font-headline text-xl font-bold text-on-surface">
                        {item.content_title || "Untitled content"}
                      </h2>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-on-surface-variant">
                        <span>{contentTypeLabel(item.content_type)}</span>
                        {item.module_name ? <span>{item.module_name}</span> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <ButtonLink
                        href={item.href}
                        target="_blank"
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                      >
                        Open destination
                      </ButtonLink>
                      {item.content_canvas_url ? (
                        <ButtonLink
                          href={item.content_canvas_url}
                          target="_blank"
                          size="sm"
                          className="text-xs"
                        >
                          Open in Canvas
                        </ButtonLink>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <section className="min-w-0 rounded-2xl border border-outline-variant/40 bg-surface-container-low p-4">
                      <div className="flex items-center justify-between gap-3 border-b border-outline-variant/40 pb-3">
                        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-on-surface-variant">Original</h3>
                        <span className="text-xs text-on-surface-variant">Current Canvas link</span>
                      </div>
                      <div className="mt-4 space-y-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                            {isImageLink ? "Accessible name" : "Link text"}
                          </p>
                          <p className="mt-1 rounded-xl bg-surface-container-lowest px-3 py-2 text-sm text-on-surface">
                            {currentText}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Destination</p>
                          <Link href={item.href} target="_blank" className="mt-1 block break-all text-sm font-medium text-primary hover:underline">
                            {item.href}
                          </Link>
                        </div>
                        {item.surrounding_text || item.html_context ? (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Page context</p>
                            <div className="mt-1">
                              <LinkContextPreview
                                item={item}
                                selectedContext={selectedContexts[key] || ""}
                                onUseContext={(value) => {
                                  setSelectedContexts((current) => ({ ...current, [key]: value }));
                                  if (value) setMessage("Selected context will be prioritized for the next AI suggestion.");
                                }}
                                onMakeLinkText={(value) => {
                                  setSuggestions((current) => ({ ...current, [key]: value }));
                                  setSelectedContexts((current) => ({ ...current, [key]: value }));
                                  setMessage("Selected text is now the proposed replacement and AI context.");
                                }}
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </section>

                    <section className="min-w-0 rounded-2xl border border-primary/20 bg-primary-container/10 p-4">
                      <div className="flex items-center justify-between gap-3 border-b border-primary/20 pb-3">
                        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-on-surface-variant">Replacement</h3>
                        <span className="text-xs text-on-surface-variant">Sends to Pending Review</span>
                      </div>
                      <div className="mt-4 space-y-3">
                        {canSuggestText ? (
                          <>
                            <textarea
                              value={suggestion}
                              onChange={(event) => setSuggestions((current) => ({ ...current, [key]: event.target.value }))}
                              rows={3}
                              placeholder={item.suggested_text || (item.is_flagged ? "Generate or enter clearer link text" : "Optional replacement text")}
                              className="min-h-24 w-full resize-y rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                            />
                            {item.suggested_text && !suggestion.trim() ? (
                              <Button
                                type="button"
                                onClick={() => setSuggestions((current) => ({ ...current, [key]: item.suggested_text || "" }))}
                                variant="ghost"
                                size="sm"
                                icon={<Link2 size={13} />}
                                className="text-xs"
                              >
                                Use highlighted context phrase
                              </Button>
                            ) : null}
                            {selectedContexts[key] ? (
                              <p className="rounded-xl border border-primary/20 bg-primary-container/10 px-3 py-2 text-xs leading-relaxed text-on-surface-variant">
                                The next AI suggestion will prioritize the selected context from the original preview.
                              </p>
                            ) : null}
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void suggestText(item)}
                                loading={isBusy}
                                variant="ghost"
                                size="sm"
                                icon={<Sparkles size={13} />}
                                className="text-xs"
                              >
                                {isBusy ? "Working..." : "Suggest text"}
                              </Button>
                              <Button
                                type="button"
                                disabled={isBusy || !suggestion.trim()}
                                onClick={() => void applyText(item)}
                                size="sm"
                                className="text-xs"
                              >
                                Send to Pending Review
                              </Button>
                            </div>
                          </>
                        ) : (
                          <p className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest px-3 py-3 text-sm leading-relaxed text-on-surface-variant">
                            This link uses an image as its clickable content. Fix the accessible label by editing the image alt text in the Images queue.
                          </p>
                        )}
                      </div>
                    </section>
                  </div>
                </article>
              );
            })}
          </>
        )}
      </div>

      <div className="rounded-2xl bg-surface-container-low px-4 py-3">
        <Pagination
          page={Math.min(currentPage, totalPages)}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={(page) => setOffset((page - 1) * PAGE_SIZE)}
        />
      </div>
    </div>
  );
}
