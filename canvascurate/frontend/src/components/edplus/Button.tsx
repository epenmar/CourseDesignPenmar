"use client";

import Link, { type LinkProps } from "next/link";
import { type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

interface ButtonLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: LinkProps["href"];
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:opacity-90 hover:shadow-card disabled:opacity-50",
  secondary: "bg-secondary text-on-surface hover:opacity-90 disabled:opacity-50",
  ghost: "border-2 border-outline text-primary hover:bg-surface-container disabled:opacity-50",
  destructive: "bg-error text-on-error hover:opacity-90 disabled:opacity-50",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3 py-2 text-sm font-medium h-9",
  md: "px-4 py-2.5 text-sm font-semibold h-10",
  lg: "px-6 py-3 text-base font-semibold h-12",
};

function getButtonClassName({
  variant,
  size,
  disabled,
  className,
}: {
  variant: ButtonVariant;
  size: ButtonSize;
  disabled?: boolean;
  className?: string;
}) {
  return `
    inline-flex items-center justify-center gap-2 rounded-lg
    transition-all duration-150 cubic-bezier(0.2, 0.8, 0.2, 1)
    ${disabled ? "pointer-events-none cursor-not-allowed opacity-50" : ""}
    disabled:cursor-not-allowed
    ${variantClasses[variant]}
    ${sizeClasses[size]}
    ${className ?? ""}
  `;
}

export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  children,
  disabled,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={getButtonClassName({ variant, size, disabled: disabled || loading, className })}
      {...props}
    >
      {loading ? (
        <svg
          className="animate-spin h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : icon ? (
        icon
      ) : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  icon,
  children,
  disabled = false,
  className = "",
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      aria-disabled={disabled || props["aria-disabled"]}
      className={getButtonClassName({ variant, size, disabled, className })}
      {...props}
    >
      {icon}
      {children}
    </Link>
  );
}
