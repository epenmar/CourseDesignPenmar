"use client";

/**
 * Sidebar launcher for Pending Review.
 */

import { CheckCircle2 } from "lucide-react";

export default function PendingReviewButton({
  collapsed = false,
  contentCount,
  loading,
  moduleCount,
  onOpen,
  totalPending,
}: {
  collapsed?: boolean;
  contentCount: number;
  loading: boolean;
  moduleCount: number;
  onOpen: () => void;
  totalPending: number;
}) {
  return (
    <button
      type="button"
      title={collapsed ? "Pending Review" : undefined}
      onClick={onOpen}
      className={`inline-flex w-full items-center rounded-xl border border-outline-variant/30 bg-surface-container-lowest text-left text-sm text-on-surface transition-colors hover:bg-surface-container-low ${
        collapsed ? "justify-center px-0 py-3" : "gap-3 px-3 py-2.5"
      }`}
    >
      <span
        className={`inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg ${
          totalPending ? "bg-secondary-container text-on-secondary-container" : "bg-primary/10 text-primary"
        }`}
      >
        {totalPending ? (
          <span className="text-sm font-extrabold tabular-nums" aria-label={`${totalPending} pending review items`}>
            {totalPending > 99 ? "99+" : totalPending}
          </span>
        ) : (
          <CheckCircle2 size={18} aria-label="No pending review items" />
        )}
      </span>
      <span className={collapsed ? "sr-only" : "min-w-0"}>
        <span className="block font-semibold">Pending Review</span>
        <span className="block truncate text-xs text-on-surface-variant">
          {loading
            ? "Checking..."
            : totalPending
              ? `${contentCount} content / ${moduleCount} module pending`
              : "No pending changes"}
        </span>
      </span>
    </button>
  );
}
