"use client";

import { type ReactNode } from "react";
import { X } from "lucide-react";

interface BulkAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: "default" | "destructive";
  disabled?: boolean;
  loading?: boolean;
}

interface BulkActionBarProps {
  selectedCount: number;
  totalCount?: number;
  actions: BulkAction[];
  onSelectAll?: () => void;
  onClearSelection: () => void;
  allSelected?: boolean;
  noun?: string;  // e.g. "item", "file", "module"
  className?: string;
}

export default function BulkActionBar({
  selectedCount,
  totalCount,
  actions,
  onSelectAll,
  onClearSelection,
  allSelected = false,
  noun = "item",
  className = "",
}: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  const plural = selectedCount === 1 ? noun : `${noun}s`;

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className={`
        sticky bottom-4 z-20 mx-4
        flex items-center gap-3 flex-wrap
        rounded-lg border border-outline-variant
        bg-inverse-surface text-inverse-on-surface
        px-4 py-3 shadow-card
        ${className}
      `}
    >
      {/* Count + select-all */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onClearSelection}
          aria-label="Clear selection"
          className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <X size={14} />
        </button>

        <span className="text-sm font-semibold text-white whitespace-nowrap">
          {selectedCount} {plural} selected
        </span>

        {onSelectAll && totalCount && !allSelected && (
          <button
            type="button"
            onClick={onSelectAll}
            className="text-xs font-medium text-white/70 hover:text-white underline-offset-2 hover:underline transition-colors whitespace-nowrap"
          >
            Select all {totalCount.toLocaleString()}
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-white/20 flex-shrink-0" aria-hidden="true" />

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {actions.map((action, idx) => (
          <button
            key={idx}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled || action.loading}
            className={`
              inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5
              text-xs font-semibold transition-all duration-150
              disabled:cursor-not-allowed disabled:opacity-50
              ${action.variant === "destructive"
                ? "bg-error text-on-error hover:opacity-90"
                : "bg-white/15 text-white hover:bg-white/25"
              }
            `}
          >
            {action.loading ? (
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : action.icon}
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
