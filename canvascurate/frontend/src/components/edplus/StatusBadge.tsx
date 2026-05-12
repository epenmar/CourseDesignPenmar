"use client";

import { type ReactNode } from "react";
import { CheckCircle, AlertCircle, Clock, XCircle, MinusCircle, HelpCircle } from "lucide-react";

type StatusVariant =
  | "success"
  | "error"
  | "warning"
  | "pending"
  | "inactive"
  | "info"
  | "neutral";

interface StatusConfig {
  bg: string;
  text: string;
  border: string;
  icon: ReactNode;
}

const STATUS_MAP: Record<StatusVariant, StatusConfig> = {
  success: {
    bg: "bg-[#e7f4ea]",
    text: "text-[#1f6b2a]",
    border: "border-[#2e7d32]/30",
    icon: <CheckCircle size={12} />,
  },
  error: {
    bg: "bg-error-container",
    text: "text-error",
    border: "border-error/30",
    icon: <XCircle size={12} />,
  },
  warning: {
    bg: "bg-[#fff2e8]",
    text: "text-[#8a3b00]",
    border: "border-[#ff7f32]/40",
    icon: <AlertCircle size={12} />,
  },
  pending: {
    bg: "bg-secondary/10",
    text: "text-on-surface",
    border: "border-secondary/30",
    icon: <Clock size={12} />,
  },
  inactive: {
    bg: "bg-surface-container",
    text: "text-on-surface-variant",
    border: "border-outline-variant",
    icon: <MinusCircle size={12} />,
  },
  info: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
    icon: <HelpCircle size={12} />,
  },
  neutral: {
    bg: "bg-surface-container",
    text: "text-on-surface",
    border: "border-outline-variant",
    icon: null,
  },
};

// Common status string → variant mapping
const STATUS_STRING_MAP: Record<string, StatusVariant> = {
  // Decision actions
  keep: "success",
  delete: "error",
  defer: "pending",
  // Document/content states
  active: "success",
  archived: "inactive",
  published: "success",
  unpublished: "inactive",
  draft: "pending",
  // Health / accessibility
  passed: "success",
  failed: "error",
  needs_review: "warning",
  passed_initial_check: "success",
  not_checked: "neutral",
  // Canvas sync
  validated: "success",
  rejected: "error",
  expired: "error",
  unverified: "warning",
  missing: "warning",
  // Deployment
  succeeded: "success",
  running: "pending",
  queued: "pending",
  // Linked
  linked: "success",
  unlinked: "warning",
  replacement_deployed: "success",
  ready_to_archive: "info",
  cleanup_marked: "warning",
};

interface StatusBadgeProps {
  /** A known status string (auto-maps to variant), OR use variant directly. */
  status?: string;
  variant?: StatusVariant;
  label?: string;
  showIcon?: boolean;
  className?: string;
}

export default function StatusBadge({
  status,
  variant,
  label,
  showIcon = true,
  className = "",
}: StatusBadgeProps) {
  const resolvedVariant: StatusVariant =
    variant ??
    (status ? STATUS_STRING_MAP[status] ?? "neutral" : "neutral");

  const cfg = STATUS_MAP[resolvedVariant];

  const displayLabel =
    label ??
    (status
      ? status
          .split("_")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")
      : resolvedVariant);

  return (
    <span
      className={`
        inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5
        text-[11px] font-semibold leading-none whitespace-nowrap
        ${cfg.bg} ${cfg.text} ${cfg.border}
        ${className}
      `}
    >
      {showIcon && cfg.icon}
      {displayLabel}
    </span>
  );
}
