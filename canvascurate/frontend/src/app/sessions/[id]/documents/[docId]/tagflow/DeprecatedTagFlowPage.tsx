import Link from "next/link";
import { notFound } from "next/navigation";

// Deprecated full-page TagFlow implementation. This file is intentionally not
// named page.tsx, so the route is not registered; document detail now opens
// TagFlow inline from the TagFlow Pages panel. Keep this available in case the
// full-page workspace is revisited later.

import TagFlowPreviewAutoRefresh from "@/components/ui/TagFlowPreviewAutoRefresh";
import TagFlowPreviewGenerateButton from "@/components/ui/TagFlowPreviewGenerateButton";
import TagFlowStructurePreview, { type TagFlowPreviewPage } from "@/modules/tagflow/components/TagFlowStructurePreview";
import { createClient } from "@/lib/supabase/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

type PdfExportReadiness = {
  status?: string | null;
  error_count?: number | null;
  warning_count?: number | null;
  issue_count?: number | null;
  issues?: {
    code?: string | null;
    severity?: string | null;
    message?: string | null;
    page_number?: number | null;
    zone_id?: string | null;
    figure_id?: string | null;
  }[];
  checks?: Record<string, string | null>;
};

type DocumentDetailResponse = {
  document?: {
    id: string;
    title?: string | null;
    filename?: string | null;
    document_remediation?: {
      status?: string | null;
      metadata?: {
        title?: string | null;
        language?: string | null;
      };
      metadata_review?: {
        status?: string | null;
        title_set?: boolean | null;
        language_set?: boolean | null;
        language_valid?: boolean | null;
      };
      export_readiness?: PdfExportReadiness | null;
      structure_preview?: {
        status?: string | null;
        page_count?: number | null;
        representative_pages?: TagFlowPreviewPage[];
        asset_generation?: { status?: string | null; job_type?: string | null; generated_at?: string | null };
      };
      tagflow_state?: {
        status?: string | null;
        version?: number | null;
        updated_at?: string | null;
        summary?: {
          page_count?: number | null;
          reviewed_page_count?: number | null;
          edited_page_count?: number | null;
          unreviewed_page_count?: number | null;
          remediated_page_count?: number | null;
          zone_count?: number | null;
          dirty_page_count?: number | null;
          validation_issue_count?: number | null;
          needs_attention_page_count?: number | null;
          representative_page_count?: number | null;
        };
        preview_generation?: {
          status?: string | null;
          job_id?: string | null;
          stale_page_numbers?: number[];
        };
        pages?: TagFlowPreviewPage[];
        validation?: {
          status?: string | null;
          issues?: unknown[];
        };
        audit?: {
          baseline_locked?: boolean;
          baseline_source?: string | null;
          notes?: string[];
        };
      };
    } | null;
  };
};

async function getDocumentDetail(sessionId: string, documentId: string, accessToken: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status >= 500 && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        return null;
      }
      return await res.json() as DocumentDetailResponse;
    } catch {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      return null;
    }
  }
  return null;
}

function isOriginalPreviewAssetActive(page: TagFlowPreviewPage) {
  const status = (
    page.original_asset?.generation_status ||
    page.original_asset?.status ||
    ""
  ).toLowerCase();
  return status === "queued" || status === "running" || status === "retrying";
}

function exportReadinessLabel(status: string | null | undefined) {
  if (status === "ready") return "Ready";
  if (status === "not_ready") return "Blocked";
  return "Review";
}

function exportReadinessIssueHref(issue: NonNullable<PdfExportReadiness["issues"]>[number], sessionId: string, documentId: string) {
  const code = issue.code || "";
  if (code.includes("title") || code.includes("language")) {
    return `/sessions/${sessionId}/documents/${documentId}#pdf-extraction`;
  }
  if (issue.figure_id || code.includes("pdf_figure") || code.includes("pdf_flowchart")) {
    return `/sessions/${sessionId}/documents/${documentId}#pdf-figures`;
  }
  if (issue.page_number) {
    const zoneParam = issue.zone_id ? `&zone=${encodeURIComponent(issue.zone_id)}` : "";
    return `/sessions/${sessionId}/documents/${documentId}/tagflow?page=${issue.page_number}${zoneParam}#tagflow-page-${issue.page_number}`;
  }
  return `/sessions/${sessionId}/documents/${documentId}#tagflow-pages`;
}

