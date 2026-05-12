"use client";

import { type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export default function Modal({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  size = "md",
}: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
      {/* Backdrop */}
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-on-surface/40 backdrop-blur-sm"
        aria-label="Close modal"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`
          relative w-full ${sizeClasses[size]} rounded-lg
          bg-surface-container-lowest border border-outline-variant
          shadow-card overflow-hidden
          animate-in fade-in zoom-in-95 duration-200
        `}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant px-6 py-5">
          <div>
            {subtitle && (
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-on-surface-variant mb-1">
                {subtitle}
              </p>
            )}
            <h2
              id="modal-title"
              className="font-headline text-xl font-bold text-on-surface"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container text-on-surface-variant transition-colors hover:bg-surface-container-high"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        {children}
      </div>
    </div>
  );
}

interface ModalBodyProps {
  children: ReactNode;
  className?: string;
}

export function ModalBody({ children, className = "" }: ModalBodyProps) {
  return <div className={`px-6 py-5 space-y-4 ${className}`}>{children}</div>;
}

interface ModalFooterProps {
  children: ReactNode;
  className?: string;
}

export function ModalFooter({ children, className = "" }: ModalFooterProps) {
  return (
    <div className={`border-t border-outline-variant px-6 py-4 flex justify-end gap-3 ${className}`}>
      {children}
    </div>
  );
}
