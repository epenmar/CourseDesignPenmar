"use client";

import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { TableSkeleton } from "./Skeleton";
import EmptyState from "./EmptyState";

// ─── Column Definition ────────────────────────────────────────────────────────

export interface DataTableColumn<TRow> {
  /** Unique key — used as th key and for sort */
  key: string;
  /** Header label */
  label: string;
  /** Cell renderer. If omitted, renders row[key] as a string. */
  render?: (row: TRow, idx: number) => ReactNode;
  /** Set to enable click-to-sort on this column */
  sortable?: boolean;
  /** Initial width in percent */
  widthPct?: number;
  /** Tailwind alignment class, default "text-left" */
  align?: "text-left" | "text-center" | "text-right";
  /** Hide on small viewports (adds hidden sm:table-cell) */
  hideOnMobile?: boolean;
}

// ─── Row Actions ─────────────────────────────────────────────────────────────

export interface RowAction<TRow> {
  label: string;
  icon?: ReactNode;
  onClick: (row: TRow) => void;
  hidden?: (row: TRow) => boolean;
  disabled?: (row: TRow) => boolean;
  variant?: "default" | "destructive";
}

// ─── Sort State ───────────────────────────────────────────────────────────────

export interface SortState {
  key: string;
  direction: "asc" | "desc";
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface DataTableProps<TRow extends { id: string }> {
  columns: DataTableColumn<TRow>[];
  data: TRow[];
  loading?: boolean;
  skeletonRows?: number;

  /** Selection */
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;

  /** Sorting (controlled) */
  sortState?: SortState;
  onSortChange?: (sort: SortState) => void;

  /** Row actions dropdown (right-most column) */
  rowActions?: RowAction<TRow>[];

  /** Empty state */
  emptyIcon?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;

  /** Optional footer (e.g. <Pagination />) */
  footer?: ReactNode;

  /** Resizable columns */
  resizable?: boolean;

  onRowClick?: (row: TRow) => void;
  getRowClassName?: (row: TRow) => string;

  className?: string;
}

function DataTableCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="inline-flex cursor-pointer" aria-label={label}>
      <input
        type="checkbox"
        checked={checked}
        ref={(el) => { if (el) el.indeterminate = indeterminate ?? false; }}
        onChange={onChange}
        className="h-4 w-4 cursor-pointer rounded border-outline accent-primary"
      />
    </label>
  );
}

