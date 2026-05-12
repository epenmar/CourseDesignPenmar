/**
 * PDF extraction and metadata panel for document detail.
 *
 * Displays remediation metadata, structural signals, profile heuristics, and
 * the reviewed PDF title/language controls used by export readiness.
 */

import { ChevronDown } from "lucide-react";

import Button from "@/components/edplus/Button";

type PdfMetadataDraft = {
  title: string;
  language: string;
};

type PdfProfile = {
  page_count?: number | null;
  image_count?: number | null;
  table_count?: number | null;
  font_count?: number | null;
  raw_font_count?: number | null;
  normalized_font_count?: number | null;
  normalized_font_names?: string[];
  column_signal?: string | null;
  ocr_required?: boolean | null;
  confidence?: string | null;
};

type FigureInventory = {
  figure_count?: number;
  active_figure_count?: number;
};

type RemediationPlan = {
  status?: string | null;
  metadata?: {
    title?: string | null;
    language?: string | null;
    author?: string | null;
    keywords?: string | null;
  };
  metadata_review?: {
    updated_at?: string | null;
  };
  structural_tags?: {
    has_struct_tree?: boolean;
    heading_tag_count?: number;
    structure_tag_count?: number;
    tag_names?: string[];
  };
  pdf_profile?: PdfProfile;
  recommendations?: { code: string; message: string }[];
};

export const PDF_LANGUAGE_OPTIONS = [
  { label: "English (US)", value: "en-US" },
  { label: "English", value: "en" },
  { label: "Spanish", value: "es" },
  { label: "French", value: "fr" },
  { label: "German", value: "de" },
  { label: "Chinese", value: "zh" },
  { label: "Japanese", value: "ja" },
  { label: "Korean", value: "ko" },
  { label: "Arabic", value: "ar" },
];

export const CUSTOM_PDF_LANGUAGE_VALUE = "__custom__";

export function pdfLanguageUsesCustomMode(language: string) {
  return Boolean(language) && !PDF_LANGUAGE_OPTIONS.some((option) => option.value === language);
}

type PdfExtractionPanelProps = {
  open: boolean;
  remediationPlan: RemediationPlan | null | undefined;
  figureInventory: FigureInventory | null | undefined;
  metadataReady: boolean;
  metadataDraft: PdfMetadataDraft;
  languageCustomMode: boolean;
  languageSelectValue: string;
  metadataDirty: boolean;
  savingMetadata: boolean;
  onToggle: () => void;
  onTitleChange: (title: string) => void;
  onLanguageSelectChange: (value: string) => void;
  onCustomLanguageChange: (language: string) => void;
  onSaveMetadata: () => void;
};

