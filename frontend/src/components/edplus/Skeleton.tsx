"use client";

import type { CSSProperties } from "react";

interface SkeletonProps {
  className?: string;
  width?: string;
  height?: string;
  rounded?: "sm" | "md" | "lg" | "full";
  style?: CSSProperties;
}

const roundedMap = {
  sm: "rounded",
  md: "rounded-lg",
  lg: "rounded-xl",
  full: "rounded-full",
};

export function Skeleton({ className = "", width, height, rounded = "md", style }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-surface-container ${roundedMap[rounded]} ${className}`}
      style={{ width, height, ...style }}
      aria-hidden="true"
    />
  );
}

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  showCheckbox?: boolean;
  className?: string;
}

export function TableSkeleton({
  rows = 8,
  columns = 5,
  showCheckbox = true,
  className = "",
}: TableSkeletonProps) {
  // Column width distribution (percent)
  const colWidths = Array.from({ length: columns }, (_, i) => {
    if (i === 0) return 40;
    if (i === columns - 1) return 15;
    return Math.floor(60 / (columns - 2));
  });

  return (
    <div className={`w-full overflow-hidden ${className}`} aria-label="Loading…" aria-busy="true">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-outline-variant px-4 py-3">
        {showCheckbox && <Skeleton width="16px" height="16px" rounded="sm" className="flex-shrink-0" />}
        {colWidths.map((w, i) => (
          <Skeleton key={i} height="12px" rounded="sm" style={{ width: `${w}%` }} />
        ))}
      </div>

      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className="flex items-center gap-4 border-b border-outline-variant px-4 py-3"
          style={{ opacity: 1 - rowIdx * 0.08 }}
        >
          {showCheckbox && <Skeleton width="16px" height="16px" rounded="sm" className="flex-shrink-0" />}
          {colWidths.map((w, colIdx) => (
            <Skeleton
              key={colIdx}
              height="12px"
              rounded="sm"
              style={{ width: `${w * (0.65 + ((rowIdx + colIdx) % 4) * 0.1)}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

interface CardSkeletonProps {
  lines?: number;
  showAvatar?: boolean;
  className?: string;
}

export function CardSkeleton({ lines = 3, showAvatar = false, className = "" }: CardSkeletonProps) {
  return (
    <div
      className={`rounded-lg border border-outline-variant bg-surface-container-lowest p-5 space-y-3 ${className}`}
      aria-hidden="true"
    >
      {showAvatar && (
        <div className="flex items-center gap-3">
          <Skeleton width="40px" height="40px" rounded="full" />
          <div className="flex-1 space-y-2">
            <Skeleton height="12px" width="60%" rounded="sm" />
            <Skeleton height="10px" width="40%" rounded="sm" />
          </div>
        </div>
      )}
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height="12px"
          rounded="sm"
          style={{ width: i === lines - 1 ? "60%" : `${82 + (i % 3) * 6}%` }}
        />
      ))}
    </div>
  );
}

export default Skeleton;
