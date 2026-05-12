"use client";

import { useEffect, useMemo, useState } from "react";

function readCollapsedIds(storageKey: string) {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function notifyCollapseUpdated(storageKey: string, collapsedIds: string[]) {
  window.queueMicrotask(() => {
    window.dispatchEvent(new CustomEvent("canvascurate:module-collapse-updated", {
      detail: { storageKey, collapsedIds },
    }));
  });
}

type ModuleCollapseAllButtonProps = {
  moduleIds: string[];
  sessionId: string;
};

export default function ModuleCollapseAllButton({
  moduleIds,
  sessionId,
}: ModuleCollapseAllButtonProps) {
  const storageKey = `canvascurate:collapsed-modules:${sessionId}`;
  const visibleModuleIds = useMemo(() => new Set(moduleIds), [moduleIds]);
  const [collapsedIds, setCollapsedIds] = useState<string[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCollapsedIds(readCollapsedIds(storageKey));
    }, 0);

    function handleCollapseUpdated(event: Event) {
      const detail = (event as CustomEvent<{ storageKey?: string; collapsedIds?: string[] }>).detail;
      if (detail?.storageKey !== storageKey) return;
      setCollapsedIds(detail.collapsedIds ?? []);
    }

    window.addEventListener("canvascurate:module-collapse-updated", handleCollapseUpdated);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("canvascurate:module-collapse-updated", handleCollapseUpdated);
    };
  }, [storageKey]);

  if (!moduleIds.length) return null;

  const visibleCollapsedCount = collapsedIds.filter((id) => visibleModuleIds.has(id)).length;
  const hasCollapsedVisibleModules = visibleCollapsedCount > 0;
  const label = hasCollapsedVisibleModules ? "Expand all modules" : "Collapse all modules";

  function updateCollapsedModules() {
    const currentIds = new Set(readCollapsedIds(storageKey));
    if (hasCollapsedVisibleModules) {
      for (const moduleId of moduleIds) {
        currentIds.delete(moduleId);
      }
    } else {
      for (const moduleId of moduleIds) {
        currentIds.add(moduleId);
      }
    }

    const nextIds = [...currentIds];
    window.localStorage.setItem(storageKey, JSON.stringify(nextIds));
    setCollapsedIds(nextIds);
    notifyCollapseUpdated(storageKey, nextIds);
  }

  return (
    <button
      type="button"
      onClick={updateCollapsedModules}
      className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low"
      aria-label={label}
      title={label}
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      >
        {hasCollapsedVisibleModules ? (
          <>
            <path d="M4 5.5 8 9.5l4-4" />
            <path d="M4 9.5 8 13.5l4-4" />
          </>
        ) : (
          <>
            <path d="M4 6.5 8 2.5l4 4" />
            <path d="M4 10.5 8 6.5l4 4" />
          </>
        )}
      </svg>
    </button>
  );
}
