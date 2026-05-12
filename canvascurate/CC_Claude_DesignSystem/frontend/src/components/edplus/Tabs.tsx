"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem<T extends string = string> {
  value: T;
  label: string;
  count?: number;
  icon?: ReactNode;
  disabled?: boolean;
}

interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
}

export default function Tabs<T extends string = string>({
  items,
  value,
  onChange,
  className = "",
  size = "md",
}: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, idx: number) {
    const enabled = items.filter((i) => !i.disabled);
    const enabledIdx = enabled.findIndex((i) => i.value === items[idx].value);
    let next = -1;
    if (e.key === "ArrowRight") next = (enabledIdx + 1) % enabled.length;
    if (e.key === "ArrowLeft") next = (enabledIdx - 1 + enabled.length) % enabled.length;
    if (next !== -1) {
      e.preventDefault();
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      buttons?.[next]?.focus();
      onChange(enabled[next].value);
    }
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      className={`flex items-center gap-1 border-b border-outline-variant ${className}`}
    >
      {items.map((item, idx) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`
              relative inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium
              transition-colors duration-150 select-none focus:outline-none
              focus-visible:ring-2 focus-visible:ring-primary/40 rounded-t-lg
              ${size === "sm" ? "px-3 py-1.5 text-xs" : ""}
              ${active
                ? "text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:rounded-full"
                : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low"
              }
              ${item.disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
            `}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined && (
              <span
                className={`
                  inline-flex items-center justify-center rounded-full px-2 py-0.5
                  text-[11px] font-semibold leading-none min-w-[20px]
                  ${active
                    ? "bg-primary/10 text-primary"
                    : "bg-surface-container text-on-surface-variant"
                  }
                `}
              >
                {item.count > 9999 ? "9999+" : item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
