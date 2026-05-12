"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";
const ACTIVE_STATUSES = new Set(["queued", "running", "retrying"]);

type PreviewStatusPage = {
  preview_asset_status?: string | null;
  original_asset?: {
    status?: string | null;
    generation_status?: string | null;
  } | null;
};

type TagFlowStatusResponse = {
  structure_preview?: {
    representative_pages?: PreviewStatusPage[];
  } | null;
  tagflow_state?: {
    pages?: PreviewStatusPage[];
  } | null;
};

function previewAssetStatus(page: PreviewStatusPage) {
  return (
    page.original_asset?.generation_status ||
    page.original_asset?.status ||
    ""
  ).toLowerCase();
}

function previewStatusSnapshot(payload: TagFlowStatusResponse) {
  const pages = payload.tagflow_state?.pages?.length
    ? payload.tagflow_state.pages
    : payload.structure_preview?.representative_pages ?? [];
  const generatedCount = pages.filter((page) => page.original_asset?.status === "generated").length;
  const activePageCount = pages.filter((page) => ACTIVE_STATUSES.has(previewAssetStatus(page))).length;
  return {
    active: activePageCount > 0,
    generatedCount,
  };
}

export default function TagFlowPreviewAutoRefresh({
  sessionId,
  documentId,
  status,
  readyCount,
  totalCount,
}: {
  sessionId: string;
  documentId: string;
  status?: string | null;
  readyCount?: number;
  totalCount?: number;
}) {
  const router = useRouter();
  const active = ACTIVE_STATUSES.has((status || "").toLowerCase());

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let inFlight = false;

    async function refreshFromBackend() {
      if (inFlight) return;
      inFlight = true;
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/tagflow`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const snapshot = previewStatusSnapshot(await res.json() as TagFlowStatusResponse);
        const backendMoved = snapshot.generatedCount > (readyCount ?? 0) || !snapshot.active;
        if (backendMoved) router.refresh();
      } catch {
        // Preview generation can briefly race deploy/runtime readiness. Keep polling
        // instead of forcing a server-component refresh into an error boundary.
      } finally {
        inFlight = false;
      }
    }

    void refreshFromBackend();
    const interval = window.setInterval(() => {
      void refreshFromBackend();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [active, documentId, readyCount, router, sessionId]);

  if (!active) return null;
  const hasProgress = typeof readyCount === "number" && typeof totalCount === "number" && totalCount > 0;
  const percent = hasProgress ? Math.max(0, Math.min(100, Math.round((readyCount / totalCount) * 100))) : 0;

  return (
    <div className="mt-5 rounded-2xl border border-primary/20 bg-primary-container/35 px-4 py-4 text-sm font-semibold text-on-surface">
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 animate-pulse rounded-full bg-primary" />
        <div>
          <div>Generating preview images</div>
          <div className="mt-1 text-xs font-medium text-on-surface-variant">
            {hasProgress ? `${readyCount} of ${totalCount} previews ready. ` : ""}
            This page will update automatically.
          </div>
        </div>
      </div>
      {hasProgress ? (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-container-lowest">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </div>
  );
}
