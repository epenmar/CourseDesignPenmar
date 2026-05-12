"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  RefreshCw,
  X,
  ArrowUpCircle,
  GitBranch,
  Layers,
} from "lucide-react";

// ─── Re-used types (mirrors ContentEditorWorkspace) ──────────────────────────

export type PendingContentChange = {
  change_type: "content_edit";
  review_status: string;
  content_item_id: string;
  content_type: string;
  title: string | null;
  module_name: string | null;
  revision_count: number;
  latest_revision_number: number;
  latest_changed_at: string;
  change_summary: string | null;
  diff_summary: string;
  has_changes: boolean;
  affected_fields: string[];
  word_delta: number;
};

export type PendingModuleChange = {
  id: string;
  change_type: "module_operation";
  review_status: string;
  operation_type: string;
  content_item_id: string | null;
  title: string | null;
  action_label: string;
  detail: string | null;
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  updated_at: string;
};

export type PendingChangesResponse = {
  content_changes: PendingContentChange[];
  module_changes: PendingModuleChange[];
  counts: { content: number; modules: number; total: number };
};

export type BatchPushState = {
  status: "queued" | "pushing" | "pushed" | "failed";
  message?: string;
};

export type PushHistoryItem = {
  id: string;
  created_at: string;
  batch_id: string | null;
  content_item_id: string | null;
  canvas_id: string | null;
  content_type: string | null;
  title: string | null;
  revision_count: number;
  first_revision_number: number | null;
  latest_revision_number: number | null;
  latest_change_summary: string | null;
  change_summaries: string[];
};

