"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SyncCourseButton from "@/components/ui/SyncCourseButton";
import Alert from "@/components/edplus/Alert";
import BulkActionBar from "@/components/edplus/BulkActionBar";
import Button, { ButtonLink } from "@/components/edplus/Button";
import Card, { CardBody, CardHeader } from "@/components/edplus/Card";
import DataTable, { type DataTableColumn, type SortState } from "@/components/edplus/DataTable";
import Pagination from "@/components/edplus/Pagination";
import SearchInput from "@/components/edplus/SearchInput";
import Tabs, { type TabItem } from "@/components/edplus/Tabs";

type DecisionAction = "keep" | "delete" | "defer";
type SortKey = "title" | "content_type" | "file_location" | "course_location" | "status" | "created_at";
type SortDirection = "asc" | "desc";
type ContentTypeFilter = "all" | "page" | "assignment" | "discussion" | "quiz" | "file" | "module";

export type InventoryItem = {
  id: string;
  canvas_id: string;
  content_type: string;
  title: string | null;
  canvas_url: string | null;
  published: boolean | null;
  module_name: string | null;
  position: number | null;
  last_canvas_edit_at: string | null;
  last_synced_at: string;
  is_orphaned: boolean;
  duplicate_group_key: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  decision_action: DecisionAction | null;
};

type InventoryResponse = {
  items: InventoryItem[];
  total_count: number;
  limit: number;
  offset: number;
  next_offset: number | null;
  tab_counts: Record<string, number>;
  decision_counts: Record<DecisionAction, number>;
  seeded_decision_count?: number;
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
  item: InventoryItem;
  data: PreviewResponse | null;
  loading: boolean;
  error: string | null;
};

type InventoryTableProps = {
  sessionId: string;
  initialType: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";
const PAGE_SIZE = 50;
const CONTENT_TYPES: Array<{ value: ContentTypeFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "page", label: "Pages" },
  { value: "assignment", label: "Assignments" },
  { value: "discussion", label: "Discussions" },
  { value: "quiz", label: "Quizzes" },
  { value: "file", label: "Files" },
  { value: "module", label: "Modules" },
];

function contentTypeTabs(counts: Record<string, number>): TabItem<ContentTypeFilter>[] {
  return CONTENT_TYPES.map((item) => ({
    value: item.value,
    label: item.label,
    count: counts[item.value] ?? 0,
  }));
}

const TYPE_LABELS: Record<string, string> = {
  page: "Page",
  assignment: "Assignment",
  discussion: "Discussion",
  quiz: "Quiz",
  file: "File",
  module: "Module",
  module_item: "Module Item",
};

function normalizeInitialType(value: string): ContentTypeFilter {
  return CONTENT_TYPES.some((item) => item.value === value) ? value as ContentTypeFilter : "all";
}

