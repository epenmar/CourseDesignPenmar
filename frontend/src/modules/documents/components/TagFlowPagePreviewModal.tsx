/**
 * Expanded TagFlow page preview modal for document detail.
 */

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useState } from "react";

import Button from "@/components/edplus/Button";

const TAG_COLORS: Record<string, { border: string; bg: string; labelBg: string; labelText: string }> = {
  H1: { border: "#3B82F6", bg: "#3B82F61A", labelBg: "#3B82F6", labelText: "#FFFFFF" },
  H2: { border: "#3B82F6", bg: "#3B82F61A", labelBg: "#3B82F6", labelText: "#FFFFFF" },
  H3: { border: "#60A5FA", bg: "#60A5FA1A", labelBg: "#60A5FA", labelText: "#FFFFFF" },
  H4: { border: "#60A5FA", bg: "#60A5FA1A", labelBg: "#60A5FA", labelText: "#FFFFFF" },
  H5: { border: "#93C5FD", bg: "#93C5FD1F", labelBg: "#93C5FD", labelText: "#0B1C30" },
  H6: { border: "#93C5FD", bg: "#93C5FD1F", labelBg: "#93C5FD", labelText: "#0B1C30" },
  P: { border: "#6B7280", bg: "#6B72801A", labelBg: "#6B7280", labelText: "#FFFFFF" },
  L: { border: "#22C55E", bg: "#22C55E1A", labelBg: "#22C55E", labelText: "#0B1C30" },
  LI: { border: "#22C55E", bg: "#22C55E1A", labelBg: "#22C55E", labelText: "#0B1C30" },
  Figure: { border: "#F97316", bg: "#F973161A", labelBg: "#F97316", labelText: "#FFFFFF" },
  Table: { border: "#8B5CF6", bg: "#8B5CF61A", labelBg: "#8B5CF6", labelText: "#FFFFFF" },
  TH: { border: "#8B5CF6", bg: "#8B5CF61A", labelBg: "#8B5CF6", labelText: "#FFFFFF" },
  TD: { border: "#8B5CF6", bg: "#8B5CF61A", labelBg: "#8B5CF6", labelText: "#FFFFFF" },
  TR: { border: "#8B5CF6", bg: "#8B5CF61A", labelBg: "#8B5CF6", labelText: "#FFFFFF" },
  Artifact: { border: "#9CA3AF", bg: "#9CA3AF14", labelBg: "#9CA3AF", labelText: "#0B1C30" },
  Span: { border: "#6B7280", bg: "#6B72801A", labelBg: "#6B7280", labelText: "#FFFFFF" },
};

function tagColors(tag: string | null | undefined) {
  return TAG_COLORS[tag || ""] ?? TAG_COLORS.P;
}

type TagFlowZone = {
  id?: string | null;
  tag?: string | null;
  bounds?: {
    x?: number | null;
    y?: number | null;
    width?: number | null;
    height?: number | null;
  } | null;
};

type TagFlowPage = {
  page_number: number;
  zone_count?: number | null;
  zones?: TagFlowZone[];
  preview_asset_status?: string | null;
  original_asset?: {
    status?: string | null;
  } | null;
  tagged_asset?: {
    status?: string | null;
  } | null;
  ai_draft_applied?: {
    status?: string | null;
  } | null;
};

type TagFlowPagePreviewModalProps = {
  page: TagFlowPage;
  originalImageSrc: string;
  taggedImageSrc: string;
  canGoPrevious: boolean;
  canGoNext: boolean;
  statusLabel: (status: string | null | undefined) => string;
  onPrevious: () => void;
  onNext: () => void;
  onOpenTagFlow: (pageNumber: number) => void;
  onClose: () => void;
};