export type ModuleApplyHistoryItem = {
  id: string;
  created_at: string;
  applied_count: number;
  failed_count: number;
  operation_ids: string[];
  operations: Array<{
    id: string;
    title?: string | null;
    operation_type?: string;
  }>;
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface PendingReviewPanelProps {
  // Open state
  open: boolean;
  onOpenChange: (open: boolean) => void;

  // Data
  loading: boolean;
  pendingChanges: PendingChangesResponse | null;

  // Current item context
  currentItemId: string;
  isDirty?: boolean;

  // Diff for the current item
  diffExpanded: boolean;
  diffLoading: boolean;
  pendingDiff: (PendingContentChange & { unified_diff: string }) | null;
  onToggleDiff: () => void;

  // Content change actions
  selectedContentPushIds: Set<string>;
  batchPushState: Record<string, BatchPushState>;
  batchPushing: boolean;
  onToggleAllContentPushSelection: () => void;
  onToggleContentPushSelection: (id: string) => void;
  onPushSelected: () => void;
  onPushAll: () => void;
  onPushSingle: (change: PendingContentChange) => void;

  // Module operation actions
  moduleOperationBusyId: string | null;
  applyingModuleOperations: boolean;
  onApplyModuleOperations: (ids?: string[]) => void;
  onDiscardModuleOperation: (id: string) => void;
  onDiscardAllModuleOperations: () => void;

  // History
  pushHistory: PushHistoryItem[];
  pushHistoryLoading: boolean;
  pushHistoryError: string | null;
  moduleApplyHistory: ModuleApplyHistoryItem[];
  moduleApplyHistoryLoading: boolean;
  moduleApplyHistoryError: string | null;

  // Messaging
  reviewMessage: string | null;

  // Refresh
  onRefresh: () => void;
}

// ─── Helper functions ─────────────────────────────────────────────────────────

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFieldList(fields: string[]) {
  return fields.map((f) => f.replaceAll("_", " ")).join(" + ");
}

function formatModuleValue(value: unknown, fallback = "—") {
  if (typeof value === "boolean") return value ? "Published" : "Unpublished";
  if (typeof value === "number") return String(value);
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

function moduleOperationToneClass(operationType: string) {
  if (["module_delete", "item_remove"].includes(operationType)) return "border-error/25 bg-error/5";
  if (operationType === "module_create") return "border-primary/20 bg-primary/5";
  if (operationType === "item_publish") return "border-secondary/30 bg-secondary/10";
  return "border-outline-variant bg-surface-container-low";
}

function contentStatusVariant(status: string): { bg: string; text: string } {
  if (status === "ready to push") return { bg: "bg-primary/10", text: "text-primary" };
  if (status === "staged module change") return { bg: "bg-secondary/15", text: "text-on-surface" };
  if (status === "pushed") return { bg: "bg-surface-container", text: "text-on-surface-variant" };
  return { bg: "bg-surface-container", text: "text-on-surface-variant" };
}

function moduleOperationBadgeVariant(operationType: string): { bg: string; text: string } {
  if (["module_delete", "item_remove"].includes(operationType)) return { bg: "bg-error-container", text: "text-error" };
  if (operationType === "module_create") return { bg: "bg-primary/10", text: "text-primary" };
  if (operationType === "item_publish") return { bg: "bg-secondary/15", text: "text-on-surface" };
  return { bg: "bg-surface-container", text: "text-on-surface-variant" };
}

function batchStatusVariant(state?: BatchPushState): { bg: string; text: string; label: string } | null {
  if (!state) return null;
  if (state.status === "pushed") return { bg: "bg-primary/10", text: "text-primary", label: "Pushed" };
  if (state.status === "failed") return { bg: "bg-error-container", text: "text-error", label: "Failed" };
  if (state.status === "pushing") return { bg: "bg-secondary/15", text: "text-on-surface", label: "Pushing…" };
  return { bg: "bg-surface-container", text: "text-on-surface-variant", label: "Queued" };
}

function canApplyModuleOperationIndividually(operationType: string) {
  return ["module_create", "module_rename", "item_rename"].includes(operationType);
}

function moduleOperationCompareRows(change: PendingModuleChange) {
  const b = change.before_state ?? {};
  const a = change.after_state ?? {};
  switch (change.operation_type) {
    case "module_create": return [{ label: "Module", before: "Not in Canvas", after: a.name ?? change.title }, { label: "Position", before: "—", after: a.position }];
    case "module_rename": return [{ label: "Module name", before: b.name, after: a.name }];
    case "module_position": return [{ label: "Position", before: b.position, after: a.position }];
    case "module_delete": return [{ label: "Module", before: b.name ?? change.title, after: "Deleted" }, { label: "Items", before: b.items_count, after: "Removed" }];
    case "item_rename": return [{ label: "Item title", before: b.title ?? change.title, after: a.title }];
    case "item_publish": return [{ label: "Status", before: b.published, after: a.published }];
    case "item_indent": return [{ label: "Indent", before: b.indent, after: a.indent }];
    case "item_move": return [{ label: "Module", before: b.module_name, after: a.module_name }, { label: "Position", before: b.position, after: a.position }];
    case "item_remove": return [{ label: "Module", before: b.module_name, after: "Removed" }, { label: "Position", before: b.position, after: "—" }];
    default: return [];
  }
}

function pushRevisionLabel(item: PushHistoryItem) {
  if (!item.revision_count) return null;
  if (item.first_revision_number && item.latest_revision_number) {
    if (item.first_revision_number === item.latest_revision_number) return `Revision ${item.latest_revision_number} pushed`;
    return `Revisions ${item.first_revision_number}–${item.latest_revision_number} pushed`;
  }
  return `${item.revision_count} revision${item.revision_count === 1 ? "" : "s"} pushed`;
}

function moduleOperationTypeLabel(value?: string) {
  if (!value) return "Module update";
  return value.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-outline-variant bg-white text-sm text-on-surface ${className}`}>
      {children}
    </div>
  );
}

function SectionHead({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-outline-variant">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-on-surface-variant">
        {left}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

function Pill({ bg, text, children }: { bg: string; text: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${bg} ${text} whitespace-nowrap`}>
      {children}
    </span>
  );
}

