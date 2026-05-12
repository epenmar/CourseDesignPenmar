"use client";

import { type ReactNode } from "react";

type BadgeVariant = "default" | "primary" | "success" | "warning" | "error";

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-surface-container text-on-surface",
  primary: "bg-primary/10 text-primary",
  success: "bg-green-50 text-green-700",
  warning: "bg-yellow-50 text-yellow-700",
  error: "bg-error-container text-error",
};

export default function Badge({
  children,
  variant = "default",
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center px-3 py-1 rounded-full
        text-xs font-semibold letter-spacing-tight
        ${variantClasses[variant]}
        ${className}
      `}
    >
      {children}
    </span>
  );
}
