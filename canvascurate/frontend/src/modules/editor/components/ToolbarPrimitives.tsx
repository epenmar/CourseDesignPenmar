"use client";

import type { ReactNode } from "react";

export function ToolbarButton({
  active,
  children,
  disabled,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-semibold transition-colors ${
        active
          ? "bg-secondary-container text-on-secondary-container"
          : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

export function ToolbarDivider() {
  return <div className="mx-1 h-6 w-px bg-outline-variant/50" aria-hidden="true" />;
}

export function ToolbarCluster({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-between border-r border-outline-variant/40 px-3 py-2 last:border-r-0">
      <div className="flex flex-col gap-1.5">{children}</div>
      <p className="pt-2 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface-variant">{label}</p>
    </div>
  );
}

export function ToolbarLevel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-center gap-1 ${className}`}>{children}</div>;
}

export function ColorSwatchPopover({
  colors,
  columns = 8,
  onClear,
  onSelect,
}: {
  colors: string[];
  columns?: number;
  onClear: () => void;
  onSelect: (color: string) => void;
}) {
  return (
    <div
      className="absolute left-0 top-10 z-[75] w-[278px] rounded-xl border border-outline-variant/40 bg-white p-3 shadow-2xl"
      onMouseDown={(event) => event.preventDefault()}
    >
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${columns}, 24px)` }}
      >
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            aria-label={color}
            onClick={() => onSelect(color)}
            className="h-6 w-6 rounded border border-outline-variant/50 transition-transform hover:scale-110"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="mt-2 w-full rounded-md bg-surface-container-low px-2 py-1 text-left text-xs font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high"
      >
        Clear
      </button>
    </div>
  );
}

export function ToolbarDropdownItem({
  children,
  icon,
  onClick,
}: {
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
    >
      <span className="flex h-6 w-6 items-center justify-center text-on-surface-variant">{icon}</span>
      <span>{children}</span>
    </button>
  );
}
