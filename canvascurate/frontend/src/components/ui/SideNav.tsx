"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  ChartColumn,
  FileText,
  HeartPulse,
  Home,
  ImageIcon,
  Link2,
  List,
  PencilLine,
  Search,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import CanvasTokenControl from "@/components/ui/CanvasTokenControl";
import PendingReviewWidget from "@/modules/pending_review/components/PendingReviewWidget";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  iconSize?: number;
}

interface SessionNavItem extends NavItem {
  sessionHref: (id: string) => string;
}

const sessionNavItems: SessionNavItem[] = [
  { label: "Health",    href: "#", icon: HeartPulse, sessionHref: (id) => `/sessions/${id}/health` },
  { label: "Inventory", href: "#", icon: List, sessionHref: (id) => `/sessions/${id}/inventory` },
  { label: "Edit",      href: "#", icon: PencilLine, sessionHref: (id) => `/sessions/${id}/edit` },
  { label: "Images",    href: "#", icon: ImageIcon, sessionHref: (id) => `/sessions/${id}/images` },
  { label: "Links",     href: "#", icon: Link2, sessionHref: (id) => `/sessions/${id}/links` },
  { label: "Documents", href: "#", icon: FileText, sessionHref: (id) => `/sessions/${id}/documents` },
  { label: "Find & Replace", href: "#", icon: Search, iconSize: 20, sessionHref: (id) => `/sessions/${id}/find-replace` },
  { label: "Transfer",  href: "#", icon: ArrowLeftRight, sessionHref: (id) => `/sessions/${id}/transfer` },
  { label: "Reports",   href: "#", icon: ChartColumn, sessionHref: (id) => `/sessions/${id}/reports` },
];

const createSessionNavItems: SessionNavItem[] = [
  { label: "Create", href: "#", icon: Sparkles, sessionHref: (id) => `/sessions/${id}/create` },
];

const NAV_COLLAPSED_STORAGE_KEY = "canvascurate:app-nav-collapsed";
const NAV_COLLAPSED_EVENT = "canvascurate:app-nav-collapsed-changed";

function getStoredCollapsed() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(NAV_COLLAPSED_STORAGE_KEY) === "true";
}

function subscribeToCollapsed(callback: () => void) {
  window.addEventListener(NAV_COLLAPSED_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(NAV_COLLAPSED_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

interface SideNavProps {
  canvasBaseUrl?: string | null;
  sessionId?: string;
  sessionType?: string | null;
}

export default function SideNav({ canvasBaseUrl, sessionId, sessionType }: SideNavProps) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeToCollapsed, getStoredCollapsed, () => false);

  useEffect(() => {
    document.documentElement.style.setProperty("--app-nav-width", collapsed ? "72px" : "230px");
  }, [collapsed]);

  function toggleCollapsed() {
    const next = !collapsed;
    window.localStorage.setItem(NAV_COLLAPSED_STORAGE_KEY, String(next));
    window.dispatchEvent(new Event(NAV_COLLAPSED_EVENT));
  }

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  const scopedItems = sessionType === "document"
    ? sessionNavItems.filter((item) => item.label === "Documents")
    : sessionType === "create"
      ? createSessionNavItems
      : sessionNavItems;
  const navLinks = sessionId
    ? scopedItems.map((item) => ({ ...item, href: item.sessionHref(sessionId) }))
    : [];
  const DashboardIcon = Home;

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-[var(--app-nav-width)] flex-col gap-2 bg-surface-container-low p-3 transition-[width] duration-200">
      {/* Wordmark */}
      <div className={`mb-2 flex items-start gap-2 ${collapsed ? "justify-center px-0 py-4" : "justify-between px-3 py-5"}`}>
        <div className={collapsed ? "sr-only" : "min-w-0"}>
          <h1 className="truncate font-headline text-[1.05rem] font-bold text-primary">
            Canvas Curate
          </h1>
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-surface-container-high text-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-dim hover:text-primary"
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      {/* Top nav (always visible) */}
      <nav className="space-y-1">
        <Link
          href="/dashboard"
          title="Dashboard"
          className={`flex items-center rounded-lg text-sm font-medium transition-all duration-200 ${collapsed ? "justify-center px-0 py-3" : "gap-3 px-3 py-3"}
            ${isActive("/dashboard")
              ? `bg-surface-container-lowest font-semibold text-primary shadow-sm ${collapsed ? "" : "translate-x-1"}`
              : "text-on-surface-variant hover:text-primary hover:bg-surface-container"
            }`}
        >
          <DashboardIcon size={19} strokeWidth={2.2} aria-hidden="true" />
          <span className={collapsed ? "sr-only" : ""}>Dashboard</span>
        </Link>
      </nav>

      {/* Session-scoped nav */}
      {sessionId && (
        <>
          <nav className="flex-1 space-y-1 overflow-y-auto">
            {navLinks.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  title={item.label}
                  className={`flex items-center rounded-lg text-sm font-medium transition-all duration-200 ${collapsed ? "justify-center px-0 py-3" : "gap-3 px-3 py-3"}
                    ${isActive(item.href)
                      ? `bg-surface-container-lowest font-semibold text-primary shadow-sm ${collapsed ? "" : "translate-x-1"}`
                      : "text-on-surface-variant hover:text-primary hover:bg-surface-container"
                    }`}
                >
                  <Icon size={item.iconSize ?? 18} strokeWidth={2.1} aria-hidden="true" />
                  <span className={collapsed ? "sr-only" : ""}>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </>
      )}

      {!sessionId && <div className="flex-1" />}

      {sessionId || canvasBaseUrl ? (
        <div className="space-y-2 border-t border-outline-variant/20 pt-2">
          {sessionId ? (
            <PendingReviewWidget collapsed={collapsed} sessionId={sessionId} />
          ) : null}
          {canvasBaseUrl ? (
            <CanvasTokenControl canvasBaseUrl={canvasBaseUrl} collapsed={collapsed} />
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
