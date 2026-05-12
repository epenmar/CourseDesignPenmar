"use client";

import { useId, useRef, useState, type ReactNode } from "react";

export default function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
}) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  function updatePosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const tooltipWidth = 256;
    const margin = 12;
    const preferredLeft = align === "start"
      ? rect.left
      : align === "end"
        ? rect.right - tooltipWidth
        : rect.left + rect.width / 2 - tooltipWidth / 2;
    setPosition({
      left: Math.max(margin, Math.min(preferredLeft, window.innerWidth - tooltipWidth - margin)),
      top: side === "bottom" ? rect.bottom + 8 : rect.top - 8,
    });
  }

  return (
    <span
      className="group/tooltip inline-flex"
      onFocus={updatePosition}
      onMouseEnter={updatePosition}
    >
      <span ref={triggerRef} aria-describedby={id} className="inline-flex">
        {children}
      </span>
      <span
        id={id}
        role="tooltip"
        style={position ? {
          left: position.left,
          top: position.top,
          transform: side === "top" ? "translateY(-100%)" : undefined,
        } : undefined}
        className="pointer-events-none fixed z-[100] hidden w-64 whitespace-normal rounded-lg bg-on-surface px-3 py-2 text-left text-xs font-semibold leading-snug text-surface shadow-lg group-hover/tooltip:block group-focus-within/tooltip:block"
      >
        {content}
      </span>
    </span>
  );
}
