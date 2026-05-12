"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | ReactNode;
  /** Extra context shown in a gray block (e.g. item name, count) */
  context?: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "warning" | "primary";
  loading?: boolean;
  onConfirm: () => void;
}

const variantConfig = {
  destructive: {
    iconBg: "bg-error-container",
    iconColor: "text-error",
    btnClass: "bg-error text-on-error hover:opacity-90",
  },
  warning: {
    iconBg: "bg-[#fff2e8]",
    iconColor: "text-[#8a3b00]",
    btnClass: "bg-[#E26B2C] text-white hover:opacity-90",
  },
  primary: {
    iconBg: "bg-primary/10",
    iconColor: "text-primary",
    btnClass: "bg-primary text-on-primary hover:opacity-90",
  },
};

export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  context,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "destructive",
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cfg = variantConfig[variant];

  // Auto-focus cancel on open (safety-first UX)
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => cancelRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
      {/* Backdrop */}
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-on-surface/40 backdrop-blur-sm"
        aria-label="Close"
      />

      {/* Dialog */}
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={description ? "confirm-desc" : undefined}
        className="relative w-full max-w-sm rounded-lg bg-surface-container-lowest border border-outline-variant shadow-card p-6"
      >
        {/* Icon */}
        <div className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl ${cfg.iconBg}`}>
          <AlertTriangle size={22} className={cfg.iconColor} />
        </div>

        <h2 id="confirm-title" className="font-headline text-base font-bold text-on-surface mb-2">
          {title}
        </h2>

        {description && (
          <p id="confirm-desc" className="text-sm text-on-surface-variant mb-3">
            {description}
          </p>
        )}

        {context && (
          <div className="rounded-lg bg-surface-container px-3 py-2.5 text-sm font-medium text-on-surface mb-4 border border-outline-variant">
            {context}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="flex-1 rounded-lg border border-outline-variant px-4 py-2.5 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${cfg.btnClass}`}
          >
            {loading && (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