function exportReadinessIssueAction(issue: NonNullable<PdfExportReadiness["issues"]>[number]) {
  const code = issue.code || "";
  if (code.includes("title") || code.includes("language")) return "Edit metadata";
  if (issue.figure_id || code.includes("pdf_figure") || code.includes("pdf_flowchart")) {
    return code.includes("flowchart") ? "Open builder" : "Review figure";
  }
  if (issue.page_number) return "Open page";
  return "Review";
}

export default async function DocumentTagFlowPage({
  params,
}: {
  params: Promise<{ id: string; docId: string }>;
}) {
  const { id, docId } = await params;
  const supabase = await createClient();

  const [{ data: session }, { data: auth }] = await Promise.all([
    supabase.from("sessions").select("id").eq("id", id).single(),
    supabase.auth.getSession(),
  ]);

  if (!session || !auth.session) notFound();

  const detail = await getDocumentDetail(id, docId, auth.session.access_token);
  if (!detail?.document) {
    return (
      <div className="mx-auto max-w-3xl rounded-3xl bg-surface-container-lowest p-8 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-on-surface-variant">PDF Remediation</p>
        <h1 className="mt-2 font-headline text-2xl font-extrabold text-on-surface">TagFlow is still preparing</h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          Preview generation or the document service may still be settling. Reload this page in a moment.
        </p>
        <Link
          href={`/sessions/${id}/documents/${docId}/tagflow`}
          className="mt-5 inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container"
        >
          Reload TagFlow
        </Link>
      </div>
    );
  }

  const document = detail.document;
  const preview = document.document_remediation?.structure_preview;
  const tagflowState = document.document_remediation?.tagflow_state;
  const tagflowSummary = tagflowState?.summary;
  const stalePageNumbers = new Set(tagflowState?.preview_generation?.stale_page_numbers ?? []);
  const tagflowPageByNumber = new Map((tagflowState?.pages ?? []).map((page) => [page.page_number, page]));
  const representativePages = (preview?.representative_pages ?? []).map((page) => {
    const tagflowPage = tagflowPageByNumber.get(page.page_number);
    const mergedPage = {
      ...page,
      review_status: tagflowPage?.review_status ?? page.review_status,
      validation: tagflowPage?.validation ?? page.validation,
      zones: tagflowPage?.zones ?? page.zones ?? [],
      stale_preview: tagflowPage?.stale_preview ?? page.stale_preview,
    };
    if (!stalePageNumbers.has(page.page_number) && !tagflowPage?.stale_preview) return mergedPage;
    return {
      ...mergedPage,
      original_asset: {
        ...page.original_asset,
        stale: true,
      },
    };
  });
  const representativeByNumber = new Map(representativePages.map((page) => [page.page_number, page]));
  const tagflowPages = tagflowState?.pages ?? [];
  const totalPageCount = tagflowSummary?.page_count ?? preview?.page_count ?? tagflowPages.length ?? representativePages.length;
  const allTagFlowPages = tagflowPages.length
    ? tagflowPages.map((page) => {
        const representativePage = representativeByNumber.get(page.page_number);
        const originalAsset = page.original_asset ?? representativePage?.original_asset ?? {
          status: page.preview_asset_status || "pending",
        };
        const taggedAsset = page.tagged_asset ?? representativePage?.tagged_asset ?? {
          status: "pending_working_state",
        };
        const mergedPage = {
          ...representativePage,
          ...page,
          label: representativePage?.label || page.label || `Page ${page.page_number}`,
          selection_reason: representativePage?.selection_reason || page.selection_reason || "full_document_page",
          original_asset: originalAsset,
          tagged_asset: taggedAsset,
          review_status: page.review_status ?? representativePage?.review_status,
          validation: page.validation ?? representativePage?.validation,
          zones: page.zones ?? representativePage?.zones ?? [],
          stale_preview: page.stale_preview ?? representativePage?.stale_preview,
        };
        if (!stalePageNumbers.has(page.page_number) && !page.stale_preview) return mergedPage;
        return {
          ...mergedPage,
          original_asset: {
            ...originalAsset,
            stale: true,
          },
        };
      })
    : representativePages;
  const missingPreviewPageNumbers = allTagFlowPages
    .filter((page) => page.original_asset?.status !== "generated")
    .map((page) => page.page_number);
  const activePreviewPageCount = allTagFlowPages.filter(isOriginalPreviewAssetActive).length;
  const activeOriginalPreviewStatus = activePreviewPageCount ? "running" : null;
  const generatedPreviewCount = allTagFlowPages.filter((page) => page.original_asset?.status === "generated").length;
  const metadataTitle = document.document_remediation?.metadata?.title;
  const metadataLanguage = document.document_remediation?.metadata?.language;
  const metadataReady = Boolean(
    document.document_remediation?.metadata_review?.status === "ready"
    || (metadataTitle && metadataLanguage)
  );
  const exportReadiness = document.document_remediation?.export_readiness;
  const validationIssueCount = tagflowSummary?.validation_issue_count ?? tagflowState?.validation?.issues?.length ?? 0;
  const exportReadinessStatus = exportReadiness?.status ?? (metadataReady && validationIssueCount === 0 ? "ready" : "needs_attention");
  const exportReadinessIssueCount = exportReadiness?.issue_count ?? exportReadiness?.issues?.length ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex items-center gap-2 text-xs text-on-surface-variant">
          <Link href="/dashboard" className="transition-colors hover:text-primary">Dashboard</Link>
          <span>/</span>
          <Link href={`/sessions/${id}/documents`} className="transition-colors hover:text-primary">Documents</Link>
          <span>/</span>
          <Link href={`/sessions/${id}/documents/${docId}`} className="transition-colors hover:text-primary">Detail</Link>
          <span>/</span>
          <span className="font-semibold text-on-surface">TagFlow</span>
        </nav>
        <Link
          href={`/sessions/${id}/documents/${docId}`}
          className="w-fit rounded-xl bg-surface-container-high px-4 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container"
        >
          Back to details
        </Link>
      </div>

      <section className="rounded-3xl bg-surface-container-lowest p-8 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-on-surface-variant">PDF Remediation</p>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="break-words font-headline text-3xl font-extrabold tracking-tight text-on-surface">
              TagFlow
            </h1>
            <p className="mt-2 break-words text-sm text-on-surface-variant">
              {document.title || document.filename || "Untitled document"}
            </p>
          </div>
          <span className="w-fit rounded-full border border-outline-variant/60 bg-surface-container-low px-3 py-1 text-xs font-semibold text-on-surface-variant">
            {activeOriginalPreviewStatus || preview?.status || "preview pending"}
          </span>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-2xl bg-surface-container-lowest px-5 py-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Working State</div>
          <div className="mt-2 font-headline text-2xl font-extrabold text-on-surface">{tagflowState?.status || "pending"}</div>
          <div className="text-sm text-on-surface-variant">Version {tagflowState?.version || 1}</div>
        </div>
        <div className="rounded-2xl bg-surface-container-lowest px-5 py-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Metadata</div>
          <div className={`mt-2 font-headline text-2xl font-extrabold ${metadataReady ? "text-on-surface" : "text-error"}`}>
            {metadataReady ? "Ready" : "Needed"}
          </div>
          <div className="text-sm text-on-surface-variant">
            {metadataReady ? `${metadataLanguage || "Language set"} / title set` : "Set title and language"}
          </div>
        </div>
        <div className="rounded-2xl bg-surface-container-lowest px-5 py-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Pages</div>
          <div className="mt-2 font-headline text-2xl font-extrabold text-on-surface">{allTagFlowPages.length || totalPageCount || 0}</div>
          <div className="text-sm text-on-surface-variant">{representativePages.length || tagflowSummary?.representative_page_count || 0} sample previews</div>
        </div>
        <div className="rounded-2xl bg-surface-container-lowest px-5 py-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Zones</div>
          <div className="mt-2 font-headline text-2xl font-extrabold text-on-surface">{tagflowSummary?.zone_count ?? 0}</div>
          <div className="text-sm text-on-surface-variant">
            {tagflowSummary?.edited_page_count ?? 0} edited · {tagflowSummary?.remediated_page_count ?? tagflowSummary?.reviewed_page_count ?? 0} remediated
          </div>
        </div>
        <div className="rounded-2xl bg-surface-container-lowest px-5 py-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Validation</div>
          <div className="mt-2 font-headline text-2xl font-extrabold text-on-surface">{validationIssueCount}</div>
          <div className="text-sm text-on-surface-variant">
            {tagflowSummary?.needs_attention_page_count ?? 0} pages need attention
          </div>
        </div>
        <div className="rounded-2xl bg-surface-container-lowest px-5 py-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Export</div>
          <div className={`mt-2 font-headline text-2xl font-extrabold ${exportReadinessStatus === "ready" ? "text-on-surface" : "text-error"}`}>
            {exportReadinessLabel(exportReadinessStatus)}
          </div>
          <div className="text-sm text-on-surface-variant">
            {exportReadinessIssueCount} readiness item{exportReadinessIssueCount === 1 ? "" : "s"}
          </div>
        </div>
      </section>

      <section className="rounded-3xl bg-surface-container-lowest p-6 shadow-sm">
        <div className="flex flex-col gap-3 border-b border-outline-variant/40 pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="font-headline text-xl font-bold text-on-surface">TagFlow Pages</h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              Navigate every PDF page. Pages with generated preview images can be opened for zone editing; missing previews stay behind the background job boundary.
            </p>
          </div>
          <span className="text-xs font-semibold text-on-surface-variant">
            {totalPageCount ? `${totalPageCount} pages` : "Page count pending"}
          </span>
        </div>
        <TagFlowPreviewAutoRefresh sessionId={id} documentId={docId} status={activeOriginalPreviewStatus} readyCount={generatedPreviewCount} totalCount={allTagFlowPages.length || totalPageCount || 0} />
        <TagFlowPreviewGenerateButton sessionId={id} documentId={docId} pageNumbers={missingPreviewPageNumbers} status={activeOriginalPreviewStatus} />

        {allTagFlowPages.length ? (
          <TagFlowStructurePreview
            sessionId={id}
            documentId={docId}
            pages={allTagFlowPages}
            metadataTitle={metadataTitle}
            metadataLanguage={metadataLanguage}
            autoOpenFirstEditable
          />
        ) : (
          <div className="mt-5 rounded-2xl bg-surface-container-low p-5 text-sm text-on-surface-variant">
            Run PDF review to create representative page metadata and queue preview asset generation.
          </div>
        )}

        <div className="mt-5 rounded-2xl bg-surface-container-low p-5">
          <h3 className="font-headline text-lg font-bold text-on-surface">Working-state visibility</h3>
          <p className="mt-2 text-sm text-on-surface-variant">
            TagFlow edits will update the working state, mark affected previews and validation stale, and preserve the original PDF analysis as the baseline.
          </p>
          {tagflowState?.audit?.notes?.length ? (
            <ul className="mt-3 space-y-2 text-sm text-on-surface-variant">
              {tagflowState.audit.notes.slice(0, 3).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
        {exportReadiness?.issues?.length ? (
          <div className="mt-5 rounded-2xl bg-surface-container-low p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-headline text-lg font-bold text-on-surface">Export readiness</h3>
              <span className="shrink-0 rounded-full bg-surface-container-lowest px-2 py-0.5 text-xs font-semibold text-on-surface-variant">
                {exportReadiness.issues.length} item{exportReadiness.issues.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1 text-sm">
              {exportReadiness.issues.map((issue, index) => (
                <div key={`${issue.code || "issue"}-${issue.page_number || "document"}-${index}`} className="rounded-xl bg-surface-container-lowest px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-on-surface">
                        {issue.page_number ? `Page ${issue.page_number}` : "Document"}
                      </p>
                      <p className="text-on-surface-variant">{issue.message || issue.code || "Review before export"}</p>
                    </div>
                    <Link
                      href={exportReadinessIssueHref(issue, id, docId)}
                      className="shrink-0 rounded-lg bg-surface-container-low px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-surface-container-high"
                    >
                      {exportReadinessIssueAction(issue)}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
