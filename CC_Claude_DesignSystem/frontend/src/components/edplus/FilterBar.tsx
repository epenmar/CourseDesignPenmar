"use client";

import { type ReactNode } from "react";
import SearchInput from "./SearchInput";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";

export interface FilterOption<T extends string = string> {
  value: T;
  label: string;
  count?: number;
}

export interface SortOption<T extends string = string> {
  key: T;
  label: string;
}

interface FilterBarProps<
  FV extends string = string,
  SK extends string = string,
> {
  /** Search */
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;

  /** Filter pill group (e.g. content types, statuses) */
  filterOptions?: FilterOption<FV>[];
  filterValue?: FV;
  onFilterChange?: (value: FV) => void;
  filterLabel?: string;

  /** Sort */
  sortOptions?: SortOption<SK>[];
  sortValue?: SK;
  sortDirection?: "asc" | "desc";
  onSortChange?: (key: SK, direction: "asc" | "desc") => void;

  /** Trailing slot for extra controls */
  trailing?: ReactNode;

  /** Summary of active filters */
  activeFilterCount?: number;
  onClearFilters?: () => void;

  className?: string;
}

export default function FilterBar<FV extends string = string, SK extends string = string>({
  searchPlaceholder = "Search…",
  searchValue,
  onSearchChange,
  filterOptions,
  filterValue,
  onFilterChange,
  filterLabel = "Filter",
  sortOptions,
  sortValue,
  sortDirection = "asc",
  onSortChange,
  trailing,
  activeFilterCount = 0,
  onClearFilters,
  className = "",
}: FilterBarProps<FV, SK>) {
  function toggleSort(key: SK) {
    if (!onSortChange) return;
    if (sortValue === key) {
      onSortChange(key, sortDirection === "asc" ? "desc" : "asc");
    } else {
      onSortChange(key, "asc");
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      {/* Search */}
      {onSearchChange && (
        <SearchInput
          value={searchValue}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          className="min-w-[200px] flex-1"
          size="md"
        />
      )}

      {/* Filter pills */}
      {filterOptions && onFilterChange && (
        <div className="flex items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest p-1">
          {filterOptions.map((opt) => {
            const active = filterValue === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onFilterChange(opt.value)}
                className={`
                  inline-flex items-center gap-1.5 rounded-md px-3 py-1.5
                  text-xs font-medium transition-colors duration-150
                  ${active
                    ? "bg-primary text-on-primary shadow-sm"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                  }
                `}
              >
                {opt.label}
                {opt.count !== undefined && (
                  <span className={`text-[10px] font-semibold ${active ? "opacity-80" : "opacity-60"}`}>
                    {opt.count > 999 ? "999+" : opt.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Sort */}
      {sortOptions && onSortChange && (
        <div className="flex items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest p-1">
          {sortOptions.map((opt) => {
            const active = sortValue === opt.key;
            const dir = active ? sortDirection : "asc";
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => toggleSort(opt.key)}
                className={`
                  inline-flex items-center gap-1 rounded-md px-3 py-1.5
                  text-xs font-medium transition-colors duration-150
                  ${active
                    ? "bg-surface-container-high text-on-surface shadow-sm"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                  }
                `}
              >
                {opt.label}
                {active && (
                  <span className="text-[10px] opacity-60">
                    {dir === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Active filter badge + clear */}
      {activeFilterCount > 0 && onClearFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
        >
          <SlidersHorizontal size={12} />
          {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}
          <X size={12} />
        </button>
      )}

      {/* Trailing slot */}
      {trailing && <div className="ml-auto">{trailing}</div>}
    </div>
  );
}