function getText(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function fileLocation(item: InventoryItem) {
  if (item.content_type === "file") {
    const folderPath = getText(item.metadata?.folder_path);
    const folderName = getText(item.metadata?.folder_name);
    const folderId = getText(item.metadata?.folder_id);
    return folderPath || folderName || (folderId ? `Canvas folder ${folderId}` : "Course files");
  }

  if (item.content_type === "module") return "Modules";
  return TYPE_LABELS[item.content_type] ?? item.content_type;
}

function courseLocation(item: InventoryItem) {
  if (item.module_name) return item.module_name;
  const linkedFrom = Array.isArray(item.metadata?.linked_from) ? item.metadata.linked_from : [];
  if (linkedFrom.length) return `Linked from: ${linkedFrom.slice(0, 3).join(", ")}`;
  if (item.content_type === "module") return "Module list";
  return "Not in module";
}

function statusText(item: InventoryItem) {
  if (item.duplicate_group_key) return "Duplicate";
  const linkedFrom = Array.isArray(item.metadata?.linked_from) ? item.metadata.linked_from : [];
  if (linkedFrom.length) return "Referenced";
  if (item.is_orphaned && item.content_type !== "module") return "Orphaned";
  if (item.published === false) return "Unpublished";
  return "In module";
}

function statusBadgeClass(status: string) {
  if (status === "In module") return "bg-[#78be20]/15 text-[#446D12]";
  if (status === "Referenced") return "bg-[#78be20]/15 text-[#446D12]";
  if (status === "Unpublished") return "bg-surface-container text-on-surface-variant";
  if (status === "Duplicate") return "bg-secondary-container/25 text-secondary";
  return "bg-secondary-container/20 text-secondary";
}

function rowClass(action: DecisionAction | null | undefined) {
  if (action === "delete") return "bg-error-container/20 hover:bg-error-container/30";
  if (action === "keep") return "bg-[#78be20]/10 hover:bg-[#78be20]/15";
  return "hover:bg-surface-container-low/50";
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

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return body.detail ?? fallback;
}

function decisionSummary(counts: Record<DecisionAction, number>) {
  return {
    keep: counts.keep ?? 0,
    delete: counts.delete ?? 0,
    defer: counts.defer ?? 0,
  };
}

export default function InventoryTable({ sessionId, initialType }: InventoryTableProps) {
  const router = useRouter();
  const [contentType, setContentType] = useState<ContentTypeFilter>(normalizeInitialType(initialType));
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({ all: 0 });
  const [decisionCounts, setDecisionCounts] = useState<Record<DecisionAction, number>>({ keep: 0, delete: 0, defer: 0 });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<{ itemId: string; action: DecisionAction } | null>(null);
  const [bulkPending, setBulkPending] = useState<DecisionAction | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const decisions = useMemo(() => decisionSummary(decisionCounts), [decisionCounts]);
  const selectedCount = selectedIds.size;
  const allPageSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));

  const getAccessToken = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return session.access_token;
  }, []);

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      const token = await getAccessToken();
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort: sortKey,
        direction: sortDirection,
      });
      if (contentType !== "all") params.set("content_type", contentType);
      if (query.trim()) params.set("q", query.trim());

      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/inventory?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to load inventory"));
      }

      const data = await res.json() as InventoryResponse;
      setItems(data.items);
      setSelectedIds(new Set());
      setTotalCount(data.total_count);
      setTabCounts(data.tab_counts);
      setDecisionCounts(data.decision_counts);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load inventory");
      setItems([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [contentType, getAccessToken, offset, query, sessionId, sortDirection, sortKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOffset(0);
      setQuery(draftQuery);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [draftQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadInventory();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadInventory]);

  function handleTypeChange(nextType: ContentTypeFilter) {
    setContentType(nextType);
    setOffset(0);
    const suffix = nextType === "all" ? "" : `?type=${encodeURIComponent(nextType)}`;
    router.replace(`/sessions/${sessionId}/inventory${suffix}`, { scroll: false });
  }

  async function openPreview(item: InventoryItem) {
    setPreview({ item, data: null, loading: true, error: null });

    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/content/${item.id}/preview`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to load content preview"));
      }

      const data = await res.json() as PreviewResponse;
      setPreview({ item, data, loading: false, error: null });
    } catch (error) {
      setPreview({
        item,
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load content preview",
      });
    }
  }

  function adjustDecisionCounts(previous: DecisionAction | null | undefined, next: DecisionAction | null | undefined) {
    setDecisionCounts((current) => {
      const updated = { keep: current.keep ?? 0, delete: current.delete ?? 0, defer: current.defer ?? 0 };
      if (previous && updated[previous] > 0) updated[previous] -= 1;
      if (next) updated[next] += 1;
      return updated;
    });
  }

  async function saveDecision(item: InventoryItem, action: DecisionAction) {
    if (pendingDecision || bulkPending) return;

    const previous = item.decision_action;
    setMessage(null);
    setPendingDecision({ itemId: item.id, action });
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, decision_action: action } : row));
    adjustDecisionCounts(previous, action);

    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/inventory-decisions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content_item_id: item.id,
          action,
        }),
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to save inventory decision"));
      }
      await loadInventory();
    } catch (error) {
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, decision_action: previous ?? null } : row));
      adjustDecisionCounts(action, previous);
      setMessage(error instanceof Error ? error.message : "Failed to save inventory decision");
    } finally {
      setPendingDecision(null);
    }
  }

  function applyDecisionChanges(previousById: Map<string, DecisionAction | null>, nextAction: DecisionAction | null) {
    setDecisionCounts((current) => {
      const updated = { keep: current.keep ?? 0, delete: current.delete ?? 0, defer: current.defer ?? 0 };
      previousById.forEach((previous) => {
        if (previous && updated[previous] > 0) updated[previous] -= 1;
        if (nextAction) updated[nextAction] += 1;
      });
      return updated;
    });
  }

  async function saveBulkDecision(action: DecisionAction) {
    if (bulkPending || selectedIds.size === 0) return;

    const contentItemIds = Array.from(selectedIds);
    const previousById = new Map(
      items
        .filter((item) => selectedIds.has(item.id))
        .map((item) => [item.id, item.decision_action] as const)
    );

    setMessage(null);
    setBulkPending(action);
    setItems((current) => current.map((item) => selectedIds.has(item.id) ? { ...item, decision_action: action } : item));
    applyDecisionChanges(previousById, action);

    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/inventory-decisions/bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content_item_ids: contentItemIds,
          action,
        }),
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to save bulk inventory decisions"));
      }

      setSelectedIds(new Set());
      await loadInventory();
    } catch (error) {
      setItems((current) => current.map((item) => {
        if (!previousById.has(item.id)) return item;
        return { ...item, decision_action: previousById.get(item.id) ?? null };
      }));
      const rollbackById = new Map(contentItemIds.map((itemId) => [itemId, action] as const));
      setDecisionCounts((current) => {
        const updated = { keep: current.keep ?? 0, delete: current.delete ?? 0, defer: current.defer ?? 0 };
        rollbackById.forEach((currentAction, itemId) => {
          if (currentAction && updated[currentAction] > 0) updated[currentAction] -= 1;
          const previous = previousById.get(itemId);
          if (previous) updated[previous] += 1;
        });
        return updated;
      });
      setMessage(error instanceof Error ? error.message : "Failed to save bulk inventory decisions");
    } finally {
      setBulkPending(null);
    }
  }

  const inventoryColumns: DataTableColumn<InventoryItem>[] = [
    {
      key: "title",
      label: "Title",
      sortable: true,
      widthPct: 25,
      render: (item) => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-on-surface" title={item.title ?? "Untitled"}>
            {item.title ?? "Untitled"}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-on-surface-variant">
            Canvas ID {item.canvas_id}
          </p>
        </div>
      ),
    },
    {
      key: "content_type",
      label: "Type",
      sortable: true,
      widthPct: 11,
      render: (item) => <span className="text-on-surface-variant">{TYPE_LABELS[item.content_type] ?? item.content_type}</span>,
    },
    {
      key: "file_location",
      label: "File Location",
      sortable: true,
      widthPct: 18,
      render: (item) => (
        <span className="block truncate text-on-surface-variant" title={fileLocation(item)}>
          {fileLocation(item)}
        </span>
      ),
    },
    {
      key: "course_location",
      label: "Course Location",
      sortable: true,
      widthPct: 17,
      render: (item) => (
        <span className="block truncate text-on-surface-variant" title={courseLocation(item)}>
          {courseLocation(item)}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      widthPct: 11,
      render: (item) => {
        const status = statusText(item);
        return (
          <span className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-bold ${statusBadgeClass(status)}`}>
            {status}
          </span>
        );
      },
    },
    {
      key: "actions",
      label: "Actions",
      align: "text-center",
      widthPct: 18,
      render: (item) => {
        const pendingForItem = pendingDecision?.itemId === item.id;
        return (
          <div className="flex items-center justify-center gap-1.5">
            <Button
              type="button"
              onClick={() => void openPreview(item)}
              variant="ghost"
              size="sm"
              className="h-8 w-8 border-0 p-0 text-on-surface-variant"
              title="Preview Content"
              aria-label={`Preview ${item.title ?? "content"}`}
            >
              <span aria-hidden="true">◉</span>
            </Button>
            <Button
              type="button"
              onClick={() => void saveDecision(item, "keep")}
              disabled={pendingForItem}
              variant="ghost"
              size="sm"
              className={`h-8 w-8 border-0 p-0 ${
                item.decision_action === "keep"
                  ? "bg-[#78be20]/20 text-[#446D12]"
                  : "text-on-surface-variant hover:bg-[#78be20]/10 hover:text-[#446D12]"
              }`}
              title="Keep"
              aria-label={`Keep ${item.title ?? "content"}`}
            >
              <span aria-hidden="true">✓</span>
            </Button>
            <Button
              type="button"
              onClick={() => void saveDecision(item, "delete")}
              disabled={pendingForItem}
              variant="ghost"
              size="sm"
              className={`h-8 w-8 border-0 p-0 ${
                item.decision_action === "delete"
                  ? "bg-error-container text-error"
                  : "text-on-surface-variant hover:bg-error-container hover:text-error"
              }`}
              title="Remove"
              aria-label={`Remove ${item.title ?? "content"}`}
            >
              <span aria-hidden="true">×</span>
            </Button>
            <Button
              type="button"
              onClick={() => void saveDecision(item, "defer")}
              disabled={pendingForItem}
              variant="ghost"
              size="sm"
              className={`h-8 w-8 border-0 p-0 text-xs font-bold ${
                item.decision_action === "defer"
                  ? "bg-surface-container text-on-surface"
                  : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
              }`}
              title="Defer"
              aria-label={`Defer ${item.title ?? "content"}`}
            >
              D
            </Button>
            {item.canvas_url ? (
              <ButtonLink
                href={item.canvas_url}
                target="_blank"
                rel="noopener noreferrer"
                variant="ghost"
                size="sm"
                className="h-8 w-8 border-0 p-0 text-on-surface-variant"
                title="Open in Canvas"
                aria-label={`Open ${item.title ?? "content"} in Canvas`}
              >
                <span aria-hidden="true">↗</span>
              </ButtonLink>
            ) : (
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant/30" title="No Canvas URL">
                ↗
              </span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <section className="space-y-4">
      <Tabs
        items={contentTypeTabs(tabCounts)}
        value={contentType}
        onChange={handleTypeChange}
        className="overflow-x-auto"
      />

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-col justify-between gap-3 bg-surface-container-low px-5 py-4 md:flex-row md:items-center">
          <div>
            <h2 className="font-headline font-bold text-on-surface">Inventory Table</h2>
            <div className="text-xs text-on-surface-variant mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
              <span>{totalCount} matching item{totalCount === 1 ? "" : "s"}</span>
              <span>{decisions.keep} kept</span>
              <span>{decisions.delete} marked remove</span>
              <span>{decisions.defer} deferred</span>
            </div>
          </div>
          <SearchInput
            value={draftQuery}
            onChange={setDraftQuery}
            placeholder="Search inventory..."
            className="w-full md:w-80"
          />
        </CardHeader>

        {message && (
          <Alert variant="error" className="m-4">
            {message}
          </Alert>
        )}

        {tabCounts.all > 0 && (
          <div className="px-5 py-3 bg-surface-container-lowest border-b border-outline-variant/20 flex flex-col md:flex-row md:items-center justify-between gap-3">
            {selectedCount ? (
              <BulkActionBar
                selectedCount={selectedCount}
                totalCount={items.length}
                allSelected={allPageSelected}
                noun="item"
                placement="fixed"
                onClearSelection={() => setSelectedIds(new Set())}
                onSelectAll={() => setSelectedIds(new Set(items.map((item) => item.id)))}
                actions={[
                  {
                    label: "Keep Selected",
                    onClick: () => void saveBulkDecision("keep"),
                    disabled: Boolean(bulkPending),
                    loading: bulkPending === "keep",
                  },
                  {
                    label: "Defer Selected",
                    onClick: () => void saveBulkDecision("defer"),
                    disabled: Boolean(bulkPending),
                    loading: bulkPending === "defer",
                  },
                  {
                    label: "Remove Selected",
                    variant: "destructive",
                    onClick: () => void saveBulkDecision("delete"),
                    disabled: Boolean(bulkPending),
                    loading: bulkPending === "delete",
                  },
                ]}
              />
            ) : (
              <div className="text-xs text-on-surface-variant">
                Select rows to apply a bulk decision.
              </div>
            )}
          </div>
        )}

        <CardBody className="p-0">
          <DataTable
            columns={inventoryColumns}
            data={items}
            loading={loading}
            skeletonRows={8}
            selectable
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            sortState={{ key: sortKey, direction: sortDirection }}
            onSortChange={(sort: SortState) => {
              setOffset(0);
              setSortKey(sort.key as SortKey);
              setSortDirection(sort.direction);
            }}
            resizable
            getRowClassName={(item) => rowClass(item.decision_action)}
            emptyTitle={tabCounts.all === 0 ? "No synced content yet" : "No inventory items match this search"}
            emptyDescription={
              tabCounts.all === 0
                ? "Start a Canvas sync to build a local inventory of pages, assignments, discussions, quizzes, files, and modules."
                : "Adjust the content type filter or search query and try again."
            }
            emptyAction={tabCounts.all === 0 ? <SyncCourseButton sessionId={sessionId} /> : undefined}
            footer={
              <div className="bg-surface-container-low px-5 py-4">
              <Pagination
                page={currentPage}
                totalPages={totalPages}
                totalCount={totalCount}
                pageSize={PAGE_SIZE}
                onPageChange={(page) => setOffset((page - 1) * PAGE_SIZE)}
              />
            </div>
            }
          />
        </CardBody>
      </Card>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6" role="dialog" aria-modal="true">
          <div className="w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-xl bg-surface-container-lowest shadow-2xl ghost-border">
            <div className="px-5 py-4 bg-surface-container-low flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
                  Preview Content
                </p>
                <h3 className="font-headline text-xl font-bold text-on-surface truncate mt-1">
                  {preview.data?.title ?? preview.item.title ?? "Untitled"}
                </h3>
                <p className="text-xs text-on-surface-variant mt-1">
                  {TYPE_LABELS[preview.item.content_type] ?? preview.item.content_type} · {courseLocation(preview.item)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {preview.data?.canvas_url && (
                  <a
                    href={preview.data.canvas_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 rounded-lg ghost-border text-xs font-bold text-primary hover:bg-surface-container-lowest transition-colors"
                  >
                    Open in Canvas
                  </a>
                )}
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
            <div className="bg-surface-container-low p-3">
              {preview.loading ? (
                <div className="h-[66vh] rounded-lg bg-surface-container-lowest ghost-border flex items-center justify-center text-sm text-on-surface-variant">
                  Loading rich preview...
                </div>
              ) : preview.error ? (
                <div className="h-[66vh] rounded-lg bg-surface-container-lowest ghost-border flex items-center justify-center text-sm text-on-surface-variant px-5 text-center">
                  {preview.error}
                </div>
              ) : preview.data ? (
                <iframe
                  title={`Preview ${preview.data.title ?? "content"}`}
                  srcDoc={previewDocument(preview.data)}
                  sandbox="allow-popups allow-popups-to-escape-sandbox allow-forms"
                  className="w-full h-[66vh] rounded-lg bg-white ghost-border"
                />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