function ActionBtn({
  children,
  onClick,
  disabled,
  variant = "ghost",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "ghost" | "primary" | "gold" | "danger";
}) {
  const cls = {
    ghost: "bg-surface-container text-on-surface hover:bg-surface-container-high",
    primary: "bg-primary text-on-primary hover:opacity-90",
    gold: "bg-secondary text-on-surface hover:opacity-90",
    danger: "bg-error text-on-error hover:opacity-90",
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}

function EmptySection({ message }: { message: string }) {
  return (
    <div className="px-4 py-8 text-center text-sm text-on-surface-variant">{message}</div>
  );
}

function HistoryBadge({ label }: { label: string }) {
  return (
    <Pill bg="bg-primary/10" text="text-primary">{label}</Pill>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PendingReviewPanel({
  open,
  onOpenChange,
  loading,
  pendingChanges,
  currentItemId,
  isDirty = false,
  diffExpanded,
  diffLoading,
  pendingDiff,
  onToggleDiff,
  selectedContentPushIds,
  batchPushState,
  batchPushing,
  onToggleAllContentPushSelection,
  onToggleContentPushSelection,
  onPushSelected,
  onPushAll,
  onPushSingle,
  moduleOperationBusyId,
  applyingModuleOperations,
  onApplyModuleOperations,
  onDiscardModuleOperation,
  onDiscardAllModuleOperations,
  pushHistory,
  pushHistoryLoading,
  pushHistoryError,
  moduleApplyHistory,
  moduleApplyHistoryLoading,
  moduleApplyHistoryError,
  reviewMessage,
  onRefresh,
}: PendingReviewPanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    onOpenChange(false);
    setTimeout(() => triggerRef.current?.focus(), 0);
  }, [onOpenChange]);

  // Lock body scroll, focus trap, ESC
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setTimeout(() => closeRef.current?.focus(), 50);

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex='-1'])"
      )).filter((el) => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open, close]);

  const selectedPendingChange = pendingChanges?.content_changes.find(
    (c) => c.content_item_id === currentItemId,
  );
  const totalPending = pendingChanges?.counts.total ?? 0;
  const summaryText = loading
    ? "Checking…"
    : totalPending
      ? `${pendingChanges!.counts.content} content · ${pendingChanges!.counts.modules} module pending`
      : "No pending changes";

  // ── Trigger bar ────────────────────────────────────────────────────────────
  const triggerBar = (
    <div className="mx-6 mt-3 flex-none rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => onOpenChange(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <div className={`h-2 w-2 flex-shrink-0 rounded-full ${totalPending ? "bg-secondary" : "bg-surface-container-highest"}`} aria-hidden="true" />
          <span className="text-sm font-semibold text-on-surface">Pending Review</span>
          <span className="truncate text-xs text-on-surface-variant">{summaryText}</span>
          {selectedPendingChange ? (
            <Pill bg="bg-secondary/15" text="text-on-surface">This item</Pill>
          ) : null}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh pending changes"
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-outline-variant bg-white text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
        >
          <RefreshCw size={13} />
        </button>
      </div>
    </div>
  );

  if (!open) return triggerBar;

  // ── Dialog ─────────────────────────────────────────────────────────────────
  return (
    <>
      {triggerBar}

      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/40 px-4 py-6 backdrop-blur-[2px]"
        onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pending-review-title"
          className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest shadow-card"
        >
          {/* ── Header ── */}
          <div className="flex flex-none items-center justify-between gap-4 border-b border-outline-variant bg-surface-container-low px-6 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${totalPending ? "bg-secondary" : "bg-surface-container-highest"}`} aria-hidden="true" />
              <div className="min-w-0">
                <h2 id="pending-review-title" className="font-headline text-lg font-bold text-on-surface leading-tight">
                  Pending Review
                </h2>
                <p className="mt-0.5 text-xs text-on-surface-variant">{summaryText}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant bg-white px-3 py-1.5 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
              >
                <RefreshCw size={12} />
                Refresh
              </button>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                aria-label="Close Pending Review"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant bg-white text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* ── Body ── */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">

            {/* Status message */}
            {reviewMessage ? (
              <div className="flex items-start gap-3 rounded-lg border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
                <CheckCircle size={16} className="mt-0.5 flex-shrink-0 text-primary" />
                <span>{reviewMessage}</span>
              </div>
            ) : null}

            {/* No pending changes */}
            {!loading && !totalPending ? (
              <SectionCard>
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-container text-on-surface-variant">
                    <CheckCircle size={22} />
                  </div>
                  <div>
                    <p className="font-semibold text-on-surface">No pending changes</p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      Content and module changes are up to date with Canvas.
                    </p>
                  </div>
                </div>
              </SectionCard>
            ) : null}

            {/* ── Current item details ── */}
            {selectedPendingChange ? (
              <SectionCard>
                <SectionHead
                  left={<><GitBranch size={13} />This item</>}
                  right={
                    <Pill {...contentStatusVariant(selectedPendingChange.review_status)}>
                      {selectedPendingChange.review_status}
                    </Pill>
                  }
                />
                <div className="grid gap-4 px-4 py-4 md:grid-cols-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-on-surface-variant mb-1">Last changed</p>
                    <p className="text-sm text-on-surface">{formatDate(selectedPendingChange.latest_changed_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-on-surface-variant mb-1">Changes</p>
                    <p className="text-sm text-on-surface">{formatFieldList(selectedPendingChange.affected_fields)}</p>
                    <p className="mt-0.5 text-xs text-on-surface-variant">
                      {selectedPendingChange.diff_summary} ·{" "}
                      {selectedPendingChange.word_delta >= 0 ? "+" : ""}{selectedPendingChange.word_delta} words
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-on-surface-variant mb-1">Summary</p>
                    <p className="line-clamp-3 text-sm text-on-surface">
                      {selectedPendingChange.change_summary || "No summary provided."}
                    </p>
                  </div>
                  {selectedPendingChange.has_changes ? (
                    <div className="md:col-span-3">
                      <button
                        type="button"
                        onClick={onToggleDiff}
                        disabled={diffLoading}
                        className="inline-flex items-center gap-2 rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:opacity-50"
                      >
                        {diffLoading ? (
                          <span className="animate-spin h-3 w-3 rounded-full border-2 border-outline-variant border-t-primary" />
                        ) : diffExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        {diffLoading ? "Loading diff…" : diffExpanded ? "Hide diff" : "Show diff"}
                      </button>

                      {diffExpanded && pendingDiff?.unified_diff ? (
                        <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-[#0d1117] p-4 font-mono text-[11px] leading-5 text-slate-300">
                          {pendingDiff.unified_diff.split("\n").map((line, i) => {
                            const color = line.startsWith("+") && !line.startsWith("+++")
                              ? "text-green-400"
                              : line.startsWith("-") && !line.startsWith("---")
                                ? "text-red-400"
                                : line.startsWith("@@")
                                  ? "text-blue-400"
                                  : "text-slate-400";
                            return (
                              <span key={i} className={`block whitespace-pre-wrap break-all ${color}`}>
                                {line || " "}
                              </span>
                            );
                          })}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </SectionCard>
            ) : null}

            {/* ── Content Changes ── */}
            {pendingChanges?.content_changes.length ? (
              <SectionCard>
                <SectionHead
                  left={
                    <>
                      <input
                        type="checkbox"
                        aria-label="Select all content changes"
                        checked={pendingChanges.content_changes.every((c) => selectedContentPushIds.has(c.content_item_id))}
                        onChange={onToggleAllContentPushSelection}
                        className="h-3.5 w-3.5 rounded border-outline accent-primary"
                      />
                      <ArrowUpCircle size={13} />
                      Content Changes
                    </>
                  }
                  right={
                    <>
                      <span className="text-xs text-on-surface-variant">
                        {selectedContentPushIds.size
                          ? `${selectedContentPushIds.size} selected`
                          : `${pendingChanges.content_changes.length} item${pendingChanges.content_changes.length === 1 ? "" : "s"}`}
                      </span>
                      <ActionBtn
                        onClick={onPushSelected}
                        disabled={batchPushing || selectedContentPushIds.size === 0}
                        variant="gold"
                      >
                        Push selected
                      </ActionBtn>
                      <ActionBtn
                        onClick={onPushAll}
                        disabled={batchPushing || (isDirty && pendingChanges.content_changes.some((c) => c.content_item_id === currentItemId))}
                        variant="primary"
                      >
                        {batchPushing ? "Pushing…" : "Push all"}
                      </ActionBtn>
                    </>
                  }
                />
                <div className="divide-y divide-outline-variant">
                  {pendingChanges.content_changes.map((change) => {
                    const active = change.content_item_id === currentItemId;
                    const rowState = batchPushState[change.content_item_id];
                    const statusV = contentStatusVariant(change.review_status);
                    const batchV = batchStatusVariant(rowState);
                    return (
                      <div
                        key={change.content_item_id}
                        className={`px-4 py-3 ${active ? "bg-primary/5 ring-1 ring-inset ring-primary/15" : "hover:bg-surface-container-low"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-2.5">
                            <input
                              type="checkbox"
                              aria-label={`Select ${change.title ?? "untitled"} for push`}
                              checked={selectedContentPushIds.has(change.content_item_id)}
                              onChange={() => onToggleContentPushSelection(change.content_item_id)}
                              className="mt-1 h-3.5 w-3.5 flex-shrink-0 rounded border-outline accent-primary"
                            />
                            <div className="min-w-0">
                              <p className="line-clamp-1 text-sm font-semibold text-on-surface">
                                {change.title ?? "Untitled content"}
                                {active ? (
                                  <span className="ml-2 text-xs font-medium text-on-surface-variant">(this item)</span>
                                ) : null}
                              </p>
                              <p className="mt-0.5 text-xs text-on-surface-variant">
                                {change.content_type}
                                {change.module_name ? ` / ${change.module_name}` : ""}
                                {" · "}{formatFieldList(change.affected_fields)}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <Pill {...statusV}>{change.review_status}</Pill>
                              <ActionBtn
                                onClick={() => onPushSingle(change)}
                                disabled={batchPushing || (active && isDirty)}
                                variant="ghost"
                              >
                                {rowState?.status === "pushing" ? "Pushing…" : "Push"}
                              </ActionBtn>
                            </div>
                            {batchV ? <Pill {...{ bg: batchV.bg, text: batchV.text }}>{batchV.label}</Pill> : null}
                          </div>
                        </div>
                        {rowState?.status === "failed" && rowState.message ? (
                          <p className="mt-2 rounded-lg bg-error-container px-3 py-2 text-xs font-medium text-error">
                            {rowState.message}
                          </p>
                        ) : null}
                        {(change.change_summary || change.diff_summary) ? (
                          <p className="mt-1.5 line-clamp-2 pl-6 text-xs text-on-surface-variant">
                            {change.change_summary ?? change.diff_summary}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            ) : null}

            {/* ── Module Operations ── */}
            {pendingChanges?.module_changes.length ? (
              <SectionCard>
                <SectionHead
                  left={<><Layers size={13} />Module Operations</>}
                  right={
                    <>
                      <ActionBtn
                        onClick={() => onApplyModuleOperations()}
                        disabled={applyingModuleOperations || Boolean(moduleOperationBusyId)}
                        variant="gold"
                      >
                        {applyingModuleOperations ? "Applying…" : "Apply all"}
                      </ActionBtn>
                      <ActionBtn
                        onClick={onDiscardAllModuleOperations}
                        disabled={moduleOperationBusyId === "all" || applyingModuleOperations}
                      >
                        {moduleOperationBusyId === "all" ? "Discarding…" : "Discard all"}
                      </ActionBtn>
                    </>
                  }
                />
                <div className="space-y-2 p-3">
                  {pendingChanges.module_changes.map((change) => {
                    const compareRows = moduleOperationCompareRows(change);
                    const canApplyIndividually = canApplyModuleOperationIndividually(change.operation_type);
                    const operationBusy = moduleOperationBusyId === change.id || moduleOperationBusyId === `apply:${change.id}`;
                    const badgeV = moduleOperationBadgeVariant(change.operation_type);
                    return (
                      <div
                        key={change.id}
                        className={`rounded-lg border px-3 py-3 ${moduleOperationToneClass(change.operation_type)}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-on-surface">{change.action_label}</p>
                            {change.detail ? (
                              <p className="mt-0.5 line-clamp-2 text-xs text-on-surface-variant">{change.detail}</p>
                            ) : null}
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-2">
                            <Pill {...badgeV}>{change.review_status}</Pill>
                            {canApplyIndividually ? (
                              <ActionBtn
                                onClick={() => onApplyModuleOperations([change.id])}
                                disabled={operationBusy || applyingModuleOperations}
                                variant="gold"
                              >
                                {moduleOperationBusyId === `apply:${change.id}` ? "Applying…" : "Apply"}
                              </ActionBtn>
                            ) : (
                              <span className="rounded-lg bg-white/70 px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                                Batch only
                              </span>
                            )}
                            <ActionBtn
                              onClick={() => onDiscardModuleOperation(change.id)}
                              disabled={operationBusy}
                            >
                              {moduleOperationBusyId === change.id ? "…" : "Discard"}
                            </ActionBtn>
                          </div>
                        </div>
                        {compareRows.length ? (
                          <div className="mt-3 overflow-hidden rounded-md border border-outline-variant/40 bg-white/70">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-outline-variant/40 bg-surface-container-low">
                                  <th className="px-3 py-1.5 text-left font-semibold text-on-surface-variant w-28">Field</th>
                                  <th className="px-3 py-1.5 text-left font-semibold text-on-surface-variant">Before</th>
                                  <th className="px-3 py-1.5 text-left font-semibold text-on-surface-variant">After</th>
                                </tr>
                              </thead>
                              <tbody>
                                {compareRows.map((row) => (
                                  <tr key={row.label} className="border-t border-outline-variant/30">
                                    <td className="px-3 py-1.5 font-semibold text-on-surface-variant">{row.label}</td>
                                    <td className="px-3 py-1.5 text-on-surface-variant truncate max-w-[160px]">{formatModuleValue(row.before)}</td>
                                    <td className="px-3 py-1.5 text-on-surface font-medium truncate max-w-[160px]">{formatModuleValue(row.after)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            ) : null}

            {/* ── Recent Content Pushes ── */}
            <SectionCard>
              <SectionHead left={<><CheckCircle size={13} />Recent Content Pushes</>} />
              {pushHistoryLoading ? (
                <div className="space-y-2 px-4 py-4">
                  {[80, 60, 70].map((w) => (
                    <div key={w} className="animate-pulse h-3 rounded bg-surface-container" style={{ width: `${w}%` }} />
                  ))}
                </div>
              ) : pushHistoryError ? (
                <EmptySection message="Push history is not available from the current API yet." />
              ) : pushHistory.length ? (
                <div className="divide-y divide-outline-variant">
                  {pushHistory.map((item) => {
                    const revLabel = pushRevisionLabel(item);
                    return (
                      <div key={item.id} className="flex items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="line-clamp-1 text-sm font-semibold text-on-surface">
                            {item.title ?? "Untitled content"}
                          </p>
                          <p className="mt-0.5 text-xs text-on-surface-variant">
                            {item.content_type
                              ? item.content_type.charAt(0).toUpperCase() + item.content_type.slice(1)
                              : "Content"}
                            {item.batch_id ? " · batch push" : " · single push"}
                            {item.canvas_id ? ` · Canvas ID ${item.canvas_id}` : ""}
                          </p>
                          {revLabel ? <p className="mt-0.5 text-xs font-medium text-on-surface">{revLabel}</p> : null}
                          {item.latest_change_summary ? (
                            <p className="mt-0.5 line-clamp-2 text-xs text-on-surface-variant">
                              {item.latest_change_summary}
                              {item.change_summaries.length > 1
                                ? ` +${item.change_summaries.length - 1} more`
                                : ""}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-shrink-0 flex-col items-end gap-1 text-right">
                          <HistoryBadge label="Pushed" />
                          <span className="text-[11px] text-on-surface-variant">{formatDate(item.created_at)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptySection message="No content pushes recorded yet." />
              )}
            </SectionCard>

            {/* ── Recent Module Updates ── */}
            <SectionCard>
              <SectionHead left={<><Clock size={13} />Recent Module Updates</>} />
              {moduleApplyHistoryLoading ? (
                <div className="space-y-2 px-4 py-4">
                  {[75, 55, 65].map((w) => (
                    <div key={w} className="animate-pulse h-3 rounded bg-surface-container" style={{ width: `${w}%` }} />
                  ))}
                </div>
              ) : moduleApplyHistoryError ? (
                <EmptySection message="Module update history is not available from the current API yet." />
              ) : moduleApplyHistory.length ? (
                <div className="divide-y divide-outline-variant">
                  {moduleApplyHistory.map((item) => {
                    const first = item.operations[0];
                    const extra = Math.max(0, item.applied_count - 1);
                    return (
                      <div key={item.id} className="flex items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="line-clamp-1 text-sm font-semibold text-on-surface">
                            {first?.title ?? `${item.applied_count} module update${item.applied_count === 1 ? "" : "s"}`}
                          </p>
                          <p className="mt-0.5 text-xs text-on-surface-variant">
                            {first
                              ? `${moduleOperationTypeLabel(first.operation_type)}${extra ? ` · +${extra} more` : ""}`
                              : `${item.applied_count} operation${item.applied_count === 1 ? "" : "s"}`}
                            {item.failed_count ? ` · ${item.failed_count} failed` : ""}
                          </p>
                        </div>
                        <div className="flex flex-shrink-0 flex-col items-end gap-1 text-right">
                          <HistoryBadge label="Applied" />
                          <span className="text-[11px] text-on-surface-variant">{formatDate(item.created_at)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptySection message="No module updates recorded yet." />
              )}
            </SectionCard>

          </div>
        </div>
      </div>
    </>
  );
}
