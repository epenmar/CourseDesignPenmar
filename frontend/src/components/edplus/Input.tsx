"use client";

import { useId, type ReactNode } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: ReactNode;
  fullWidth?: boolean;
  containerClassName?: string;
}

export default function Input({
  label,
  error,
  hint,
  icon,
  fullWidth = false,
  containerClassName = "",
  className = "",
  id,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className={`${fullWidth ? "w-full" : ""} ${containerClassName}`}>
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-on-surface mb-2">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          className={`
            w-full px-4 py-3 rounded-lg
            bg-surface-container-low border border-outline-variant
            text-on-surface placeholder:text-on-surface-variant/50
            font-body text-sm leading-normal
            transition-all duration-150
            focus:outline-none focus:ring-2 focus:ring-primary/30
            ${error ? "border-error" : ""}
            ${icon ? "pl-10" : ""}
            ${className}
          `}
          {...props}
        />
        {icon && <div className="absolute left-3 top-1/2 -translate-y-1/2">{icon}</div>}
      </div>
      {error && <p className="text-xs text-error mt-1.5 font-medium">{error}</p>}
      {hint && !error && <p className="text-xs text-on-surface-variant mt-1.5">{hint}</p>}
    </div>
  );
}
