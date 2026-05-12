"use client";

import { type ChangeEvent, type KeyboardEvent, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  page: number;           // 1-indexed
  totalPages: number;
  onPageChange: (page: number) => void;
  totalCount?: number;
  pageSize?: number;
  className?: string;
  showJump?: boolean;
}

export default function Pagination({
  page,
  totalPages,
  onPageChange,
  totalCount,
  pageSize,
  className = "",
  showJump = true,
}: PaginationProps) {
  const [jumpValue, setJumpValue] = useState("");

  const start = totalCount !== undefined && pageSize !== undefined
    ? Math.min((page - 1) * pageSize + 1, totalCount)
    : null;
  const end = totalCount !== undefined && pageSize !== undefined
    ? Math.min(page * pageSize, totalCount)
    : null;

  function handleJumpChange(e: ChangeEvent<HTMLInputElement>) {
    setJumpValue(e.target.value.replace(/[^0-9]/g, ""));
  }

  function commitJump(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const n = parseInt(jumpValue, 10);
    if (!isNaN(n) && n >= 1 && n <= totalPages) {
      onPageChange(n);
    }
    setJumpValue("");
  }

  if (totalPages <= 1 && !totalCount) return null;

  return (
    <div className={`flex items-center justify-between gap-4 text-sm ${className}`}>
      {/* Record range */}
      <span className="text-on-surface-variant text-xs">
        {start !== null && end !== null && totalCount !== undefined
          ? `${start}–${end} of ${totalCount.toLocaleString()}`
          : `Page ${page} of ${totalPages}`}
      </span>

      <div className="flex items-center gap-2">
        {/* Prev */}
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={16} />
        </button>

        {/* Page indicator */}
        <span className="text-xs font-medium text-on-surface px-2 whitespace-nowrap">
          {page} / {totalPages}
        </span>

        {/* Next */}
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight size={16} />
        </button>

        {/* Jump to page */}
        {showJump && totalPages > 2 && (
          <div className="flex items-center gap-2 ml-2 border-l border-outline-variant pl-4">
            <span className="text-xs text-on-surface-variant whitespace-nowrap">Go to</span>
            <input
              type="text"
              inputMode="numeric"
              aria-label="Jump to page"
              value={jumpValue}
              onChange={handleJumpChange}
              onKeyDown={commitJump}
              onBlur={() => setJumpValue("")}
              placeholder={String(page)}
              className="w-14 rounded-lg border border-outline-variant bg-surface-container-low px-2 py-1.5 text-center text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        )}
      </div>
    </div>
  );
}
