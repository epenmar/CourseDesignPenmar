"use client";

import { type ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  elevated?: boolean;
  interactive?: boolean;
}

export default function Card({
  children,
  className = "",
  elevated = false,
  interactive = false,
}: CardProps) {
  return (
    <div
      className={`
        bg-surface-container-lowest rounded-lg border border-outline-variant
        ${elevated ? "shadow-card" : ""}
        ${interactive ? "cursor-pointer transition-all duration-150 hover:shadow-card hover:translate-y-[-2px]" : ""}
        ${className}
      `}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  children: ReactNode;
  className?: string;
}

export function CardHeader({ children, className = "" }: CardHeaderProps) {
  return (
    <div className={`border-b border-outline-variant px-6 py-5 ${className}`}>
      {children}
    </div>
  );
}

interface CardBodyProps {
  children: ReactNode;
  className?: string;
}

export function CardBody({ children, className = "" }: CardBodyProps) {
  return <div className={`px-6 py-5 ${className}`}>{children}</div>;
}

interface CardFooterProps {
  children: ReactNode;
  className?: string;
}

export function CardFooter({ children, className = "" }: CardFooterProps) {
  return (
    <div className={`border-t border-outline-variant px-6 py-4 flex justify-end gap-3 ${className}`}>
      {children}
    </div>
  );
}
