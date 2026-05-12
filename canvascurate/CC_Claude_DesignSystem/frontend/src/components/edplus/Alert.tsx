"use client";

import { type ReactNode } from "react";
import { AlertCircle, CheckCircle, InfoIcon, AlertTriangle, X } from "lucide-react";

type AlertVariant = "info" | "success" | "warning" | "error";

interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}

const variantConfig: Record<AlertVariant, { bg: string; text: string; border: string; icon: ReactNode }> = {
  info: {
    bg: "bg-blue-50",
    text: "text-blue-900",
    border: "border-blue-200",
    icon: <InfoIcon size={18} />,
  },
  success: {
    bg: "bg-green-50",
    text: "text-green-900",
    border: "border-green-200",
    icon: <CheckCircle size={18} />,
  },
  warning: {
    bg: "bg-yellow-50",
    text: "text-yellow-900",
    border: "border-yellow-200",
    icon: <AlertTriangle size={18} />,
  },
  error: {
    bg: "bg-error-container",
    text: "text-on-error-container",
    border: "border-error",
    icon: <AlertCircle size={18} />,
  },
};

export default function Alert({
  variant = "info",
  title,
  children,
  onClose,
  className = "",
}: AlertProps) {
  const config = variantConfig[variant];

  return (
    <div
      className={`
        flex gap-3 rounded-lg border p-4
        ${config.bg} ${config.border} ${config.text}
        ${className}
      `}
      role={variant === "error" ? "alert" : undefined}
    >
      <div className="flex-shrink-0">{config.icon}</div>
      <div className="flex-1">
        {title && <p className="font-semibold text-sm mb-1">{title}</p>}
        <p className="text-sm">{children}</p>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
          aria-label="Close alert"
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
}
