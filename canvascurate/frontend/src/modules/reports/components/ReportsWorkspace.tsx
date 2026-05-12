"use client";

/**
 * Reports & Downloads workspace for session-level exports and audit summaries.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ClipboardList, Download, FileArchive, FileText, History, Image, Loader2, Printer, RefreshCw, Table2, Upload } from "lucide-react";

import { Alert, Badge, Button, Card, CardBody, CardSkeleton, EmptyState, Modal, ModalBody, ModalFooter } from "@/components/edplus";
import { downloadReport, loadCourseBackupJob, loadPrintableContent, loadReportsOverview, startCourseBackup, uploadFacultyReview } from "../api/reportsClient";
import type { PrintableContentType, PrintableCourseContent, PrintableCourseItem, ReportDownloadKind, ReportDownloadOption, ReportsBackupJob, ReportsOverview } from "../types";

const CARD_STYLES: Record<string, { border: string; iconBg: string; iconText: string; cta: string }> = {
  content_inventory: {
    border: "border-primary",
    iconBg: "bg-primary/10",
    iconText: "text-primary",
    cta: "text-primary",
  },
  faculty_review: {
    border: "border-secondary",
    iconBg: "bg-secondary/10",
    iconText: "text-secondary",
    cta: "text-secondary",
  },
  transfer_report: {
    border: "border-[#1A5276]",
    iconBg: "bg-[#EBF5FB]",
    iconText: "text-[#1A5276]",
    cta: "text-[#1A5276]",
  },
  health_summary: {
    border: "border-[#E67E22]",
    iconBg: "bg-[#FEF5E7]",
    iconText: "text-[#B45F06]",
    cta: "text-[#B45F06]",
  },
  edit_history: {
    border: "border-outline",
    iconBg: "bg-surface-container-high",
    iconText: "text-on-surface-variant",
    cta: "text-on-surface-variant",
  },
};

const CARD_ICONS = {
  content_inventory: FileText,
  faculty_review: Table2,
  transfer_report: ClipboardList,
  health_summary: AlertTriangle,
  edit_history: History,
} satisfies Record<ReportDownloadKind, typeof FileText>;

const CARD_ORDER: ReportDownloadKind[] = [
  "content_inventory",
  "faculty_review",
  "edit_history",
  "health_summary",
  "transfer_report",
];

type PrintScope = "all" | "modules" | "types";

const PRINTABLE_TYPE_OPTIONS: Array<{ value: PrintableContentType; label: string }> = [
  { value: "page", label: "Pages" },
  { value: "assignment", label: "Assignments" },
  { value: "discussion", label: "Discussions" },
  { value: "quiz", label: "Quizzes" },
];

const DEFAULT_PRINT_TYPES = PRINTABLE_TYPE_OPTIONS.map((option) => option.value);

function formatDate(value?: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatJobType(value: string) {
  return value.replace(/^transfer_/, "").replaceAll("_", " ");
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function reportCount(job: ReportsOverview["latest_transfer_jobs"][number]) {
  const report = job.result?.report;
  if (!report || typeof report !== "object") return 0;
  return Object.values(report).reduce((total, value) => total + (Array.isArray(value) ? value.length : 0), 0);
}

function formatContentType(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sanitizePrintableHtml(html: string) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function normalizeMediaUrl(value?: string | null) {
  if (!value) return "";
  try {
    return new URL(value, "https://canvascurate.local").href.toLowerCase().replace(/\/$/, "");
  } catch {
    return value.trim().toLowerCase().replace(/\/$/, "");
  }
}

function canvasFileIdFromUrl(value?: string | null) {
  if (!value) return "";
  const decoded = decodeURIComponent(value);
  return (
    decoded.match(/(?:\/api\/v1)?\/(?:courses\/\d+\/)?files\/(\d+)/i)?.[1]
    ?? decoded.match(/[?&]file_id=(\d+)/i)?.[1]
    ?? decoded.match(/[?&]preview=(\d+)/i)?.[1]
    ?? ""
  );
}

function readHtmlAttribute(tag: string, name: string) {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function removeHtmlAttribute(tag: string, name: string) {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, "gi");
  return tag.replace(pattern, "");
}

function setHtmlAttribute(tag: string, name: string, value: string) {
  const cleaned = removeHtmlAttribute(tag, name);
  const close = cleaned.endsWith("/>") ? "/>" : ">";
  const body = cleaned.slice(0, cleaned.length - close.length).trimEnd();
  return `${body} ${name}="${escapeHtml(value)}"${close}`;
}

function matchingMediaReplacement(item: PrintableCourseItem, src: string) {
  const replacements = item.media_replacements ?? [];
  if (!replacements.length || !src) return null;

  const fileId = canvasFileIdFromUrl(src);
  const normalizedSrc = normalizeMediaUrl(src);
  return replacements.find((replacement) => {
    const replacementFileId = String(replacement.canvas_file_id ?? "");
    if (fileId && replacementFileId && fileId === replacementFileId) return true;
    return normalizedSrc && normalizeMediaUrl(replacement.source_url) === normalizedSrc;
  }) ?? null;
}

function embedPlaceholder(tag: string, label: string) {
  const src = readHtmlAttribute(tag, "src") || readHtmlAttribute(tag, "data-src");
  const title = readHtmlAttribute(tag, "title") || label;
  const escapedTitle = escapeHtml(title);
  const escapedSrc = escapeHtml(src);
  const link = src ? `<a href="${escapedSrc}" style="color:#1a5276;text-decoration:underline;">${escapedSrc}</a>` : "No source URL was captured.";
  return (
    `<div style="border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;padding:12px;margin:12px 0;color:#334155;">`
    + `<strong>${escapedTitle}</strong><br/><span style="font-size:12px;">Embedded content is represented as a link in printable output.</span><br/>${link}</div>`
  );
}

function printableHtml(item: PrintableCourseItem) {
  const sanitized = sanitizePrintableHtml(item.html_body);
  return sanitized
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = readHtmlAttribute(tag, "src");
      const replacement = matchingMediaReplacement(item, src);
      const printSrc = replacement?.print_src ?? "";
      if (!replacement) return tag;
      if (!printSrc) {
        const alt = readHtmlAttribute(tag, "alt") || "Canvas image";
        const source = replacement.source_url || src;
        const escapedSource = escapeHtml(source);
        return (
          `<div style="border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;padding:12px;margin:12px 0;color:#334155;">`
          + `<strong>${escapeHtml(alt)}</strong><br/><span style="font-size:12px;">Image is tracked in Canvas Curator but is not cached for printable output.</span><br/>`
          + `<a href="${escapedSource}" style="color:#1a5276;text-decoration:underline;">${escapedSource}</a></div>`
        );
      }
      return setHtmlAttribute(removeHtmlAttribute(tag, "srcset"), "src", printSrc);
    })
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (tag) => embedPlaceholder(tag, "Embedded content"))
    .replace(/<(embed|object|video)\b[^>]*>[\s\S]*?<\/\1>/gi, (tag, elementName) => embedPlaceholder(tag, `${formatContentType(String(elementName))} content`))
    .replace(/<(embed|object|video)\b[^>]*\/?>/gi, (tag, elementName) => embedPlaceholder(tag, `${formatContentType(String(elementName))} content`));
}

function printableItemKey(item: PrintableCourseItem) {
  return item.placement_id ?? item.id;
}

function filterPrintableItems(
  content: PrintableCourseContent | null,
  scope: PrintScope,
  selectedModules: string[],
  selectedTypes: PrintableContentType[],
) {
  if (!content) return [];
  if (scope === "modules") {
    if (!selectedModules.length) return [];
    return content.items.filter((item) => selectedModules.includes(item.module_name || "Not in Module"));
  }
  if (scope === "types") {
    if (!selectedTypes.length) return [];
    return content.items.filter((item) => selectedTypes.includes(item.content_type as PrintableContentType));
  }
  return content.items;
}

function PrintableCourseReport({ content, items }: { content: PrintableCourseContent | null; items: PrintableCourseItem[] }) {
  if (!content || !items.length) return null;
  return (
    <div className="reports-print-root hidden bg-white p-8 text-black print:block">
      <header className="mb-8 border-b border-slate-300 pb-4">
        <h1 className="text-2xl font-bold">{content.course.name || content.session.name || "Course Content"}</h1>
        <p className="mt-1 text-sm text-slate-700">Printable course content generated {formatDate(content.generated_at)}</p>
        {content.course.url ? <p className="mt-1 text-sm text-slate-700">{content.course.url}</p> : null}
      </header>
      <div className="space-y-8">
        {items.map((item) => (
          <section key={printableItemKey(item)} className="break-inside-avoid border-b border-slate-200 pb-6">
            <div className="mb-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
                {item.module_name || "Not in Module"} · {formatContentType(item.content_type)}
              </p>
              <h2 className="mt-1 text-xl font-bold">{item.title || "Untitled"}</h2>
              {item.canvas_url ? <p className="mt-1 text-xs text-slate-600">{item.canvas_url}</p> : null}
            </div>
            {item.html_body ? (
              <div
                className="max-w-none break-words text-sm leading-relaxed [&_img]:h-auto [&_img]:max-w-full [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:p-2 [&_th]:border [&_th]:border-slate-300 [&_th]:p-2"
                dangerouslySetInnerHTML={{ __html: printableHtml(item) }}
              />
            ) : (
              <p className="text-sm italic text-slate-600">No printable body was captured for this item.</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function PrintModal({
  content,
  loading,
  error,
  scope,
  selectedModules,
  selectedTypes,
  filteredItems,
  onClose,
  onPrint,
  onRefresh,
  onScopeChange,
  onToggleModule,
  onToggleType,
  onToggleAllModules,
  onToggleAllTypes,
}: {
  content: PrintableCourseContent | null;
  loading: boolean;
  error: string | null;
  scope: PrintScope;
  selectedModules: string[];
  selectedTypes: PrintableContentType[];
  filteredItems: PrintableCourseItem[];
  onClose: () => void;
  onPrint: () => void;
  onRefresh: () => void;
  onScopeChange: (scope: PrintScope) => void;
  onToggleModule: (moduleName: string) => void;
  onToggleType: (contentType: PrintableContentType) => void;
  onToggleAllModules: () => void;
  onToggleAllTypes: () => void;
}) {
  const moduleNames = content?.modules.map((module) => module.name) ?? [];
  const allModulesSelected = moduleNames.length > 0 && moduleNames.every((moduleName) => selectedModules.includes(moduleName));
  const allTypesSelected = DEFAULT_PRINT_TYPES.every((contentType) => selectedTypes.includes(contentType));
  const disabled = loading || Boolean(error) || !filteredItems.length;

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Print / Save as PDF"
      subtitle="Reports"
      size="full"
      className="max-h-[88vh] max-w-4xl print:hidden"
    >
      <ModalBody className="grid min-h-0 gap-0 overflow-hidden p-0 lg:grid-cols-[300px_1fr]">
          <aside className="overflow-y-auto border-b border-outline-variant/30 p-5 lg:border-b-0 lg:border-r">
            <div className="space-y-3">
              {[
                { value: "all" as const, label: "All course content", description: "Pages, assignments, discussions, and quizzes." },
                { value: "modules" as const, label: "By module", description: "Choose one or more modules." },
                { value: "types" as const, label: "By content type", description: "Choose pages, assignments, discussions, or quizzes." },
              ].map((option) => (
                <label key={option.value} className={`block cursor-pointer rounded-xl border p-3 transition-colors ${scope === option.value ? "border-primary bg-primary/5" : "border-outline-variant/30 hover:bg-surface-container-low"}`}>
                  <span className="flex items-start gap-3">
                    <input type="radio" name="printScope" checked={scope === option.value} onChange={() => onScopeChange(option.value)} className="mt-1 accent-primary" />
                    <span>
                      <span className="block text-sm font-bold text-on-surface">{option.label}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-on-surface-variant">{option.description}</span>
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {scope === "modules" ? (
              <div className="mt-5 rounded-xl border border-outline-variant/30">
                <div className="flex items-center justify-between border-b border-outline-variant/30 px-3 py-2">
                  <span className="text-xs font-bold uppercase text-on-surface-variant">{moduleNames.length} modules</span>
                  <Button type="button" variant="ghost" size="sm" onClick={onToggleAllModules} className="h-auto border-0 px-2 py-1 text-xs">
                    {allModulesSelected ? "Clear" : "Select all"}
                  </Button>
                </div>
                <div className="max-h-56 overflow-y-auto p-2">
                  {moduleNames.length ? moduleNames.map((moduleName) => (
                    <label key={moduleName} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm text-on-surface hover:bg-surface-container-low">
                      <input type="checkbox" checked={selectedModules.includes(moduleName)} onChange={() => onToggleModule(moduleName)} className="mt-1 accent-primary" />
                      <span>{moduleName}</span>
                    </label>
                  )) : <p className="px-2 py-3 text-sm text-on-surface-variant">No printable modules found.</p>}
                </div>
              </div>
            ) : null}

            {scope === "types" ? (
              <div className="mt-5 rounded-xl border border-outline-variant/30">
                <div className="flex items-center justify-between border-b border-outline-variant/30 px-3 py-2">
                  <span className="text-xs font-bold uppercase text-on-surface-variant">Content types</span>
                  <Button type="button" variant="ghost" size="sm" onClick={onToggleAllTypes} className="h-auto border-0 px-2 py-1 text-xs">
                    {allTypesSelected ? "Clear" : "Select all"}
                  </Button>
                </div>
                <div className="p-2">
                  {PRINTABLE_TYPE_OPTIONS.map((option) => (
                    <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-on-surface hover:bg-surface-container-low">
                      <input type="checkbox" checked={selectedTypes.includes(option.value)} onChange={() => onToggleType(option.value)} className="accent-primary" />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>

          <section className="min-h-0 overflow-y-auto p-5">
            {loading ? (
              <div className="flex h-64 items-center justify-center gap-3 text-on-surface-variant">
                <Loader2 size={18} className="animate-spin" />
                Loading printable content...
              </div>
            ) : error ? (
              <Alert variant="error">{error}</Alert>
            ) : (
              <>
                <div className="mb-4 flex flex-col gap-3 rounded-xl bg-surface-container-low p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-bold text-on-surface">{filteredItems.length} item{filteredItems.length === 1 ? "" : "s"} ready to print</p>
                    <p className="mt-1 text-xs text-on-surface-variant">{content?.course.name || content?.session.name || "Course content"}</p>
                  </div>
                  <Button type="button" onClick={onRefresh} variant="secondary" size="sm" icon={<RefreshCw size={14} />} className="self-start text-xs">
                    Refresh content
                  </Button>
                </div>
                <div className="space-y-3">
                  {filteredItems.length ? filteredItems.slice(0, 80).map((item) => (
                    <div key={printableItemKey(item)} className="rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-bold text-on-surface">{item.title || "Untitled"}</p>
                          <p className="mt-1 text-xs text-on-surface-variant">{item.module_name || "Not in Module"} · {formatContentType(item.content_type)}</p>
                        </div>
                        <Badge className="px-2 py-1 text-[10px] uppercase">
                          {item.html_body ? "Body captured" : "No body"}
                        </Badge>
                      </div>
                    </div>
                  )) : (
                    <EmptyState title="No matching items" description="No items match the current print selection." size="sm" className="rounded-xl bg-surface-container-low" />
                  )}
                  {filteredItems.length > 80 ? (
                    <p className="text-xs text-on-surface-variant">Showing the first 80 preview rows. The full selected set will print.</p>
                  ) : null}
                </div>
              </>
            )}
          </section>
      </ModalBody>

      <ModalFooter className="items-center justify-between bg-surface-container-low">
        <p className="text-xs text-on-surface-variant">Use the print dialog destination to save as PDF.</p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="button" disabled={disabled} onClick={onPrint} icon={<Printer size={15} />}>
            Print / Save PDF
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}

export default function ReportsWorkspace({ sessionId }: { sessionId: string }) {
  const [overview, setOverview] = useState<ReportsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<ReportDownloadKind | null>(null);
  const [uploadingFacultyReview, setUploadingFacultyReview] = useState(false);
  const [backupJob, setBackupJob] = useState<ReportsBackupJob | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printableContent, setPrintableContent] = useState<PrintableCourseContent | null>(null);
  const [printableLoading, setPrintableLoading] = useState(false);
  const [printableError, setPrintableError] = useState<string | null>(null);
  const [printScope, setPrintScope] = useState<PrintScope>("all");
  const [selectedPrintModules, setSelectedPrintModules] = useState<string[]>([]);
  const [selectedPrintTypes, setSelectedPrintTypes] = useState<PrintableContentType[]>(DEFAULT_PRINT_TYPES);
  const facultyReviewInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const nextOverview = await loadReportsOverview(sessionId);
      setOverview(nextOverview);
      setBackupJob(nextOverview.latest_backup_job ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reports");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sessionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const backupIsRunning = backupJob ? ["queued", "running", "retrying"].includes(backupJob.status) : false;
  const backupSummary = backupJob?.result?.summary;
  const backupDownloadUrl = backupJob?.status === "succeeded" ? backupSummary?.backup_download_url : "";
  const backupFilename = backupSummary?.backup_filename ?? "canvas-course-backup.imscc";
  const backupProgress = Math.round(((backupJob?.result?.progress ?? 0) as number) * 100);
  const backupAvailable = Boolean(overview?.session.source_course_id);
  const backupGeneratedAt = backupJob?.finished_at ?? backupJob?.started_at ?? backupJob?.queued_at;

  useEffect(() => {
    if (!backupJob?.id || !backupIsRunning) return;
    let cancelled = false;
    const pollBackup = async () => {
      try {
        const nextJob = await loadCourseBackupJob(sessionId, backupJob.id);
        if (cancelled) return;
        setBackupJob(nextJob);
        if (["succeeded", "failed"].includes(nextJob.status)) void load(true);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to refresh Canvas backup status");
      }
    };
    const timer = window.setInterval(() => {
      void pollBackup();
    }, 2500);
    void pollBackup();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [backupIsRunning, backupJob?.id, load, sessionId]);

  useEffect(() => {
    const clearPrintMode = () => {
      if (document.body.dataset.canvascuratePrintMode === "course-content") {
        delete document.body.dataset.canvascuratePrintMode;
      }
    };
    window.addEventListener("afterprint", clearPrintMode);
    return () => {
      window.removeEventListener("afterprint", clearPrintMode);
      clearPrintMode();
    };
  }, []);

  const summaryCards = useMemo(() => {
    if (!overview) return [];
    return [
      { label: "Content Items", value: overview.summary.content_items, icon: FileText, tone: "text-on-surface" },
      { label: "Images", value: overview.summary.images, icon: Image, tone: "text-on-surface" },
      { label: "Issues Found", value: overview.summary.issues_found, icon: AlertTriangle, tone: "text-[#E67E22]" },
      { label: "Files", value: overview.summary.files, icon: FileArchive, tone: "text-on-surface" },
    ];
  }, [overview]);

  const filteredPrintItems = useMemo(
    () => filterPrintableItems(printableContent, printScope, selectedPrintModules, selectedPrintTypes),
    [printScope, printableContent, selectedPrintModules, selectedPrintTypes],
  );

  async function handleDownload(option: ReportDownloadOption) {
    if (!option.enabled || downloading) return;
    setDownloading(option.kind);
    setMessage(null);
    setError(null);
    try {
      const { blob, filename } = await downloadReport(sessionId, option.kind);
      saveBlob(blob, filename);
      setMessage(`${option.title} downloaded.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download report");
    } finally {
      setDownloading(null);
    }
  }

  async function handleFacultyReviewUpload(file: File) {
    if (uploadingFacultyReview) return;
    setUploadingFacultyReview(true);
    setMessage(null);
    setError(null);
    try {
      const result = await uploadFacultyReview(sessionId, file);
      setMessage(
        `Faculty Review applied: ${result.image_updates} image updates, ${result.decision_updates} inventory decisions.`
        + (result.skipped_count ? ` ${result.skipped_count} row${result.skipped_count === 1 ? "" : "s"} skipped.` : ""),
      );
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload Faculty Review workbook");
    } finally {
      setUploadingFacultyReview(false);
      if (facultyReviewInputRef.current) facultyReviewInputRef.current.value = "";
    }
  }

  async function handleStartBackup() {
    if (!backupAvailable || backupBusy || backupIsRunning) return;
    setBackupBusy(true);
    setMessage(null);
    setError(null);
    try {
      const job = await startCourseBackup(sessionId);
      setBackupJob(job);
      setMessage("Canvas backup export queued.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Canvas backup");
    } finally {
      setBackupBusy(false);
    }
  }

  function handleOpenBackup() {
    if (!backupDownloadUrl) return;
    window.open(backupDownloadUrl, "_blank", "noopener,noreferrer");
  }

  async function loadPrintable(quiet = false) {
    if (!quiet) setPrintableLoading(true);
    setPrintableError(null);
    try {
      const content = await loadPrintableContent(sessionId);
      setPrintableContent(content);
      setSelectedPrintModules((current) => {
        const moduleNames = content.modules.map((module) => module.name);
        return current.filter((moduleName) => moduleNames.includes(moduleName));
      });
    } catch (err) {
      setPrintableError(err instanceof Error ? err.message : "Failed to load printable course content");
    } finally {
      setPrintableLoading(false);
    }
  }

  async function handleOpenPrintModal() {
    setPrintModalOpen(true);
    if (!printableContent && !printableLoading) await loadPrintable();
  }

  function handleTogglePrintModule(moduleName: string) {
    setSelectedPrintModules((current) => (
      current.includes(moduleName)
        ? current.filter((name) => name !== moduleName)
        : [...current, moduleName]
    ));
  }

  function handleToggleAllPrintModules() {
    if (!printableContent) return;
    const moduleNames = printableContent.modules.map((module) => module.name);
    setSelectedPrintModules((current) => (
      moduleNames.length > 0 && moduleNames.every((moduleName) => current.includes(moduleName))
        ? []
        : moduleNames
    ));
  }

  function handleTogglePrintType(contentType: PrintableContentType) {
    setSelectedPrintTypes((current) => (
      current.includes(contentType)
        ? current.filter((value) => value !== contentType)
        : [...current, contentType]
    ));
  }

  function handleToggleAllPrintTypes() {
    setSelectedPrintTypes((current) => (
      DEFAULT_PRINT_TYPES.every((contentType) => current.includes(contentType)) ? [] : DEFAULT_PRINT_TYPES
    ));
  }

  function handlePrintSelectedContent() {
    if (!filteredPrintItems.length) return;
    document.body.dataset.canvascuratePrintMode = "course-content";
    window.requestAnimationFrame(() => window.print());
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-surface px-6 py-8">
        <CardSkeleton lines={6} className="min-h-[420px]" />
      </main>
    );
  }

  if (!overview) {
    return (
      <main className="min-h-screen bg-surface px-6 py-8">
        <Alert variant="error">{error ?? "Reports could not be loaded."}</Alert>
      </main>
    );
  }

  return (
    <>
    <main className="min-h-screen bg-surface px-6 py-8 lg:px-10 print:hidden">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface">Reports</h1>
          <p className="mt-2 text-sm text-on-surface-variant">
            Export audit summaries, spreadsheets, and session activity for {overview.session.name ?? "this session"}.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          loading={refreshing}
          icon={<RefreshCw size={16} />}
          variant="secondary"
        >
          Refresh
        </Button>
      </div>

      {error ? <Alert variant="error" className="mb-4">{error}</Alert> : null}
      {message ? <Alert variant="success" className="mb-4">{message}</Alert> : null}

      <Card className="mb-8 bg-surface-container-low">
        <CardBody className="lg:p-8">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="flex flex-col">
                <span className="mb-1 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{card.label}</span>
                <div className="flex items-baseline gap-2">
                  <span className={`font-headline text-4xl font-black ${card.tone}`}>{card.value}</span>
                  <Icon size={18} className={card.tone} />
                </div>
              </div>
            );
          })}
        </div>
        </CardBody>
      </Card>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {CARD_ORDER.flatMap((kind) => overview.downloads.filter((option) => option.kind === kind)).map((option) => {
          const styles = CARD_STYLES[option.kind] ?? CARD_STYLES.edit_history;
          const Icon = CARD_ICONS[option.kind];
          const busy = downloading === option.kind;
          return (
            <Card key={option.kind} className={`flex min-h-[250px] flex-col justify-between border-l-4 p-6 lg:p-8 ${styles.border}`} elevated>
              <div>
                <div className={`mb-6 flex h-12 w-12 items-center justify-center rounded-lg ${styles.iconBg} ${styles.iconText}`}>
                  <Icon size={25} />
                </div>
                <h2 className="font-headline text-lg font-bold text-on-surface">{option.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{option.description}</p>
              </div>
              <Button
                type="button"
                disabled={!option.enabled || busy}
                loading={busy}
                icon={<Download size={15} />}
                variant="ghost"
                size="sm"
                onClick={() => void handleDownload(option)}
                className={`mt-8 self-start border-0 px-0 ${styles.cta}`}
              >
                Download .{option.format}
              </Button>
              {option.kind === "faculty_review" ? (
                <div className="mt-3">
                  <input
                    ref={facultyReviewInputRef}
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void handleFacultyReviewUpload(file);
                    }}
                  />
                  <Button
                    type="button"
                    disabled={uploadingFacultyReview}
                    loading={uploadingFacultyReview}
                    icon={<Upload size={15} />}
                    variant="ghost"
                    size="sm"
                    onClick={() => facultyReviewInputRef.current?.click()}
                    className={`self-start border-0 px-0 ${styles.cta}`}
                  >
                    Upload reviewed workbook
                  </Button>
                </div>
              ) : null}
            </Card>
          );
        })}

        <Card className="flex min-h-[250px] flex-col justify-between border-l-4 border-[#1A5276] p-6 lg:p-8">
          <div>
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-lg bg-[#EBF5FB] text-[#1A5276]">
              <FileArchive size={25} />
            </div>
            <h2 className="font-headline text-lg font-bold text-on-surface">Canvas Backup</h2>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
              Generate an IMSCC backup of the connected Canvas course for this active session.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
              Canvas export links may expire after 30 days. Generate a new backup after major course updates or when an older link no longer opens.
            </p>
            {!backupAvailable ? (
              <p className="mt-4 rounded-lg bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
                A connected source Canvas course is required before an IMSCC backup can be generated.
              </p>
            ) : null}
            {backupJob ? (
              <div className="mt-4 rounded-lg bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold capitalize text-on-surface">{backupJob.status.replaceAll("_", " ")}</span>
                  {backupIsRunning ? <span>{backupProgress}%</span> : null}
                </div>
                {backupGeneratedAt ? <p className="mt-1">Generated {formatDate(backupGeneratedAt)}</p> : null}
                {backupJob.error_message ? <p className="mt-1 text-error">{backupJob.error_message}</p> : null}
                {backupDownloadUrl ? <p className="mt-1 truncate">{backupFilename}</p> : null}
              </div>
            ) : null}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            {backupDownloadUrl ? (
              <>
                <Button
                  type="button"
                  onClick={handleOpenBackup}
                  variant="ghost"
                  size="sm"
                  icon={<Download size={15} />}
                  className="self-start border-0 px-0 text-[#1A5276]"
                >
                  Download .imscc
                </Button>
                <Button
                  type="button"
                  disabled={!backupAvailable || backupBusy || backupIsRunning}
                  loading={backupBusy || backupIsRunning}
                  icon={<RefreshCw size={15} />}
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleStartBackup()}
                  className="self-start border-0 px-0 text-on-surface-variant"
                >
                  Generate new backup
                </Button>
              </>
            ) : (
              <Button
                type="button"
                disabled={!backupAvailable || backupBusy || backupIsRunning}
                loading={backupBusy || backupIsRunning}
                icon={<Download size={15} />}
                variant="ghost"
                size="sm"
                onClick={() => void handleStartBackup()}
                className="self-start border-0 px-0 text-[#1A5276]"
              >
                Generate backup
              </Button>
            )}
          </div>
        </Card>

        <Card className="flex min-h-[250px] flex-col justify-between border-l-4 border-[#1A5276] p-6 lg:p-8">
          <div>
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-lg bg-[#EBF5FB] text-[#1A5276]">
              <Printer size={25} />
            </div>
            <h2 className="font-headline text-lg font-bold text-on-surface">Print / PDF</h2>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
              Choose all content, specific modules, or specific content types, then print or save the preview as a PDF.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => void handleOpenPrintModal()}
            className="mt-8 self-start bg-[#1A5276] text-white hover:bg-[#14425F]"
          >
            Choose what to print
          </Button>
        </Card>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardBody>
          <h2 className="font-headline text-lg font-bold text-on-surface">Recent Transfer Activity</h2>
          <div className="mt-4 space-y-3">
            {overview.latest_transfer_jobs.length ? overview.latest_transfer_jobs.map((job) => (
              <div key={job.id} className="rounded-lg border border-outline-variant/25 bg-surface-container-low px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold capitalize text-on-surface">{formatJobType(job.job_type)}</p>
                    <p className="mt-1 text-xs text-on-surface-variant">{formatDate(job.finished_at ?? job.queued_at)} · {reportCount(job)} report rows</p>
                  </div>
                  <Badge className="px-2 py-0.5 text-[10px] uppercase">{job.status}</Badge>
                </div>
              </div>
            )) : (
              <EmptyState title="No transfer jobs" description="No transfer jobs have completed for this session yet." size="sm" className="rounded-lg bg-surface-container-low" />
            )}
          </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
          <h2 className="font-headline text-lg font-bold text-on-surface">Session Activity</h2>
          <div className="mt-4 space-y-3">
            {overview.recent_events.length ? overview.recent_events.map((event) => (
              <div key={event.id} className="rounded-lg border border-outline-variant/25 bg-surface-container-low px-4 py-3">
                <p className="text-sm font-bold text-on-surface">{event.event_type.replaceAll("_", " ")}</p>
                <p className="mt-1 text-xs text-on-surface-variant">{formatDate(event.created_at)}</p>
              </div>
            )) : (
              <EmptyState title="No recent activity" description="No recent reportable activity." size="sm" className="rounded-lg bg-surface-container-low" />
            )}
          </div>
          </CardBody>
        </Card>
      </section>
    </main>
    {printModalOpen ? (
      <PrintModal
        content={printableContent}
        loading={printableLoading}
        error={printableError}
        scope={printScope}
        selectedModules={selectedPrintModules}
        selectedTypes={selectedPrintTypes}
        filteredItems={filteredPrintItems}
        onClose={() => setPrintModalOpen(false)}
        onPrint={handlePrintSelectedContent}
        onRefresh={() => void loadPrintable()}
        onScopeChange={setPrintScope}
        onToggleModule={handleTogglePrintModule}
        onToggleType={handleTogglePrintType}
        onToggleAllModules={handleToggleAllPrintModules}
        onToggleAllTypes={handleToggleAllPrintTypes}
      />
    ) : null}
    <PrintableCourseReport content={printableContent} items={filteredPrintItems} />
    <style>{`
      @media print {
        body[data-canvascurate-print-mode="course-content"] * {
          visibility: hidden !important;
        }

        body[data-canvascurate-print-mode="course-content"] .reports-print-root,
        body[data-canvascurate-print-mode="course-content"] .reports-print-root * {
          visibility: visible !important;
        }

        body[data-canvascurate-print-mode="course-content"] .reports-print-root {
          background: #ffffff !important;
          color: #000000 !important;
          display: block !important;
          left: 0 !important;
          padding: 0 !important;
          position: absolute !important;
          top: 0 !important;
          width: 100% !important;
        }
      }
    `}</style>
    </>
  );
}