function DataTableRowActionsCell<TRow>({
  row,
  rowActions,
}: {
  row: TRow;
  rowActions?: RowAction<TRow>[];
}) {
  const [open, setOpen] = useState(false);
  const visible = rowActions?.filter((a) => !a.hidden?.(row)) ?? [];
  if (visible.length === 0) return <td className="px-4 py-3" />;

  return (
    <td className="relative px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Row actions"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
          <circle cx="8" cy="2.5" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13.5" r="1.5" />
        </svg>
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-10"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-8 z-20 w-44 rounded-lg border border-outline-variant bg-surface-container-lowest py-1 shadow-card">
            {visible.map((action, i) => (
              <button
                key={i}
                type="button"
                disabled={action.disabled?.(row)}
                onClick={() => { action.onClick(row); setOpen(false); }}
                className={`
                  flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors
                  disabled:cursor-not-allowed disabled:opacity-40
                  ${action.variant === "destructive"
                    ? "text-error hover:bg-error-container"
                    : "text-on-surface hover:bg-surface-container"
                  }
                `}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        </>
      )}
    </td>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DataTable<TRow extends { id: string }>({
  columns,
  data,
  loading = false,
  skeletonRows = 8,
  selectable = false,
  selectedIds = new Set(),
  onSelectionChange,
  sortState,
  onSortChange,
  rowActions,
  emptyIcon,
  emptyTitle = "No results",
  emptyDescription = "Try adjusting your filters or search query.",
  emptyAction,
  footer,
  resizable = false,
  onRowClick,
  getRowClassName,
  className = "",
}: DataTableProps<TRow>) {
  const tableRef = useRef<HTMLTableElement>(null);
  const dragging = useRef<{ index: number; startX: number; startWidthPct: number } | null>(null);

  // Build initial column widths
  const defaultWidthPct = Math.floor(100 / columns.length);
  const [widths, setWidths] = useState<number[]>(
    columns.map((c) => c.widthPct ?? defaultWidthPct)
  );

  const allSelected = data.length > 0 && data.every((row) => selectedIds.has(row.id));
  const someSelected = data.some((row) => selectedIds.has(row.id));

  // ── Selection helpers ────────────────────────────────────────────────────
  function toggleAll() {
    if (!onSelectionChange) return;
    if (allSelected) {
      const next = new Set(selectedIds);
      data.forEach((row) => next.delete(row.id));
      onSelectionChange(next);
    } else {
      const next = new Set(selectedIds);
      data.forEach((row) => next.add(row.id));
      onSelectionChange(next);
    }
  }

  function toggleRow(id: string) {
    if (!onSelectionChange) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }

  // ── Sort ─────────────────────────────────────────────────────────────────
  function handleSort(key: string) {
    if (!onSortChange) return;
    if (sortState?.key === key) {
      onSortChange({ key, direction: sortState.direction === "asc" ? "desc" : "asc" });
    } else {
      onSortChange({ key, direction: "asc" });
    }
  }

  // ── Column resize ────────────────────────────────────────────────────────
  function startResize(index: number, e: MouseEvent<HTMLDivElement>) {
    if (!resizable) return;
    e.preventDefault();
    const tableWidth = tableRef.current?.offsetWidth ?? 1000;
    dragging.current = {
      index,
      startX: e.clientX,
      startWidthPct: widths[index],
    };

    function onMove(moveEvent: globalThis.MouseEvent) {
      const d = dragging.current;
      if (!d) return;
      const deltaPct = ((moveEvent.clientX - d.startX) / tableWidth) * 100;
      setWidths((prev) => {
        const next = [...prev];
        const newW = Math.max(6, d.startWidthPct + deltaPct);
        const diff = newW - next[d.index];
        const nextIdx = d.index + 1;
        next[d.index] = newW;
        if (nextIdx < next.length) next[nextIdx] = Math.max(6, next[nextIdx] - diff);
        return next;
      });
    }

    function onUp() {
      dragging.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // ── Sort icon ────────────────────────────────────────────────────────────
  function SortIcon({ colKey }: { colKey: string }) {
    if (sortState?.key !== colKey) return <ChevronsUpDown size={13} className="opacity-30" />;
    return sortState.direction === "asc"
      ? <ChevronUp size={13} className="text-primary" />
      : <ChevronDown size={13} className="text-primary" />;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const colStyle = (i: number): CSSProperties => ({
    width: `${widths[i]}%`,
    minWidth: "60px",
  });

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Table wrapper */}
      <div className="w-full overflow-x-auto rounded-lg border border-outline-variant">
        {loading ? (
          <TableSkeleton
            rows={skeletonRows}
            columns={columns.length}
            showCheckbox={selectable}
          />
        ) : data.length === 0 ? (
          <EmptyState
            icon={emptyIcon}
            title={emptyTitle}
            description={emptyDescription}
            action={emptyAction}
            size="md"
          />
        ) : (
          <table
            ref={tableRef}
            className="w-full table-fixed border-collapse text-sm"
          >
            {/* colgroup for widths */}
            <colgroup>
              {selectable && <col style={{ width: "40px" }} />}
              {columns.map((col, i) => (
                <col key={col.key} style={colStyle(i)} />
              ))}
              {rowActions && <col style={{ width: "52px" }} />}
            </colgroup>

            {/* Head */}
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-low">
                {selectable && (
                  <th className="w-10 px-4 py-3 text-left">
                    <DataTableCheckbox
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      onChange={toggleAll}
                      label="Select all rows"
                    />
                  </th>
                )}
                {columns.map((col, i) => (
                  <th
                    key={col.key}
                    className={`
                      relative px-4 py-3 font-semibold text-xs uppercase tracking-[0.1em]
                      text-on-surface-variant select-none
                      ${col.align ?? "text-left"}
                      ${col.hideOnMobile ? "hidden sm:table-cell" : ""}
                      ${col.sortable ? "cursor-pointer hover:text-on-surface" : ""}
                    `}
                    onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {col.sortable && <SortIcon colKey={col.key} />}
                    </span>

                    {/* Resize handle */}
                    {resizable && i < columns.length - 1 && (
                      <div
                        onMouseDown={(e) => startResize(i, e)}
                        className="absolute right-0 top-0 h-full w-2 cursor-col-resize flex items-center justify-center opacity-0 hover:opacity-100 group-hover:opacity-50"
                      >
                        <div className="h-4 w-px bg-outline-variant" />
                      </div>
                    )}
                  </th>
                ))}
                {rowActions && (
                  <th className="w-12 px-3 py-3 text-right" aria-label="Actions" />
                )}
              </tr>
            </thead>

            {/* Body */}
            <tbody>
              {data.map((row, rowIdx) => {
                const selected = selectedIds.has(row.id);
                return (
                  <tr
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={`
                      border-b border-outline-variant transition-colors duration-100
                      ${onRowClick ? "cursor-pointer" : ""}
                      ${selected
                        ? "bg-primary/5"
                        : "hover:bg-surface-container-low"
                      }
                      ${getRowClassName?.(row) ?? ""}
                    `}
                  >
                    {selectable && (
                      <td
                        className="w-10 px-4 py-3"
                        onClick={(e) => { e.stopPropagation(); toggleRow(row.id); }}
                      >
                        <DataTableCheckbox
                          checked={selected}
                          onChange={() => toggleRow(row.id)}
                          label={`Select row ${rowIdx + 1}`}
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`
                          px-4 py-3 text-on-surface
                          ${col.align ?? "text-left"}
                          ${col.hideOnMobile ? "hidden sm:table-cell" : ""}
                        `}
                      >
                        {col.render
                          ? col.render(row, rowIdx)
                          : String((row as Record<string, unknown>)[col.key] ?? "—")}
                      </td>
                    ))}
                    {rowActions && <DataTableRowActionsCell row={row} rowActions={rowActions} />}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer (pagination, etc.) */}
      {footer && !loading && (
        <div className="mt-3">{footer}</div>
      )}
    </div>
  );
}