export default function PdfExtractionPanel({
  open,
  remediationPlan,
  figureInventory,
  metadataReady,
  metadataDraft,
  languageCustomMode,
  languageSelectValue,
  metadataDirty,
  savingMetadata,
  onToggle,
  onTitleChange,
  onLanguageSelectChange,
  onCustomLanguageChange,
  onSaveMetadata,
}: PdfExtractionPanelProps) {
  return (
    <div id="pdf-extraction" className="scroll-mt-24 rounded-3xl bg-surface-container-lowest p-5 shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <div>
          <h2 className="font-headline text-lg font-bold text-on-surface">PDF Extraction</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Metadata and structure signals for remediation planning.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="rounded-full border border-outline-variant/60 bg-surface-container-low px-3 py-1 text-xs font-semibold text-on-surface-variant">
            {remediationPlan?.status || "not run"}
          </span>
          <ChevronDown
            size={18}
            className={`text-on-surface-variant transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>
      {open && remediationPlan ? (
        <div className="mt-4 space-y-4 text-sm">
          <div className="rounded-2xl bg-surface-container-low px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-on-surface">Reviewed metadata</p>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Required before tagged-PDF export.
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${metadataReady ? "bg-secondary-container text-on-secondary-container" : "bg-error-container text-error"}`}>
                {metadataReady ? "Ready" : "Needs title/language"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <label className="block">
                <span className="text-xs font-semibold text-on-surface-variant">PDF title</span>
                <input
                  value={metadataDraft.title}
                  onChange={(event) => onTitleChange(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-outline-variant/45 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary disabled:opacity-60"
                  placeholder="Document title for PDF metadata"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-on-surface-variant">PDF language</span>
                <select
                  value={languageSelectValue}
                  onChange={(event) => onLanguageSelectChange(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-outline-variant/45 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary disabled:opacity-60"
                >
                  <option value="">Choose a language</option>
                  {PDF_LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                  <option value={CUSTOM_PDF_LANGUAGE_VALUE}>Custom language code</option>
                </select>
                {languageCustomMode ? (
                  <input
                    value={metadataDraft.language}
                    onChange={(event) => onCustomLanguageChange(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-outline-variant/45 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary disabled:opacity-60"
                    placeholder="en-US"
                  />
                ) : null}
              </label>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-on-surface-variant">
                Choose the document language. Custom values should use BCP 47-style codes such as en or en-US.
              </p>
              <Button
                type="button"
                onClick={onSaveMetadata}
                disabled={savingMetadata || !metadataDirty}
                loading={savingMetadata}
                size="sm"
                className="text-xs"
              >
                Save metadata
              </Button>
            </div>
            {remediationPlan.metadata_review?.updated_at ? (
              <p className="mt-2 text-xs text-on-surface-variant">
                Last reviewed {new Date(remediationPlan.metadata_review.updated_at).toLocaleString()}
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-2">
            {([
              ["Author", remediationPlan.metadata?.author],
              ["Keywords", remediationPlan.metadata?.keywords],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-surface-container-low px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">{label}</p>
                <p className="mt-1 break-words text-on-surface">{value || "Not detected"}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl bg-surface-container-low px-3 py-3">
            <p className="font-semibold text-on-surface">Structural tags</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              {remediationPlan.structural_tags?.has_struct_tree ? "Structure tree detected" : "No structure tree detected"} / {remediationPlan.structural_tags?.heading_tag_count ?? 0} heading tags / {remediationPlan.structural_tags?.structure_tag_count ?? 0} structure elements
            </p>
            {remediationPlan.structural_tags?.tag_names?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {remediationPlan.structural_tags.tag_names.slice(0, 10).map((tag) => (
                  <span key={tag} className="rounded-full bg-surface-container-lowest px-3 py-1 text-xs font-semibold text-on-surface-variant">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {remediationPlan.pdf_profile ? (
            <div className="rounded-2xl bg-surface-container-low px-3 py-3">
              <p className="font-semibold text-on-surface">PDF profile</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {([
                  ["Pages", remediationPlan.pdf_profile.page_count ?? "Unknown"],
                  ["Image objects", remediationPlan.pdf_profile.image_count ?? 0],
                  ["Reviewable figures", figureInventory?.active_figure_count ?? figureInventory?.figure_count ?? 0],
                  ["Tables", remediationPlan.pdf_profile.table_count ?? 0],
                  ["Fonts", remediationPlan.pdf_profile.normalized_font_count ?? remediationPlan.pdf_profile.font_count ?? 0],
                  ["OCR", remediationPlan.pdf_profile.ocr_required ? "Needed" : "Not indicated"],
                  ["Columns", remediationPlan.pdf_profile.column_signal === "possible_layout_regions" ? "Possible" : "Not detected"],
                ] as const).map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-surface-container-lowest px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">{label}</p>
                    <p className="mt-1 font-semibold text-on-surface">{value}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-on-surface-variant">
                Confidence: {remediationPlan.pdf_profile.confidence || "low"}. Font count uses normalized names
                {remediationPlan.pdf_profile.raw_font_count ? ` (${remediationPlan.pdf_profile.raw_font_count} raw font entries detected).` : "."}
              </p>
              {remediationPlan.pdf_profile.normalized_font_names?.length ? (
                <p className="mt-2 text-xs text-on-surface-variant">
                  Fonts: {remediationPlan.pdf_profile.normalized_font_names.slice(0, 6).join(", ")}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-on-surface-variant">
                Counts are heuristic until the deeper parser, OCR, or AI pass is added.
              </p>
            </div>
          ) : null}
          {remediationPlan.recommendations?.length ? (
            <div className="rounded-2xl bg-surface-container-low px-3 py-3">
              <p className="font-semibold text-on-surface">Next checks</p>
              <ul className="mt-2 space-y-1 text-xs text-on-surface-variant">
                {remediationPlan.recommendations.slice(0, 4).map((item) => (
                  <li key={item.code}>{item.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {open && !remediationPlan ? (
        <div className="mt-4 rounded-2xl bg-surface-container-low p-4 text-sm text-on-surface-variant">
          Run extraction to capture PDF title, language, author, keywords, and tag structure signals.
        </div>
      ) : null}
    </div>
  );
}
