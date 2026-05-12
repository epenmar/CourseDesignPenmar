/**
 * Document detail TagFlow page strip.
 *
 * Shows prepared page previews and opens the inline TagFlow modal while
 * leaving parent state ownership unchanged.
 */

import { ChevronDown } from "lucide-react";

import Button from "@/components/edplus/Button";

type TagFlowAsset = {
  status?: string | null;
  signed_url?: string | null;
  signed_url_expires_at?: string | null;
  width?: number | null;
  height?: number | null;
  stale?: boolean | null;
} | null;

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
  review_status?: string | null;
  zone_count?: number | null;
  zones?: TagFlowZone[];
  preview_asset_status?: string | null;
  original_asset?: TagFlowAsset;
  tagged_asset?: TagFlowAsset;
  validation?: {
    status?: string | null;
    issue_count?: number | null;
  } | null;
  ai_suggestions?: {
    status?: string | null;
    zone_count?: number | null;
  } | null;
  ai_draft_applied?: {
    status?: string | null;
    zone_count?: number | null;
  } | null;
};

type TagFlowPagesPanelProps = {
  sessionId: string;
  documentId: string;
  pages: TagFlowPage[];
  visiblePages: TagFlowPage[];
  open: boolean;
  signedUrlFreshnessTimeMs: number | null;
  onToggle: () => void;
  onExpandPage: (page: TagFlowPage) => void;
  onOpenTagFlow: () => void;
  statusLabel: (status: string | null | undefined) => string;
  statusClass: (status: string | null | undefined) => string;
  pageAssetSrc: (sessionId: string, documentId: string, pageNumber: number, asset: TagFlowAsset, freshnessTimeMs: number | null) => string;
};

export default function TagFlowPagesPanel({
  sessionId,
  documentId,
  pages,
  visiblePages,
  open,
  signedUrlFreshnessTimeMs,
  onToggle,
  onExpandPage,
  onOpenTagFlow,
  statusLabel,
  statusClass,
  pageAssetSrc,
}: TagFlowPagesPanelProps) {
  return (
    <section id="tagflow-pages" className="scroll-mt-24 rounded-3xl bg-surface-container-lowest p-5 shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <div>
          <h2 className="font-headline text-xl font-bold text-on-surface">TagFlow Pages</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Click any thumbnail to preview, then toggle &quot;Tagged View&quot; to see how auto-remediation would tag the content.
          </p>
        </div>
        <ChevronDown
          size={20}
          className={`shrink-0 text-on-surface-variant transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="mt-5 overflow-x-auto pb-1">
          <div className="flex min-w-0 gap-3">
            {visiblePages.length ? visiblePages.map((page) => {
              const zoneCount = page.zone_count ?? page.zones?.length ?? page.ai_suggestions?.zone_count ?? 0;
              const validationStatus = page.validation?.status ?? (page.validation?.issue_count ? "needs_attention" : "not_run");
              return (
                <div key={page.page_number} className="w-52 shrink-0 rounded-2xl border border-outline-variant/40 bg-surface-container-low p-3">
                  <button
                    type="button"
                    onClick={() => onExpandPage(page)}
                    className="mb-3 block aspect-[4/5] w-full overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface-container-low"
                    aria-label={`Preview TagFlow page ${page.page_number}`}
                  >
                    {page.original_asset?.status === "generated" ? (
                      // eslint-disable-next-line @next/next/no-img-element -- Authenticated document previews may use signed R2 URLs or the local proxy.
                      <img
                        src={pageAssetSrc(sessionId, documentId, page.page_number, page.original_asset, signedUrlFreshnessTimeMs)}
                        alt={`Preview of PDF page ${page.page_number}`}
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center px-3 text-center">
                        <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Preview</div>
                        <div className="mt-2 font-headline text-3xl font-extrabold text-on-surface">{page.page_number}</div>
                        <div className="mt-2 text-xs text-on-surface-variant">{statusLabel(page.preview_asset_status || "pending")}</div>
                      </div>
                    )}
                  </button>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Page</div>
                      <div className="mt-1 font-headline text-2xl font-extrabold text-on-surface">{page.page_number}</div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusClass(page.review_status)}`}>
                      {statusLabel(page.review_status)}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-on-surface-variant">
                    <span className="rounded-full bg-surface-container-lowest px-2 py-1">{zoneCount} zones</span>
                    <span className={`rounded-full px-2 py-1 ${statusClass(validationStatus)}`}>
                      {statusLabel(validationStatus)}
                    </span>
                  </div>
                  {page.ai_draft_applied?.status === "applied" ? (
                    <div className="mt-3 text-xs font-semibold text-primary">AI draft applied</div>
                  ) : null}
                </div>
              );
            }) : (
              <div className="w-72 shrink-0 rounded-2xl bg-surface-container-low p-4 text-sm text-on-surface-variant">
                Run PDF review to prepare page previews and AI draft zones.
              </div>
            )}
            <Button
              type="button"
              onClick={onOpenTagFlow}
              className="h-auto w-44 shrink-0 px-4 py-5 text-center"
            >
              Open TagFlow
            </Button>
          </div>
          {pages.length > visiblePages.length ? (
            <p className="mt-3 text-xs text-on-surface-variant">
              Showing {visiblePages.length} of {pages.length} pages. Open TagFlow to move through the document.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
