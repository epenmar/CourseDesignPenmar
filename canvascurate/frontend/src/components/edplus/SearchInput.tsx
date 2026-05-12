"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Search, X } from "lucide-react";

interface SearchInputProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  className?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
}

export default function SearchInput({
  value: controlledValue,
  onChange,
  placeholder = "Search…",
  debounceMs = 250,
  className = "",
  autoFocus = false,
  disabled = false,
  size = "md",
}: SearchInputProps) {
  const [draftState, setDraftState] = useState(() => ({
    value: controlledValue ?? "",
    controlledValue,
  }));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (
    controlledValue !== undefined
    && controlledValue !== draftState.controlledValue
  ) {
    setDraftState({ value: controlledValue, controlledValue });
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setDraftState((current) => ({ ...current, value: next }));
    if (timerRef.current) clearTimeout(timerRef.current);
    if (debounceMs <= 0) {
      onChange(next);
      return;
    }
    timerRef.current = setTimeout(() => onChange(next), debounceMs);
  }

  function handleClear() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setDraftState((current) => ({ ...current, value: "" }));
    onChange("");
    inputRef.current?.focus();
  }

  const sizeClass = size === "sm"
    ? "h-8 pl-8 pr-8 text-xs"
    : "h-10 pl-10 pr-10 text-sm";

  const iconSize = size === "sm" ? 14 : 16;
  const value = draftState.value;

  return (
    <div className={`relative ${className}`}>
      <span
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
        aria-hidden="true"
      >
        <Search size={iconSize} />
      </span>

      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        className={`
          w-full rounded-lg border border-outline-variant
          bg-surface-container-low text-on-surface
          placeholder:text-on-surface-variant/50
          transition-all duration-150
          focus:outline-none focus:ring-2 focus:ring-primary/30
          disabled:cursor-not-allowed disabled:opacity-50
          ${sizeClass}
        `}
      />

      {value && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors rounded p-0.5"
        >
          <X size={iconSize} />
        </button>
      )}
    </div>
  );
}
