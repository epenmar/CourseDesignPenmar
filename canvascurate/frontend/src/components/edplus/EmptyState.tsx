"use client";

import { type ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const sizeConfig = {
  sm: { wrapper: "py-8", iconWrap: "h-10 w-10 text-lg", title: "text-sm", desc: "text-xs", gap: "gap-2" },
  md: { wrapper: "py-12", iconWrap: "h-14 w-14 text-2xl", title: "text-base", desc: "text-sm", gap: "gap-3" },
  lg: { wrapper: "py-20", iconWrap: "h-20 w-20 text-4xl", title: "text-xl", desc: "text-base", gap: "gap-4" },
};

export default function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
  size = "md",
}: EmptyStateProps) {
  const cfg = sizeConfig[size];

  return (
    <div className={`flex flex-col items-center justify-center text-center ${cfg.wrapper} ${className}`}>
      {icon && (
        <div
          className={`
            ${cfg.iconWrap} ${cfg.gap}
            flex items-center justify-center rounded-xl
            bg-surface-container text-on-surface-variant
            mb-4
          `}
        >
          {icon}
        </div>
      )}
      <p className={`font-semibold text-on-surface ${cfg.title} mb-1`}>{title}</p>
      {description && (
        <p className={`text-on-surface-variant max-w-sm ${cfg.desc} mt-1`}>{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