export default function TagFlowPagePreviewModal({
  page,
  originalImageSrc,
  taggedImageSrc,
  canGoPrevious,
  canGoNext,
  statusLabel,
  onPrevious,
  onNext,
  onOpenTagFlow,
  onClose,
}: TagFlowPagePreviewModalProps) {
  const [view, setView] = useState<"original" | "tagged">("original");
  const activeAsset = view === "tagged" ? page.tagged_asset : page.original_asset;
  const activeImageSrc = view === "tagged" ? taggedImageSrc : originalImageSrc;
  const activeStatus = activeAsset?.status || page.preview_asset_status || "pending";
  const zones = page.zones ?? [];
  const originalGenerated = page.original_asset?.status === "generated";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/55 px-4 py-8" role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-surface-container-lowest shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant/40 px-5 py-4">
          <div>
            <h2 className="font-headline text-xl font-bold text-on-surface">TagFlow</h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              Page {page.page_number} / {page.zone_count ?? page.zones?.length ?? 0} zones
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={onPrevious}
              disabled={!canGoPrevious}
              variant="ghost"
              size="sm"
              icon={<ChevronLeft size={18} />}
              className="h-9 w-9 rounded-full p-0 text-on-surface-variant"
              aria-label="Previous TagFlow page"
            >
              <span className="sr-only">Previous TagFlow page</span>
            </Button>
            <Button
              type="button"
              onClick={onNext}
              disabled={!canGoNext}
              variant="ghost"
              size="sm"
              icon={<ChevronRight size={18} />}
              className="h-9 w-9 rounded-full p-0 text-on-surface-variant"
              aria-label="Next TagFlow page"
            >
              <span className="sr-only">Next TagFlow page</span>
            </Button>
            <Button
              type="button"
              onClick={onClose}
              variant="ghost"
              size="sm"
              icon={<X size={18} />}
              className="h-9 w-9 rounded-full p-0 text-on-surface-variant"
              aria-label="Close TagFlow"
            >
              <span className="sr-only">Close TagFlow</span>
            </Button>
          </div>
        </div>
        <div className="border-b border-outline-variant/40 px-5 py-3">
          <div className="inline-flex rounded-xl bg-surface-container-low p-1">
            {(["original", "tagged"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  view === option
                    ? "bg-surface-container-lowest text-on-surface shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {option === "original" ? "Original" : "Tagged View"}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 overflow-auto bg-surface-container-low p-4">
          <div className="flex min-h-[50vh] items-center justify-center">
            {view === "tagged" && originalGenerated ? (
              <div className="relative inline-block max-h-[72vh] max-w-full overflow-auto rounded-2xl border border-outline-variant/40 bg-surface-container-lowest">
                {/* eslint-disable-next-line @next/next/no-img-element -- Authenticated document previews may use signed R2 URLs or the local proxy. */}
                <img
                  src={originalImageSrc}
                  alt={`Tagged preview of PDF page ${page.page_number}`}
                  className="block max-h-[72vh] max-w-full object-contain"
                />
                <div className="pointer-events-none absolute inset-0">
                  {zones.map((zone, index) => {
                    const colors = tagColors(zone.tag);
                    return (
                      <div
                        key={zone.id || `${page.page_number}-${index}`}
                        className="absolute border-2"
                        style={{
                          left: `${zone.bounds?.x ?? 0}%`,
                          top: `${zone.bounds?.y ?? 0}%`,
                          width: `${zone.bounds?.width ?? 0}%`,
                          height: `${zone.bounds?.height ?? 0}%`,
                          borderColor: colors.border,
                          backgroundColor: colors.bg,
                        }}
                      >
                        <span
                          className="absolute left-0 top-0 -translate-y-full rounded px-1.5 py-0.5 text-[10px] font-bold shadow-sm"
                          style={{
                            backgroundColor: colors.labelBg,
                            color: colors.labelText,
                          }}
                        >
                          {index + 1}. {zone.tag || "P"}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {!zones.length ? (
                  <div className="absolute inset-x-3 bottom-3 rounded-xl bg-surface-container-lowest/90 px-3 py-2 text-center text-xs font-semibold text-on-surface-variant shadow-sm">
                    No saved zones are available for this page yet.
                  </div>
                ) : null}
              </div>
            ) : activeAsset?.status === "generated" ? (
              // eslint-disable-next-line @next/next/no-img-element -- Authenticated document previews may use signed R2 URLs or the local proxy.
              <img
                src={activeImageSrc}
                alt={`${view === "tagged" ? "Tagged" : "Original"} preview of PDF page ${page.page_number}`}
                className="max-h-[72vh] w-auto max-w-full rounded-2xl border border-outline-variant/40 bg-surface-container-lowest object-contain"
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-outline-variant/60 bg-surface-container-lowest px-10 py-16 text-center">
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">
                  {view === "tagged" ? "Tagged view pending" : "Preview pending"}
                </div>
                <div className="mt-3 font-headline text-5xl font-extrabold text-on-surface">{page.page_number}</div>
                <p className="mt-3 text-sm text-on-surface-variant">{statusLabel(activeStatus)}</p>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-outline-variant/40 px-5 py-4 text-sm text-on-surface-variant sm:flex-row sm:items-center sm:justify-between">
          <div>
            {page.ai_draft_applied?.status === "applied"
              ? "AI draft zones are applied. Use Tagged View to inspect the generated structure."
              : "Use Tagged View to inspect generated zones as they become available."}
          </div>
          <Button
            type="button"
            onClick={() => onOpenTagFlow(page.page_number)}
          >
            Open TagFlow
          </Button>
        </div>
      </div>
    </div>
  );
}
