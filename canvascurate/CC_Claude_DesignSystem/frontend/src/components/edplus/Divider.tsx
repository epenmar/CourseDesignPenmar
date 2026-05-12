"use client";

import { type ReactNode } from "react";

interface DividerProps {
  className?: string;
  children?: ReactNode;
  orientation?: "horizontal" | "vertical";
}

export default function Divider({
  className = "",
  children,
  orientation = "horizontal",
}: DividerProps) {
  if (orientation === "vertical") {
    return <div className={`w-px bg-outline-variant ${className}`} />;
  }

  if (children) {
    return (
      <div className={`flex items-center gap-4 ${className}`}>
        <div className="flex-1 h-px bg-outline-variant" />
        <span className="text-xs font-semibold text-on-surface-variant px-2 whitespace-nowrap">
          {children}
        </span>
        <div className="flex-1 h-px bg-outline-variant" />
      </div>
    );
  }

  return <div className={`h-px bg-outline-variant ${className}`} />;
}
