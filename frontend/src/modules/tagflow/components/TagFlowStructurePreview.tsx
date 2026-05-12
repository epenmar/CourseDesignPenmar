"use client";

/**
 * Full-page TagFlow PDF structure editor.
 *
 * Manages page navigation, preview overlays, editable PDF tag zones, AI
 * suggestion review, figure text review, and per-page layout hints.
 */

import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent, type Ref } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, HelpCircle } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import Tooltip from "@/components/ui/Tooltip";
import {
  CUSTOM_PDF_LANGUAGE_VALUE,
  PDF_LANGUAGE_OPTIONS,
  pdfLanguageUsesCustomMode,
} from "@/modules/documents/components/PdfExtractionPanel";
import FlowchartBuilderModal from "@/modules/tagflow/components/FlowchartBuilderModal";
import FlowchartVisualAnnotator from "@/modules/tagflow/components/FlowchartVisualAnnotator";
import type { FlowchartConnection, FlowchartNode, FlowchartStructure } from "@/modules/tagflow/types";
import { flowchartGuidanceFromStructure, normalizeFlowchartStructure } from "@/modules/tagflow/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";
const TAG_OPTIONS = ["H1", "H2", "H3", "H4", "H5", "H6", "P", "L", "LI", "Figure", "Table", "TH", "TD", "TR", "Artifact", "Span"];
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
const TAG_SHORTCUTS: Record<string, string> = {
  "1": "H1",
  "2": "H2",
  "3": "H3",
  "4": "H4",
  "5": "H5",
  "6": "H6",
  p: "P",
  l: "L",
  i: "LI",
  f: "Figure",
  t: "Table",
  a: "Artifact",
  d: "Artifact",
  s: "Span",
};
const MIN_DRAWN_ZONE_SIZE = 1.5;
const COLLAPSED_PAGE_LIMIT = 8;
const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const TAGFLOW_LAYOUT_OPTIONS: { value: TagFlowLayoutValue; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "single_column", label: "Single column" },
  { value: "two_column", label: "Two column" },
  { value: "three_column", label: "Three column" },
];

function isArtifactZone(zone: { tag?: string | null }) {
  return zone.tag === "Artifact";
}

function tagDisplayLabel(tag: string) {
  return tag === "Artifact" ? "Artifact / Decorative" : tag;
}

function tagColors(tag: string | null | undefined) {
  return TAG_COLORS[tag || ""] ?? TAG_COLORS.P;
}

type PreviewAsset = {
  status?: string | null;
  generation_status?: string | null;
  stale?: boolean | null;
  width?: number | null;
  height?: number | null;
  signed_url?: string | null;
  signed_url_expires_at?: string | null;
};

type TagFlowValidationIssue = {
  code?: string | null;
  severity?: string | null;
  message?: string | null;
  page_number?: number | null;
  zone_id?: string | null;
};

type TagFlowPageValidation = {
  status?: string | null;
  issue_count?: number | null;
  issues?: TagFlowValidationIssue[];
  validated_at?: string | null;
};

type TagFlowLayoutValue = "auto" | "single_column" | "two_column" | "three_column";

type TagFlowLayoutHint = {
  value?: TagFlowLayoutValue | null;
  source?: string | null;
  updated_at?: string | null;
};

export type TagFlowPreviewPage = {
  page_number: number;
  source_page_number?: number | null;
  export_order?: number | null;
  omitted?: boolean | null;
  label?: string | null;
  selection_reason?: string | null;
  status?: string | null;
  review_status?: string | null;
  preview_asset_status?: string | null;
  is_representative?: boolean | null;
  original_asset?: PreviewAsset | null;
  tagged_asset?: PreviewAsset | null;
  stale_preview?: boolean | null;
  zones?: TagFlowZone[];
  text_blocks?: TagFlowTextBlock[];
  text_sample?: string | null;
  image_blocks?: TagFlowImageBlock[];
  figure_candidates?: TagFlowFigureCandidate[];
  ai_suggestions?: TagFlowAISuggestions | null;
  layout_hint?: TagFlowLayoutHint | null;
  effective_layout_hint?: TagFlowLayoutValue | null;
  diagnostics?: {
    likely_ocr_gap?: boolean | null;
    decorative_image_count?: number | null;
    image_fragment_count?: number | null;
  } | null;
  validation?: TagFlowPageValidation | null;
};

type TagFlowAISuggestions = {
  status?: string | null;
  job_id?: string | null;
  generated_at?: string | null;
  error_message?: string | null;
  zone_count?: number | null;
  zones?: TagFlowZone[];
};

type TagFlowDetailResponse = {
  tagflow_state?: {
    pages?: TagFlowPreviewPage[];
  } | null;
};

type BackgroundJobResponse = {
  id: string;
  status?: string | null;
  error_message?: string | null;
};

type TagFlowTextBlock = {
  id?: string | null;
  text?: string | null;
  bounds?: {
    x?: number | null;
    y?: number | null;
    width?: number | null;
    height?: number | null;
  } | null;
  reading_order?: number | null;
  font_size?: number | null;
  font_names?: string[] | null;
  bold?: boolean | null;
  confidence?: number | null;
};

type TagFlowImageBlock = {
  id?: string | null;
  bounds?: TagFlowBounds | null;
  decorative_likely?: boolean | null;
  area_ratio?: number | null;
};

type TagFlowFigureCandidate = {
  id?: string | null;
  bounds?: TagFlowBounds | null;
  fragment_count?: number | null;
  decorative_likely?: boolean | null;
  needs_alt_text?: boolean | null;
  confidence?: number | null;
  area_ratio?: number | null;
  source?: string | null;
  figure_inventory_id?: string | null;
  figure_status?: string | null;
  review_action?: "keep" | "ignore" | null;
  is_decorative?: boolean | null;
  has_alt_text?: boolean | null;
  has_long_description?: boolean | null;
  alt_text?: string | null;
  long_description?: string | null;
  figure_type?: "image" | "diagram" | "flowchart" | null;
  flowchart_guidance?: string | null;
  flowchart?: TagFlowFlowchartStructure | null;
  full_page_likely?: boolean | null;
};

type TagFlowBounds = {
  x?: number | null;
  y?: number | null;
  width?: number | null;
  height?: number | null;
};

type TagFlowFlowchartNode = FlowchartNode;
type TagFlowFlowchartConnection = FlowchartConnection;
type TagFlowFlowchartStructure = FlowchartStructure;

export type TagFlowZone = {
  id: string;
  tag: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  reading_order: number;
  source?: string | null;
  confidence?: number | null;
  evidence_type?: string | null;
  evidence_ids?: string[] | null;
  figure_candidate_id?: string | null;
  figure_inventory_id?: string | null;
  figure_status?: string | null;
  figure_review_action?: "keep" | "ignore" | null;
  figure_is_decorative?: boolean | null;
  figure_has_alt_text?: boolean | null;
  figure_has_long_description?: boolean | null;
  alt_text?: string | null;
  long_description?: string | null;
  figure_type?: "image" | "diagram" | "flowchart" | null;
  flowchart_guidance?: string | null;
  flowchart?: TagFlowFlowchartStructure | null;
  note?: string | null;
};

type EditableZone = {
  id: string;
  tag: string;
  x: number;
  y: number;
  width: number;
  height: number;
  reading_order: number;
  source?: string | null;
  confidence?: number | null;
  evidence_type?: string | null;
  evidence_ids?: string[] | null;
  figure_candidate_id?: string | null;
  figure_inventory_id?: string | null;
  figure_status?: string | null;
  figure_review_action?: "keep" | "ignore" | null;
  figure_is_decorative?: boolean | null;
  figure_has_alt_text?: boolean | null;
  figure_has_long_description?: boolean | null;
  alt_text?: string | null;
  long_description?: string | null;
  figure_type?: "image" | "diagram" | "flowchart" | null;
  flowchart_guidance?: string | null;
  flowchart?: TagFlowFlowchartStructure | null;
  note?: string | null;
};

function evidenceLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    text_block: "Text",
    font_signal: "Font",
    existing_tag: "Existing tag",
    figure_candidate: "Figure",
    table_signal: "Table",
    layout_signal: "Layout",
  };
  return labels[value || ""] || "Evidence";
}

type DraftZone = {
  startX: number;
  startY: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type DragState = {
  zoneId: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type ResizeState = {
  zoneId: string;
  startX: number;
  startY: number;
  originWidth: number;
  originHeight: number;
};

type ReadingOrderDropTarget = {
  zoneId: string;
  position: "before" | "after";
};

type MarqueeSelection = DraftZone & {
  additive: boolean;
  initialSelectedIds: string[];
};

type OverlayBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type PreviewMode = "original" | "tagged";

async function parseApiError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return body.detail ?? fallback;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function reasonLabel(value: string | null | undefined) {
  if (value === "opening_structure") return "Opening page sample";
  if (value === "mid_document_structure") return "Middle page sample";
  if (value === "closing_structure") return "Closing page sample";
  if (value === "full_document_page") return "Full document page";
  return "Representative structure sample";
}

function assetSrc(
  sessionId: string,
  documentId: string,
  pageNumber: number,
  variant: "original" | "tagged",
  asset?: PreviewAsset | null,
) {
  if (asset?.signed_url) return asset.signed_url;
  return `/api/session-documents/${sessionId}/${documentId}/tagflow/pages/${pageNumber}/asset?variant=${variant}`;
}

function zoneImageSrc(
  sessionId: string,
  documentId: string,
  pageNumber: number,
  zone: { x: number; y: number; width: number; height: number }
) {
  const params = new URLSearchParams({
    x: String(zone.x),
    y: String(zone.y),
    width: String(zone.width),
    height: String(zone.height),
  });
  return `/api/session-documents/${sessionId}/${documentId}/tagflow/pages/${pageNumber}/zone-image?${params.toString()}`;
}

function StatusPill({ label, status }: { label: string; status?: string | null }) {
  return (
    <span className="rounded-full bg-surface-container-lowest px-3 py-1 text-on-surface-variant">
      {label}: {status || "pending"}
    </span>
  );
}

function assetStatusLabel(asset: PreviewAsset | null | undefined) {
  if (asset?.stale) return "stale";
  if (asset?.generation_status === "queued" || asset?.generation_status === "running" || asset?.generation_status === "retrying") return asset.generation_status;
  return asset?.status || "pending";
}

function isAssetActive(asset: PreviewAsset | null | undefined) {
  const status = assetStatusLabel(asset).toLowerCase();
  return status === "queued" || status === "running" || status === "retrying";
}

function normalizePageStatus(status: string | null | undefined) {
  const value = (status || "").toLowerCase();
  if (["remediated", "reviewed", "complete", "completed"].includes(value)) return "remediated";
  if (["edited", "needs_review", "needs-work", "needs_work", "in_review"].includes(value)) return "edited";
  return "unreviewed";
}

function pageStatusLabel(status: string | null | undefined) {
  const normalized = normalizePageStatus(status);
  if (normalized === "remediated") return "Remediated";
  if (normalized === "edited") return "Edited";
  return "Unreviewed";
}

function pageStatusClass(status: string | null | undefined) {
  const normalized = normalizePageStatus(status);
  if (normalized === "remediated") return "bg-tertiary-container text-on-tertiary-container";
  if (normalized === "edited") return "bg-secondary-container text-on-secondary-container";
  return "bg-surface-container-high text-on-surface-variant";
}

function validationIssueCount(validation: TagFlowPageValidation | null | undefined) {
  return validation?.issue_count ?? validation?.issues?.length ?? 0;
}

function validationStatusLabel(validation: TagFlowPageValidation | null | undefined) {
  if (!validation || validation.status === "not_run") return "Not checked";
  if (validation.status === "needs_attention") return `${validationIssueCount(validation)} issue${validationIssueCount(validation) === 1 ? "" : "s"}`;
  if (validation.status === "passed") return "No issues";
  return validation.status || "Not checked";
}

function validationStatusClass(validation: TagFlowPageValidation | null | undefined) {
  if (validation?.status === "needs_attention") return "bg-error-container text-error";
  if (validation?.status === "passed") return "bg-tertiary-container text-on-tertiary-container";
  return "bg-surface-container-high text-on-surface-variant";
}

function normalizeLayoutHint(value: unknown): TagFlowLayoutValue {
  return value === "single_column" || value === "two_column" || value === "three_column" ? value : "auto";
}

function layoutHintLabel(value: unknown) {
  const normalized = normalizeLayoutHint(value);
  return TAGFLOW_LAYOUT_OPTIONS.find((option) => option.value === normalized)?.label ?? "Auto-detect";
}

function validateEditableZones(zones: EditableZone[], page?: TagFlowPreviewPage | null): TagFlowValidationIssue[] {
  const issues: TagFlowValidationIssue[] = [];
  const contentZones = zones.filter((zone) => !isArtifactZone(zone));
  const zoneLabel = (zone: EditableZone, index: number) => `Zone ${zone.reading_order > 0 ? zone.reading_order : index + 1}`;
  if (!zones.length) {
    issues.push({ code: "page_has_no_zones", severity: "warning", message: "No zones have been defined for this page." });
  }
  const readingOrders = contentZones.map((zone) => zone.reading_order).sort((a, b) => a - b);
  const expectedOrders = contentZones.map((_, index) => index + 1);
  if (contentZones.length && readingOrders.some((order, index) => order !== expectedOrders[index])) {
    issues.push({ code: "reading_order_sequence", severity: "warning", message: "Content reading order should be a complete sequence starting at 1. Artifacts are skipped." });
  }
  zones.forEach((zone, index) => {
    const label = zoneLabel(zone, index);
    if (zone.width < 2 || zone.height < 2) {
      issues.push({ code: "tiny_zone", severity: "warning", message: `${label} is very small and may be hard to review.`, zone_id: zone.id });
    }
    if (zone.x < 0 || zone.y < 0 || zone.x + zone.width > 100 || zone.y + zone.height > 100) {
      issues.push({ code: "zone_out_of_bounds", severity: "error", message: `${label} extends outside the page bounds.`, zone_id: zone.id });
    }
    if (zone.tag === "Figure") {
      const candidate = bestFigureCandidateForZone(page, zone);
      const hasZoneAltText = Boolean((zone.alt_text || "").trim());
      if (!candidate) {
        if (!hasZoneAltText) {
          issues.push({ code: "figure_zone_unbound", severity: "warning", message: `${label} is tagged as a Figure but is not linked to a reviewed figure candidate.`, zone_id: zone.id });
        }
      } else if (candidate.review_action === "ignore" || candidate.figure_status === "ignored") {
        issues.push({ code: "figure_zone_ignored", severity: "warning", message: `${label} is linked to a figure that was ignored in the figure panel.`, zone_id: zone.id });
      } else if (candidate.is_decorative || candidate.figure_status === "decorative") {
        issues.push({ code: "decorative_figure_zone", severity: "warning", message: `${label} is linked to a decorative figure; mark it as an Artifact unless it needs alternate text.`, zone_id: zone.id });
      } else if (!candidate.has_alt_text && !hasZoneAltText) {
        issues.push({ code: "figure_zone_missing_alt_text", severity: "warning", message: `${label} is linked to a figure that still needs alt text.`, zone_id: zone.id });
      }
    }
  });
  for (let firstIndex = 0; firstIndex < zones.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < zones.length; secondIndex += 1) {
      const first = zones[firstIndex];
      const second = zones[secondIndex];
      const overlapWidth = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
      const overlapHeight = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
      const overlapArea = overlapWidth * overlapHeight;
      const smallerArea = Math.min(first.width * first.height, second.width * second.height);
      if (smallerArea > 0 && overlapArea / smallerArea >= 0.35) {
        issues.push({ code: "overlapping_zones", severity: "warning", message: `${zoneLabel(first, firstIndex)} and ${zoneLabel(second, secondIndex)} overlap substantially.` });
        break;
      }
    }
  }
  let highestHeadingSeen = 0;
  zones.slice().sort((a, b) => a.reading_order - b.reading_order).forEach((zone) => {
    if (!/^H[1-6]$/.test(zone.tag)) return;
    const level = Number(zone.tag.slice(1));
    const originalIndex = Math.max(0, zones.findIndex((item) => item.id === zone.id));
    const label = zoneLabel(zone, originalIndex);
    if (level > 1 && highestHeadingSeen === 0) {
      issues.push({ code: "heading_without_parent", severity: "warning", message: `${label} starts with ${zone.tag} before an H1 or parent heading.`, zone_id: zone.id });
    } else if (highestHeadingSeen && level > highestHeadingSeen + 1) {
      issues.push({ code: "heading_level_jump", severity: "warning", message: `${label} jumps from H${highestHeadingSeen} to ${zone.tag}.`, zone_id: zone.id });
    }
    highestHeadingSeen = level;
  });
  return issues;
}

function overlapRatio(first: { x: number; y: number; width: number; height: number }, second: { x: number; y: number; width: number; height: number }) {
  const overlapWidth = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
  const overlapHeight = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
  const overlapArea = overlapWidth * overlapHeight;
  const smallerArea = Math.min(first.width * first.height, second.width * second.height);
  if (smallerArea <= 0) return 0;
  return overlapArea / smallerArea;
}

function extractedTextForZones(page: TagFlowPreviewPage | null, zones: EditableZone[]) {
  if (!page || !zones.length) return [];
  const blocks = page.text_blocks ?? [];
  return blocks
    .map((block) => {
      const bounds = block.bounds;
      if (!bounds) return null;
      const blockBox = {
        x: Number(bounds.x ?? 0),
        y: Number(bounds.y ?? 0),
        width: Number(bounds.width ?? 0),
        height: Number(bounds.height ?? 0),
      };
      const score = Math.max(0, ...zones.map((zone) => overlapRatio(zone, blockBox)));
      if (score < 0.08) return null;
      return { ...block, overlap_score: score };
    })
    .filter((block): block is TagFlowTextBlock & { overlap_score: number } => Boolean(block))
    .sort((first, second) => (first.reading_order ?? 0) - (second.reading_order ?? 0));
}

function figureCandidatesForZones(page: TagFlowPreviewPage | null, zones: EditableZone[]) {
  if (!page || !zones.length) return [];
  const candidates = page.figure_candidates ?? [];
  return candidates
    .map((candidate) => {
      const bounds = candidate.bounds;
      if (!bounds) return null;
      const candidateBox = {
        x: Number(bounds.x ?? 0),
        y: Number(bounds.y ?? 0),
        width: Number(bounds.width ?? 0),
        height: Number(bounds.height ?? 0),
      };
      const score = Math.max(0, ...zones.map((zone) => overlapRatio(zone, candidateBox)));
      if (score < 0.08) return null;
      return { ...candidate, overlap_score: score };
    })
    .filter((candidate): candidate is TagFlowFigureCandidate & { overlap_score: number } => Boolean(candidate))
    .sort((first, second) => second.overlap_score - first.overlap_score);
}

function bestFigureCandidateForZone(page: TagFlowPreviewPage | null | undefined, zone: EditableZone) {
  if (!page || zone.tag !== "Figure") return null;
  const explicitId = zone.figure_candidate_id || zone.evidence_ids?.find((id) => id.startsWith("figure-"));
  const explicitCandidate = page.figure_candidates?.find((candidate) => candidate.id && candidate.id === explicitId);
  if (explicitCandidate) return { ...explicitCandidate, overlap_score: 1 };
  return figureCandidatesForZones(page, [zone])[0] ?? null;
}

function bindEditableFigureZone(page: TagFlowPreviewPage | null | undefined, zone: EditableZone): EditableZone {
  if (zone.tag !== "Figure") return zone;
  const candidate = bestFigureCandidateForZone(page, zone);
  if (!candidate?.id) return zone;
  const evidenceIds = [candidate.id, ...(zone.evidence_ids ?? []).filter((id) => id !== candidate.id)];
  return {
    ...zone,
    evidence_type: "figure_candidate",
    evidence_ids: evidenceIds.slice(0, 12),
    figure_candidate_id: candidate.id,
    figure_inventory_id: candidate.figure_inventory_id ?? zone.figure_inventory_id,
    figure_status: candidate.figure_status ?? zone.figure_status,
    figure_review_action: candidate.review_action ?? zone.figure_review_action,
    figure_is_decorative: candidate.is_decorative ?? zone.figure_is_decorative,
    figure_has_alt_text: candidate.has_alt_text ?? zone.figure_has_alt_text,
    figure_has_long_description: candidate.has_long_description ?? zone.figure_has_long_description,
  };
}

function figureCandidateOverrideKey(pageNumber: number | null | undefined, candidateId: string | null | undefined) {
  return pageNumber && candidateId ? `${pageNumber}:${candidateId}` : null;
}

function withFigureCandidateOverrides(page: TagFlowPreviewPage | null, overrides: Record<string, Partial<TagFlowFigureCandidate>>) {
  if (!page?.figure_candidates?.length) return page;
  return {
    ...page,
    figure_candidates: page.figure_candidates.map((candidate) => {
      const key = figureCandidateOverrideKey(page.page_number, candidate.id);
      return key && overrides[key] ? { ...candidate, ...overrides[key] } : candidate;
    }),
  };
}

function withPageLayoutOverride(page: TagFlowPreviewPage | null, overrides: Record<number, Partial<TagFlowPreviewPage>>) {
  if (!page) return page;
  const override = overrides[page.page_number];
  return override ? { ...page, ...override } : page;
}

function figureCandidateStatusLabel(candidate: TagFlowFigureCandidate) {
  if (candidate.review_action === "ignore" || candidate.figure_status === "ignored") return "Ignored in figure panel";
  if (candidate.is_decorative || candidate.figure_status === "decorative") return "Decorative / artifact";
  if (candidate.has_alt_text || candidate.figure_status === "reviewed") return "Alt text reviewed";
  if (candidate.needs_alt_text) return "Needs alt text";
  if (candidate.decorative_likely) return "Likely decorative";
  return "Figure candidate";
}

function figureCandidateType(value: unknown): "image" | "diagram" | "flowchart" {
  return value === "diagram" || value === "flowchart" ? value : "image";
}

function flowchartGuidanceForZone(zone: EditableZone) {
  return flowchartGuidanceFromStructure(zone.flowchart, zone.flowchart_guidance ?? "");
}

function figureCandidateDismissKey(pageNumber: number | null | undefined, candidateId: string | null | undefined) {
  return pageNumber && candidateId ? `${pageNumber}:${candidateId}` : null;
}

function PreviewFrame({
  sessionId,
  documentId,
  page,
  variant,
  large = false,
  canvas = false,
  imageRef,
  onImageLoad,
}: {
  sessionId: string;
  documentId: string;
  page: TagFlowPreviewPage;
  variant: "original" | "tagged";
  large?: boolean;
  canvas?: boolean;
  imageRef?: Ref<HTMLImageElement>;
  onImageLoad?: () => void;
}) {
  const asset = variant === "original" ? page.original_asset : page.tagged_asset;
  const generated = asset?.status === "generated";
  const active = isAssetActive(asset);
  const frameClass = canvas ? "aspect-[3/4]" : large ? "h-[70vh] max-h-[720px] min-h-[420px]" : "aspect-[3/4]";
  const frameStyle = canvas && asset?.width && asset.height ? { aspectRatio: `${asset.width} / ${asset.height}` } : undefined;
  if (!generated) {
    return (
      <div
        className={`${frameClass} rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-lowest p-4`}
        style={frameStyle}
      >
        <div className="flex h-full flex-col items-center justify-center text-center">
          {active ? (
            <span className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
          ) : null}
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">{variant}</p>
          <p className="mt-2 font-headline text-4xl font-extrabold text-on-surface">{page.page_number}</p>
          <p className="mt-3 text-xs text-on-surface-variant">
            {active ? "Preview image is being generated" : variant === "tagged" ? "Tagged preview pending TagFlow edits" : "Preview asset pending"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${frameClass} relative overflow-hidden rounded-xl border border-outline-variant/50 bg-surface-container-lowest`}
      style={frameStyle}
    >
      {asset?.stale ? (
        <span className="absolute left-3 top-3 rounded-full bg-secondary-container px-3 py-1 text-xs font-bold text-on-secondary-container shadow-sm">
          Stale
        </span>
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- Authenticated document previews are served through the local API proxy. */}
      <img
        ref={imageRef}
        src={assetSrc(sessionId, documentId, page.page_number, variant, asset)}
        alt={`${variant === "original" ? "Original" : "Tagged"} preview for page ${page.page_number}`}
        className="h-full w-full object-contain"
        onLoad={onImageLoad}
      />
    </div>
  );
}

function LiveOverlayPreview({
  sessionId,
  documentId,
  page,
  showOverlay,
}: {
  sessionId: string;
  documentId: string;
  page: TagFlowPreviewPage;
  showOverlay: boolean;
}) {
  if (page.original_asset?.status !== "generated") {
    return <PreviewFrame sessionId={sessionId} documentId={documentId} page={page} variant="original" large />;
  }

  return (
    <div className="flex min-h-[420px] max-h-[720px] justify-center overflow-auto rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-3">
      <div className="relative w-fit">
        {page.original_asset?.stale ? (
          <span className="absolute left-3 top-3 z-10 rounded-full bg-secondary-container px-3 py-1 text-xs font-bold text-on-secondary-container shadow-sm">
            Stale
          </span>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element -- Authenticated document previews are served through the local API proxy. */}
        <img
          src={assetSrc(sessionId, documentId, page.page_number, "original", page.original_asset)}
          alt={`Original preview for page ${page.page_number}`}
          className="block max-h-[70vh] max-w-full rounded-lg object-contain"
        />
        {showOverlay ? (
          <div className="pointer-events-none absolute inset-0">
            {(page.zones ?? []).map((zone, index) => {
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
        ) : null}
      </div>
    </div>
  );
}

function editableZonesFromPage(page: TagFlowPreviewPage): EditableZone[] {
  return withReadingOrder((page.zones ?? []).map((zone, index) => ({
    id: zone.id || `zone-${page.page_number}-${index + 1}`,
    tag: zone.tag || "P",
    x: zone.bounds?.x ?? 12,
    y: zone.bounds?.y ?? 12,
    width: zone.bounds?.width ?? 76,
    height: zone.bounds?.height ?? 12,
    reading_order: zone.reading_order || index + 1,
    source: zone.source,
    confidence: zone.confidence,
    evidence_type: zone.evidence_type,
    evidence_ids: zone.evidence_ids ?? null,
    figure_candidate_id: zone.figure_candidate_id,
    figure_inventory_id: zone.figure_inventory_id,
    figure_status: zone.figure_status,
    figure_review_action: zone.figure_review_action,
    figure_is_decorative: zone.figure_is_decorative,
    figure_has_alt_text: zone.figure_has_alt_text,
    figure_has_long_description: zone.figure_has_long_description,
    alt_text: zone.alt_text,
    long_description: zone.long_description,
    figure_type: zone.figure_type,
    flowchart_guidance: zone.flowchart_guidance,
    flowchart: normalizeFlowchartStructure(zone.flowchart, zone.flowchart_guidance ?? ""),
    note: zone.note,
  })));
}

function editableZonesFromSuggestions(suggestions: TagFlowAISuggestions | null | undefined): EditableZone[] {
  return withReadingOrder((suggestions?.zones ?? []).map((zone, index) => ({
    id: `${zone.id || `ai-zone-${index + 1}`}-draft`,
    tag: TAG_OPTIONS.includes(zone.tag) ? zone.tag : "P",
    x: Number(zone.bounds?.x ?? 0),
    y: Number(zone.bounds?.y ?? 0),
    width: Number(zone.bounds?.width ?? 10),
    height: Number(zone.bounds?.height ?? 5),
    reading_order: index + 1,
    source: "ai",
    confidence: zone.confidence,
    evidence_type: zone.evidence_type,
    evidence_ids: zone.evidence_ids ?? null,
    figure_candidate_id: zone.figure_candidate_id,
    figure_inventory_id: zone.figure_inventory_id,
    alt_text: zone.alt_text,
    long_description: zone.long_description,
    figure_type: zone.figure_type,
    flowchart_guidance: zone.flowchart_guidance,
    flowchart: normalizeFlowchartStructure(zone.flowchart, zone.flowchart_guidance ?? ""),
    note: zone.note,
  })));
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function normalizeDraftZone(startX: number, startY: number, endX: number, endY: number): DraftZone {
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  return { startX, startY, x, y, width, height };
}

function pointFromPointer(event: PointerEvent<HTMLElement>) {
  return pointFromElement(event, event.currentTarget);
}

function pointFromElement(event: PointerEvent<HTMLElement>, element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
  return {
    x: clampPercent(((event.clientX - rect.left) / rect.width) * 100),
    y: clampPercent(((event.clientY - rect.top) / rect.height) * 100),
  };
}

function zoneIntersectsRect(zone: EditableZone, rect: DraftZone) {
  const zoneRight = zone.x + zone.width;
  const zoneBottom = zone.y + zone.height;
  const rectRight = rect.x + rect.width;
  const rectBottom = rect.y + rect.height;
  return zone.x <= rectRight && zoneRight >= rect.x && zone.y <= rectBottom && zoneBottom >= rect.y;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
}

function withReadingOrder(zones: EditableZone[]) {
  let contentOrder = 0;
  return zones.map((zone) => {
    if (isArtifactZone(zone)) {
      return { ...zone, reading_order: 0 };
    }
    contentOrder += 1;
    return { ...zone, reading_order: contentOrder };
  });
}

export default function TagFlowStructurePreview({
  sessionId,
  documentId,
  pages,
  metadataTitle = "",
  metadataLanguage = "",
  autoOpenFirstEditable = false,
  initialEditorPageNumber = null,
  openEditorRequestKey = 0,
  showPageGrid = true,
  onFigureTextGenerated,
  onTagFlowUpdated,
}: {
  sessionId: string;
  documentId: string;
  pages: TagFlowPreviewPage[];
  metadataTitle?: string | null;
  metadataLanguage?: string | null;
  autoOpenFirstEditable?: boolean;
  initialEditorPageNumber?: number | null;
  openEditorRequestKey?: number;
  showPageGrid?: boolean;
  onFigureTextGenerated?: () => Promise<void> | void;
  onTagFlowUpdated?: () => Promise<void> | void;
}) {
  const router = useRouter();
  const editorFrameRef = useRef<HTMLDivElement | null>(null);
  const editorImageRef = useRef<HTMLImageElement | null>(null);
  const editorOverlayRef = useRef<HTMLDivElement | null>(null);
  const shortcutStateRef = useRef<{
    editingPage: TagFlowPreviewPage | null;
    selectedZoneCount: number;
    drawingEnabled: boolean;
    draftZone: DraftZone | null;
    marqueeSelection: MarqueeSelection | null;
    dragState: DragState | null;
    resizeState: ResizeState | null;
    redoZones: () => void;
    undoZones: () => void;
    saveZones: (reviewStatus?: "edited" | "remediated") => Promise<void>;
    zoomEditor: (direction: -1 | 0 | 1) => void;
    clearZoneSelection: () => void;
    cancelDrawing: () => void;
    closeZoneEditor: () => void;
    switchAdjacentEditorPage: (direction: -1 | 1) => void;
    combineSelectedZoneWithAdjacent: () => void;
    refreshCurrentPagePreview: () => Promise<void>;
    applyTagToSelectedZone: (tag: string) => void;
    deleteSelectedZone: () => void;
  } | null>(null);
  const [selectedPageIndex, setSelectedPageIndex] = useState<number | null>(null);
  const [selectedPreviewMode, setSelectedPreviewMode] = useState<PreviewMode>("original");
  const [editingPageIndex, setEditingPageIndex] = useState<number | null>(null);
  const [editableZones, setEditableZones] = useState<EditableZone[]>([]);
  const [showAllPages, setShowAllPages] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [draggedZoneId, setDraggedZoneId] = useState<string | null>(null);
  const [readingOrderDropTarget, setReadingOrderDropTarget] = useState<ReadingOrderDropTarget | null>(null);
  const [openZoneMenuId, setOpenZoneMenuId] = useState<string | null>(null);
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [overlaysVisible, setOverlaysVisible] = useState(true);
  const [tagHotkeysOpen, setTagHotkeysOpen] = useState(false);
  const [layoutHintOpen, setLayoutHintOpen] = useState(false);
  const [aiSuggestionsOpen, setAISuggestionsOpen] = useState(false);
  const [editorZoom, setEditorZoom] = useState(1);
  const [leftRailWidth, setLeftRailWidth] = useState(190);
  const [rightRailWidth, setRightRailWidth] = useState(360);
  const [draftZone, setDraftZone] = useState<DraftZone | null>(null);
  const [marqueeSelection, setMarqueeSelection] = useState<MarqueeSelection | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [editorOverlayBox, setEditorOverlayBox] = useState<OverlayBox | null>(null);
  const [, setZoneHistory] = useState<EditableZone[][]>([]);
  const [, setRedoHistory] = useState<EditableZone[][]>([]);
  const [hasUnsavedZoneChanges, setHasUnsavedZoneChanges] = useState(false);
  const [savingZones, setSavingZones] = useState(false);
  const [refreshingPreview, setRefreshingPreview] = useState(false);
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);
  const [aiSuggestionOverrides, setAiSuggestionOverrides] = useState<Record<number, TagFlowAISuggestions>>({});
  const [pageOverrides, setPageOverrides] = useState<Record<number, TagFlowPreviewPage>>({});
  const [layoutHintOverrides, setLayoutHintOverrides] = useState<Record<number, Partial<TagFlowPreviewPage>>>({});
  const [layoutHintDraft, setLayoutHintDraft] = useState<TagFlowLayoutValue>("auto");
  const [savingLayoutHint, setSavingLayoutHint] = useState<"page" | "document" | null>(null);
  const [figureCandidateOverrides, setFigureCandidateOverrides] = useState<Record<string, Partial<TagFlowFigureCandidate>>>({});
  const [figureAltDrafts, setFigureAltDrafts] = useState<Record<string, string>>({});
  const [figureLongDescriptionDrafts, setFigureLongDescriptionDrafts] = useState<Record<string, string>>({});
  const [figureTypeDrafts, setFigureTypeDrafts] = useState<Record<string, "image" | "diagram" | "flowchart">>({});
  const [figureGuidanceDrafts, setFigureGuidanceDrafts] = useState<Record<string, string>>({});
  const [dismissedFigureCandidateKeys, setDismissedFigureCandidateKeys] = useState<Record<string, boolean>>({});
  const [savingFigureAltId, setSavingFigureAltId] = useState<string | null>(null);
  const [generatingFigureAltId, setGeneratingFigureAltId] = useState<string | null>(null);
  const [generatingZoneFigureTextId, setGeneratingZoneFigureTextId] = useState<string | null>(null);
  const [flowchartZoneModalId, setFlowchartZoneModalId] = useState<string | null>(null);
  const [showDocumentMetadata, setShowDocumentMetadata] = useState(true);
  const [metadataDraft, setMetadataDraft] = useState({
    title: metadataTitle ?? "",
    language: metadataLanguage ?? "",
  });
  const [metadataLanguageCustomMode, setMetadataLanguageCustomMode] = useState(pdfLanguageUsesCustomMode(metadataLanguage ?? ""));
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [zoneNotice, setZoneNotice] = useState<string | null>(null);
  const effectivePages = pages.map((page) => pageOverrides[page.page_number] ?? page);
  const selectedPage = selectedPageIndex === null ? null : effectivePages[selectedPageIndex] ?? null;
  const editingPage = editingPageIndex === null ? null : effectivePages[editingPageIndex] ?? null;
  const editingPageWithLayout = withPageLayoutOverride(editingPage, layoutHintOverrides);
  const effectiveEditingPage = withFigureCandidateOverrides(editingPageWithLayout, figureCandidateOverrides);
  const editingPageNumber = editingPage?.page_number ?? null;
  const generatedPageIndexes = effectivePages
    .map((page, index) => page.original_asset?.status === "generated" ? index : null)
    .filter((index): index is number => index !== null);
  const editingGeneratedIndex = editingPageIndex === null ? -1 : generatedPageIndexes.indexOf(editingPageIndex);
  const canEditPreviousPage = editingGeneratedIndex > 0;
  const canEditNextPage = editingGeneratedIndex >= 0 && editingGeneratedIndex < generatedPageIndexes.length - 1;
  const canMovePrevious = selectedPageIndex !== null && selectedPageIndex > 0;
  const canMoveNext = selectedPageIndex !== null && selectedPageIndex < effectivePages.length - 1;
  const visiblePages = showAllPages || effectivePages.length <= COLLAPSED_PAGE_LIMIT ? effectivePages : effectivePages.slice(0, COLLAPSED_PAGE_LIMIT);
  const hiddenPageCount = Math.max(0, effectivePages.length - visiblePages.length);
  const editorCanvasWidth = Math.round(editorZoom * 860);
  const currentValidationIssues = effectiveEditingPage ? validateEditableZones(editableZones, effectiveEditingPage) : [];
  const selectedZoneCount = selectedZoneIds.length;
  const selectedZones = selectedZoneIds.length
    ? editableZones.filter((zone) => selectedZoneIds.includes(zone.id))
    : selectedZoneId
      ? editableZones.filter((zone) => zone.id === selectedZoneId)
      : [];
  const selectedExtractedTextBlocks = extractedTextForZones(editingPage, selectedZones);
  const selectedExtractedText = selectedExtractedTextBlocks.map((block) => block.text).filter(Boolean).join(" ");
  const selectedFigureCandidates = figureCandidatesForZones(effectiveEditingPage, selectedZones);
  const visibleFigureCandidates = selectedFigureCandidates.filter((candidate) => {
    const key = figureCandidateDismissKey(editingPage?.page_number, candidate.id);
    return !key || !dismissedFigureCandidateKeys[key];
  });
  const selectedFigureZone = selectedZones.length === 1 && selectedZones[0]?.tag === "Figure" ? selectedZones[0] : null;
  const flowchartModalZone = flowchartZoneModalId ? editableZones.find((zone) => zone.id === flowchartZoneModalId) ?? null : null;
  const flowchartModalStructure = flowchartModalZone ? normalizeFlowchartStructure(flowchartModalZone.flowchart, flowchartModalZone.flowchart_guidance ?? "") : null;
  const contentZoneOrder = new Map<string, number>();
  editableZones.forEach((zone) => {
    if (isArtifactZone(zone)) return;
    contentZoneOrder.set(zone.id, contentZoneOrder.size + 1);
  });
  const currentLayoutHint = normalizeLayoutHint(effectiveEditingPage?.effective_layout_hint ?? effectiveEditingPage?.layout_hint?.value);
  const currentAISuggestions = editingPage ? aiSuggestionOverrides[editingPage.page_number] ?? effectiveEditingPage?.ai_suggestions ?? editingPage.ai_suggestions : null;
  const aiSuggestionStatus = (currentAISuggestions?.status || "").toLowerCase();
  const aiSuggestionsActive = aiSuggestionStatus === "queued" || aiSuggestionStatus === "running" || aiSuggestionStatus === "retrying";
  const aiSuggestedZones = editableZonesFromSuggestions(currentAISuggestions);
  const editorOverlayStyle = editorOverlayBox
    ? {
        left: editorOverlayBox.left,
        top: editorOverlayBox.top,
        width: editorOverlayBox.width,
        height: editorOverlayBox.height,
      }
    : { left: 0, top: 0, width: "100%", height: "100%" };
  const metadataLanguageSelectValue = metadataLanguageCustomMode ? CUSTOM_PDF_LANGUAGE_VALUE : metadataDraft.language;
  const metadataDirty = metadataDraft.title.trim() !== (metadataTitle ?? "") || metadataDraft.language.trim() !== (metadataLanguage ?? "");

  function openZoneEditor(index: number, preferredZoneId?: string | null) {
    const page = effectivePages[index];
    const pageWithLayout = withPageLayoutOverride(page, layoutHintOverrides);
    const zones = editableZonesFromPage(page);
    setSelectedPageIndex(null);
    setEditingPageIndex(index);
    setEditableZones(zones);
    setLayoutHintDraft(normalizeLayoutHint(pageWithLayout?.effective_layout_hint ?? pageWithLayout?.layout_hint?.value));
    setSelectedZoneId(preferredZoneId && zones.some((zone) => zone.id === preferredZoneId) ? preferredZoneId : null);
    setSelectedZoneIds([]);
    setDraggedZoneId(null);
    setReadingOrderDropTarget(null);
    setOpenZoneMenuId(null);
    setDrawingEnabled(false);
    setOverlaysVisible(true);
    setTagHotkeysOpen(false);
    setEditorZoom(1);
    setDraftZone(null);
    setMarqueeSelection(null);
    setDragState(null);
    setResizeState(null);
    setEditorOverlayBox(null);
    setZoneHistory([]);
    setRedoHistory([]);
    setHasUnsavedZoneChanges(false);
    setZoneError(null);
    setZoneNotice(null);
    setRefreshingPreview(false);
    setGeneratingSuggestions(false);
  }

  function canLeaveCurrentEditorPage() {
    if (!hasUnsavedZoneChanges) return true;
    return window.confirm("You have unsaved zone changes on this page. Leave without saving?");
  }

  function closeZoneEditor() {
    if (!canLeaveCurrentEditorPage()) return;
    setEditingPageIndex(null);
  }

  function switchZoneEditorPage(index: number) {
    if (!canLeaveCurrentEditorPage()) return;
    openZoneEditor(index);
  }

  function switchAdjacentEditorPage(direction: -1 | 1) {
    if (editingGeneratedIndex < 0) return;
    const nextGeneratedIndex = editingGeneratedIndex + direction;
    const nextPageIndex = generatedPageIndexes[nextGeneratedIndex];
    if (nextPageIndex === undefined) return;
    switchZoneEditorPage(nextPageIndex);
  }

  useEffect(() => {
    if (!openEditorRequestKey) return;
    const requestedIndex = initialEditorPageNumber
      ? effectivePages.findIndex((page) => page.page_number === initialEditorPageNumber)
      : -1;
    const pageIndex = requestedIndex >= 0 ? requestedIndex : generatedPageIndexes[0];
    if (pageIndex === undefined || pageIndex < 0) return;
    const page = effectivePages[pageIndex];
    if (page.original_asset?.status !== "generated") {
      window.setTimeout(() => {
        if (pageIndex >= COLLAPSED_PAGE_LIMIT) {
          setShowAllPages(true);
        }
        globalThis.document.querySelector(`#tagflow-page-${page.page_number}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
      return;
    }
    window.setTimeout(() => openZoneEditor(pageIndex), 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Request key intentionally controls imperative editor opens from document detail.
  }, [openEditorRequestKey]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pageNumber = Number(params.get("page") || "");
    if (!pageNumber) {
      const firstGeneratedIndex = generatedPageIndexes[0];
      if (autoOpenFirstEditable && firstGeneratedIndex !== undefined) {
        window.setTimeout(() => openZoneEditor(firstGeneratedIndex), 0);
      }
      return;
    }
    const pageIndex = effectivePages.findIndex((page) => page.page_number === pageNumber);
    if (pageIndex < 0) return;
    const page = effectivePages[pageIndex];
    window.setTimeout(() => {
      if (pageIndex >= COLLAPSED_PAGE_LIMIT) {
        setShowAllPages(true);
      }
      if (page.original_asset?.status === "generated") {
        openZoneEditor(pageIndex, params.get("zone"));
        return;
      }
      window.setTimeout(() => {
        globalThis.document.querySelector(`#tagflow-page-${pageNumber}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    }, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Query params are consumed once to deep-link into a page editor.
  }, []);

  function startSidebarResize(side: "left" | "right", event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftRailWidth : rightRailWidth;
    const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      if (side === "left") {
        setLeftRailWidth(Math.max(150, Math.min(300, startWidth + delta)));
      } else {
        setRightRailWidth(Math.max(320, Math.min(500, startWidth - delta)));
      }
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function commitZones(updater: EditableZone[] | ((zones: EditableZone[]) => EditableZone[])) {
    setEditableZones((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      setZoneHistory((history) => [...history.slice(-24), current]);
      setRedoHistory([]);
      setHasUnsavedZoneChanges(true);
      return next;
    });
  }

  function clearZoneSelection() {
    setSelectedZoneId(null);
    setSelectedZoneIds([]);
    setOpenZoneMenuId(null);
  }

  function selectZone(id: string, additive = false) {
    setSelectedZoneId(id);
    setSelectedZoneIds((current) => {
      if (!additive) return [id];
      if (current.includes(id)) return current;
      return [...current, id];
    });
  }

  function updateZone(id: string, updates: Partial<EditableZone>) {
    commitZones((zones) => zones.map((zone) => zone.id === id ? { ...zone, ...updates } : zone));
  }

  function removeZone(id: string) {
    commitZones((zones) => withReadingOrder(zones.filter((item) => item.id !== id)));
    setSelectedZoneIds((current) => current.filter((item) => item !== id));
    setSelectedZoneId((current) => current === id ? null : current);
  }

  function reorderZone(sourceId: string, targetId: string, position: "before" | "after" = "before") {
    if (sourceId === targetId) return;
    commitZones((zones) => {
      const sourceIndex = zones.findIndex((zone) => zone.id === sourceId);
      const targetIndex = zones.findIndex((zone) => zone.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return zones;
      const moved = zones[sourceIndex];
      const next = zones.filter((zone) => zone.id !== sourceId);
      const nextTargetIndex = next.findIndex((zone) => zone.id === targetId);
      if (nextTargetIndex < 0) return zones;
      next.splice(position === "after" ? nextTargetIndex + 1 : nextTargetIndex, 0, moved);
      return withReadingOrder(next);
    });
  }

  function updateReadingOrderDropTarget(event: DragEvent<HTMLDivElement>, zoneId: string) {
    if (!draggedZoneId || draggedZoneId === zoneId) {
      setReadingOrderDropTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
    setReadingOrderDropTarget({ zoneId, position });
  }

  function moveZone(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= editableZones.length) return;
    commitZones((zones) => {
      const next = [...zones];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return withReadingOrder(next);
    });
  }

  function undoZones() {
    setZoneHistory((history) => {
      if (!history.length) return history;
      const previous = history[history.length - 1];
      setRedoHistory((future) => [editableZones, ...future.slice(0, 24)]);
      setEditableZones(previous);
      clearZoneSelection();
      setHasUnsavedZoneChanges(true);
      return history.slice(0, -1);
    });
  }

  function redoZones() {
    setRedoHistory((future) => {
      if (!future.length) return future;
      const next = future[0];
      setZoneHistory((history) => [...history.slice(-24), editableZones]);
      setEditableZones(next);
      clearZoneSelection();
      setHasUnsavedZoneChanges(true);
      return future.slice(1);
    });
  }

  function deleteSelectedZone() {
    const ids = selectedZoneIds.length ? selectedZoneIds : selectedZoneId ? [selectedZoneId] : [];
    if (!ids.length) return;
    commitZones((zones) => withReadingOrder(zones.filter((item) => !ids.includes(item.id))));
    clearZoneSelection();
  }

  function applyTagToSelectedZone(tag: string) {
    const ids = selectedZoneIds.length ? selectedZoneIds : selectedZoneId ? [selectedZoneId] : [];
    if (!ids.length || !TAG_OPTIONS.includes(tag)) return;
    commitZones((zones) => withReadingOrder(zones.map((zone) => {
      if (!ids.includes(zone.id)) return zone;
      const nextZone = {
        ...zone,
        tag,
        ...(tag === "Figure" ? {} : {
          figure_candidate_id: null,
          figure_inventory_id: null,
          figure_status: null,
          figure_review_action: null,
          figure_is_decorative: null,
          figure_has_alt_text: null,
          figure_has_long_description: null,
        }),
      };
      return tag === "Figure" ? bindEditableFigureZone(effectiveEditingPage, nextZone) : nextZone;
    })));
    setZoneNotice(`Changed ${ids.length === 1 ? "selected zone" : `${ids.length} selected zones`} to ${tagDisplayLabel(tag)}.`);
  }

  function combineSelectedZoneWithAdjacent() {
    const selectedIds = selectedZoneIds.length ? selectedZoneIds : selectedZoneId ? [selectedZoneId] : [];
    if (!selectedIds.length || editableZones.length < 2) {
      setZoneNotice("Select a zone with an adjacent zone to combine.");
      return;
    }
    const selectedIndexes = editableZones
      .map((zone, index) => selectedIds.includes(zone.id) ? index : -1)
      .filter((index) => index >= 0);
    if (!selectedIndexes.length) return;
    const combineIndexes = selectedIndexes.length > 1
      ? selectedIndexes
      : [
          selectedIndexes[0],
          selectedIndexes[0] < editableZones.length - 1 ? selectedIndexes[0] + 1 : selectedIndexes[0] - 1,
        ].filter((index) => index >= 0);
    const zonesToCombine = combineIndexes.map((index) => editableZones[index]);
    const insertIndex = Math.min(...combineIndexes);
    const primary = zonesToCombine[0];
    const left = Math.min(...zonesToCombine.map((zone) => zone.x));
    const top = Math.min(...zonesToCombine.map((zone) => zone.y));
    const right = Math.max(...zonesToCombine.map((zone) => zone.x + zone.width));
    const bottom = Math.max(...zonesToCombine.map((zone) => zone.y + zone.height));
    const combined: EditableZone = {
      ...primary,
      x: Number(left.toFixed(2)),
      y: Number(top.toFixed(2)),
      width: Number(Math.min(100 - left, right - left).toFixed(2)),
      height: Number(Math.min(100 - top, bottom - top).toFixed(2)),
    };

    commitZones((zones) => {
      const next = zones.filter((_, index) => !combineIndexes.includes(index));
      next.splice(insertIndex, 0, combined);
      return withReadingOrder(next);
    });
    selectZone(combined.id);
    setZoneNotice(`Combined ${combineIndexes.length} zones.`);
  }

  function zoomEditor(direction: -1 | 0 | 1) {
    setEditorZoom((current) => {
      if (direction === 0) return 1;
      const next = current + direction * 0.1;
      return Math.max(0.75, Math.min(1.8, Number(next.toFixed(2))));
    });
  }

  function startMovingZone(event: PointerEvent<HTMLElement>, zone: EditableZone) {
    if (drawingEnabled || marqueeSelection || !editorOverlayRef.current) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromElement(event, editorOverlayRef.current);
    setZoneHistory((history) => [...history.slice(-24), editableZones]);
    setRedoHistory([]);
    selectZone(zone.id, event.shiftKey);
    setDragState({
      zoneId: zone.id,
      startX: point.x,
      startY: point.y,
      originX: zone.x,
      originY: zone.y,
    });
  }

  function updateZoneDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragState) return;
    event.preventDefault();
    const point = pointFromPointer(event);
    setHasUnsavedZoneChanges(true);
    setEditableZones((zones) => zones.map((zone) => {
      if (zone.id !== dragState.zoneId) return zone;
      const x = clampPercent(dragState.originX + point.x - dragState.startX);
      const y = clampPercent(dragState.originY + point.y - dragState.startY);
      return {
        ...zone,
        x: Number(Math.max(0, Math.min(x, 100 - zone.width)).toFixed(2)),
        y: Number(Math.max(0, Math.min(y, 100 - zone.height)).toFixed(2)),
      };
    }));
  }

  function finishZoneDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragState) return;
    event.preventDefault();
    setDragState(null);
  }

  function startResizingZone(event: PointerEvent<HTMLElement>, zone: EditableZone) {
    if (marqueeSelection || !editorOverlayRef.current) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromElement(event, editorOverlayRef.current);
    setZoneHistory((history) => [...history.slice(-24), editableZones]);
    setRedoHistory([]);
    selectZone(zone.id, event.shiftKey);
    setResizeState({
      zoneId: zone.id,
      startX: point.x,
      startY: point.y,
      originWidth: zone.width,
      originHeight: zone.height,
    });
  }

  function updateZoneResize(event: PointerEvent<HTMLDivElement>) {
    if (!resizeState) return;
    event.preventDefault();
    const point = pointFromPointer(event);
    setHasUnsavedZoneChanges(true);
    setEditableZones((zones) => zones.map((zone) => {
      if (zone.id !== resizeState.zoneId) return zone;
      const width = resizeState.originWidth + point.x - resizeState.startX;
      const height = resizeState.originHeight + point.y - resizeState.startY;
      return {
        ...zone,
        width: Number(Math.max(MIN_DRAWN_ZONE_SIZE, Math.min(width, 100 - zone.x)).toFixed(2)),
        height: Number(Math.max(MIN_DRAWN_ZONE_SIZE, Math.min(height, 100 - zone.y)).toFixed(2)),
      };
    }));
  }

  function finishZoneResize(event: PointerEvent<HTMLDivElement>) {
    if (!resizeState) return;
    event.preventDefault();
    setResizeState(null);
  }

  function startDrawing(event: PointerEvent<HTMLDivElement>) {
    if (!drawingEnabled || !editingPage) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromPointer(event);
    clearZoneSelection();
    setDraftZone(normalizeDraftZone(point.x, point.y, point.x, point.y));
  }

  function updateDrawing(event: PointerEvent<HTMLDivElement>) {
    if (!draftZone || !drawingEnabled) return;
    event.preventDefault();
    const point = pointFromPointer(event);
    setDraftZone(normalizeDraftZone(draftZone.startX, draftZone.startY, point.x, point.y));
  }

  function finishDrawing(event: PointerEvent<HTMLDivElement>) {
    if (!draftZone || !editingPage) return;
    event.preventDefault();
    const point = pointFromPointer(event);
    const nextDraft = normalizeDraftZone(draftZone.startX, draftZone.startY, point.x, point.y);
    setDraftZone(null);
    if (nextDraft.width < MIN_DRAWN_ZONE_SIZE || nextDraft.height < MIN_DRAWN_ZONE_SIZE) return;

    const zone: EditableZone = {
      id: `zone-${editingPage.page_number}-${Date.now()}-${editableZones.length + 1}`,
      tag: "P",
      x: Number(nextDraft.x.toFixed(2)),
      y: Number(nextDraft.y.toFixed(2)),
      width: Number(nextDraft.width.toFixed(2)),
      height: Number(nextDraft.height.toFixed(2)),
      reading_order: editableZones.length + 1,
    };
    commitZones((zones) => withReadingOrder([...zones, zone]));
    selectZone(zone.id);
    setDrawingEnabled(false);
    setOverlaysVisible(true);
  }

  function startMarqueeSelection(event: PointerEvent<HTMLDivElement>) {
    if (drawingEnabled || !editingPage || dragState || resizeState) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromPointer(event);
    const additive = event.shiftKey;
    if (!additive) {
      clearZoneSelection();
    } else {
      setOpenZoneMenuId(null);
    }
    setMarqueeSelection({
      ...normalizeDraftZone(point.x, point.y, point.x, point.y),
      additive,
      initialSelectedIds: additive ? selectedZoneIds : [],
    });
  }

  function updateMarqueeSelection(event: PointerEvent<HTMLDivElement>) {
    if (!marqueeSelection || drawingEnabled) return;
    event.preventDefault();
    const point = pointFromPointer(event);
    const nextSelection = {
      ...normalizeDraftZone(marqueeSelection.startX, marqueeSelection.startY, point.x, point.y),
      additive: marqueeSelection.additive,
      initialSelectedIds: marqueeSelection.initialSelectedIds,
    };
    setMarqueeSelection(nextSelection);
    if (nextSelection.width < 0.5 && nextSelection.height < 0.5) return;

    const matchedIds = editableZones
      .filter((zone) => zoneIntersectsRect(zone, nextSelection))
      .map((zone) => zone.id);
    const ids = nextSelection.additive
      ? Array.from(new Set([...nextSelection.initialSelectedIds, ...matchedIds]))
      : matchedIds;
    setSelectedZoneIds(ids);
    setSelectedZoneId(ids.at(-1) ?? null);
    setOpenZoneMenuId(null);
  }

  function finishMarqueeSelection(event: PointerEvent<HTMLDivElement>) {
    if (!marqueeSelection) return;
    event.preventDefault();
    if (marqueeSelection.width < 0.5 && marqueeSelection.height < 0.5) {
      const ids = marqueeSelection.additive ? marqueeSelection.initialSelectedIds : [];
      setSelectedZoneIds(ids);
      setSelectedZoneId(ids.at(-1) ?? null);
    }
    setMarqueeSelection(null);
  }

  function cancelDrawing() {
    setDraftZone(null);
    setMarqueeSelection(null);
    setDragState(null);
    setResizeState(null);
  }

  useEffect(() => {
    if (!zoneNotice) return undefined;
    const timeout = window.setTimeout(() => setZoneNotice(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [zoneNotice]);

  useEffect(() => {
    if (!aiSuggestionsActive || !editingPageNumber) return undefined;
    const pageNumber = editingPageNumber;
    let cancelled = false;
    let inFlight = false;

    async function pollSuggestionStatus() {
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
        const payload = await res.json() as TagFlowDetailResponse;
        const updatedPage = payload.tagflow_state?.pages?.find((page) => page.page_number === pageNumber);
        if (updatedPage?.ai_suggestions) {
          setAiSuggestionOverrides((current) => ({
            ...current,
            [pageNumber]: updatedPage.ai_suggestions as TagFlowAISuggestions,
          }));
        }
      } finally {
        inFlight = false;
      }
    }

    void pollSuggestionStatus();
    const interval = window.setInterval(() => void pollSuggestionStatus(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [aiSuggestionsActive, documentId, editingPageNumber, sessionId]);

  useEffect(() => {
    if (!editingPage || !editorFrameRef.current) return undefined;
    const frameElement = editorFrameRef.current;
    const updateOverlayBox = () => {
      const imageElement = editorImageRef.current;
      if (!imageElement?.naturalWidth || !imageElement.naturalHeight) return;
      const frameRect = frameElement.getBoundingClientRect();
      const imageRect = imageElement.getBoundingClientRect();
      if (!frameRect.width || !frameRect.height || !imageRect.width || !imageRect.height) return;

      const imageAspect = imageElement.naturalWidth / imageElement.naturalHeight;
      const containerAspect = imageRect.width / imageRect.height;
      let renderedWidth = imageRect.width;
      let renderedHeight = imageRect.height;
      let renderedLeft = imageRect.left - frameRect.left;
      let renderedTop = imageRect.top - frameRect.top;

      if (imageAspect > containerAspect) {
        renderedHeight = imageRect.width / imageAspect;
        renderedTop += (imageRect.height - renderedHeight) / 2;
      } else {
        renderedWidth = imageRect.height * imageAspect;
        renderedLeft += (imageRect.width - renderedWidth) / 2;
      }

      setEditorOverlayBox({
        left: renderedLeft,
        top: renderedTop,
        width: renderedWidth,
        height: renderedHeight,
      });
    };
    updateOverlayBox();

    const observer = new ResizeObserver(updateOverlayBox);
    observer.observe(frameElement);
    if (editorImageRef.current) observer.observe(editorImageRef.current);
    window.addEventListener("resize", updateOverlayBox);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOverlayBox);
    };
  }, [editingPage]);

  async function queuePagePreviewRefresh(accessToken: string, pageNumber: number, fallback = "Failed to queue TagFlow preview refresh") {
    const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/tagflow/previews`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page_numbers: [pageNumber] }),
    });
    if (!res.ok) throw new Error(await parseApiError(res, fallback));
  }

  async function refreshCurrentPagePreview() {
    if (!editingPage || refreshingPreview) return;
    setRefreshingPreview(true);
    setZoneError(null);
    setZoneNotice(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      await queuePagePreviewRefresh(session.access_token, editingPage.page_number);
      setZoneNotice(`Queued preview refresh for page ${editingPage.page_number}.`);
      setSelectedPageIndex(null);
      router.refresh();
    } catch (error) {
      setZoneError(error instanceof Error ? error.message : "Failed to queue preview refresh");
    } finally {
      setRefreshingPreview(false);
    }
  }

  async function queueCurrentPageSuggestions() {
    if (!editingPage || generatingSuggestions || aiSuggestionsActive) return;
    setGeneratingSuggestions(true);
    setZoneError(null);
    setZoneNotice(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/tagflow/suggestions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page_numbers: [editingPage.page_number] }),
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to queue AI zone suggestions"));
      setAiSuggestionOverrides((current) => ({
        ...current,
        [editingPage.page_number]: {
          ...(currentAISuggestions ?? {}),
          status: "queued",
        },
      }));
      setZoneNotice(`Queued AI zone suggestions for page ${editingPage.page_number}.`);
    } catch (error) {
      setZoneError(error instanceof Error ? error.message : "Failed to queue AI zone suggestions");
    } finally {
      setGeneratingSuggestions(false);
    }
  }

  async function saveLayoutHint(scope: "page" | "document") {
    if (!editingPage || savingLayoutHint) return;
    setSavingLayoutHint(scope);
    setZoneError(null);
    setZoneNotice(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/tagflow/layout-hint`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          layout: layoutHintDraft,
          scope,
          page_number: editingPage.page_number,
        }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to save layout hint"));
      const data = await res.json() as TagFlowDetailResponse;
      const updatedPages = data.tagflow_state?.pages ?? [];
      if (updatedPages.length) {
        setLayoutHintOverrides((current) => {
          const next = { ...current };
          updatedPages.forEach((page) => {
            next[page.page_number] = {
              layout_hint: page.layout_hint,
              effective_layout_hint: page.effective_layout_hint,
              ai_suggestions: page.ai_suggestions,
            };
          });
          return next;
        });
        const updatedEditingPage = updatedPages.find((page) => page.page_number === editingPage.page_number);
        if (updatedEditingPage?.ai_suggestions) {
          setAiSuggestionOverrides((current) => ({
            ...current,
            [editingPage.page_number]: updatedEditingPage.ai_suggestions as TagFlowAISuggestions,
          }));
        }
        setLayoutHintDraft(normalizeLayoutHint(updatedEditingPage?.effective_layout_hint ?? updatedEditingPage?.layout_hint?.value ?? layoutHintDraft));
      }
      setZoneNotice(scope === "document" ? "Applied layout hint to the document." : `Applied layout hint to page ${editingPage.page_number}.`);
    } catch (error) {
      setZoneError(error instanceof Error ? error.message : "Failed to save layout hint");
    } finally {
      setSavingLayoutHint(null);
    }
  }

  async function saveDocumentMetadata() {
    if (savingMetadata) return;
    setSavingMetadata(true);
    setZoneError(null);
    setZoneNotice(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/metadata`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: metadataDraft.title,
          language: metadataDraft.language,
        }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to save PDF metadata"));
      const data = await res.json() as { metadata?: { title?: string | null; language?: string | null } };
      const savedLanguage = data.metadata?.language ?? metadataDraft.language.trim();
      setMetadataDraft({
        title: data.metadata?.title ?? metadataDraft.title.trim(),
        language: savedLanguage,
      });
      setMetadataLanguageCustomMode(pdfLanguageUsesCustomMode(savedLanguage));
      setZoneNotice("PDF title and language saved.");
      router.refresh();
    } catch (error) {
      setZoneError(error instanceof Error ? error.message : "Failed to save PDF metadata");
    } finally {
      setSavingMetadata(false);
    }
  }

  function applyAISuggestionsToDraft() {
    if (!aiSuggestedZones.length) return;
    if (editableZones.length) {
      const proceed = window.confirm("Replace the current draft zones with AI suggestions? This will not save until you click Save zones.");
      if (!proceed) return;
    }
    commitZones(withReadingOrder(aiSuggestedZones.map((zone) => bindEditableFigureZone(effectiveEditingPage, zone))));
    setSelectedZoneId(null);
    setSelectedZoneIds([]);
    setZoneNotice(`Applied ${aiSuggestedZones.length} AI suggestion${aiSuggestedZones.length === 1 ? "" : "s"} to the draft. Review before saving.`);
  }

  function applyFigureTextUpdate(candidate: TagFlowFigureCandidate, figure: {
    id?: string;
    source_candidate_id?: string;
    status?: string;
    review_action?: "keep" | "ignore";
    is_decorative?: boolean;
    alt_text?: string;
    long_description?: string;
    figure_type?: "image" | "diagram" | "flowchart";
    flowchart_guidance?: string;
  } | undefined, fallbackAltText: string) {
    const figureId = figure?.id ?? candidate.figure_inventory_id;
    const sourceCandidateId = figure?.source_candidate_id || candidate.id;
    const pageNumber = editingPage?.page_number;
    if (!figureId || !sourceCandidateId || !pageNumber) return;
    const savedAltText = figure?.alt_text ?? fallbackAltText;
    const overrideKey = figureCandidateOverrideKey(pageNumber, sourceCandidateId);
    if (overrideKey) {
      setFigureCandidateOverrides((current) => ({
        ...current,
        [overrideKey]: {
          ...current[overrideKey],
          figure_inventory_id: figureId,
          figure_status: figure?.status ?? (savedAltText ? "reviewed" : "needs_review"),
          review_action: figure?.review_action ?? "keep",
          is_decorative: Boolean(figure?.is_decorative),
          has_alt_text: Boolean(savedAltText),
          has_long_description: Boolean((figure?.long_description ?? "").trim()),
          alt_text: savedAltText,
          long_description: figure?.long_description ?? current[overrideKey]?.long_description,
          figure_type: figureCandidateType(figure?.figure_type),
          flowchart_guidance: figure?.flowchart_guidance ?? current[overrideKey]?.flowchart_guidance,
        },
      }));
    }
    setFigureAltDrafts((current) => ({ ...current, [figureId]: savedAltText }));
    setFigureLongDescriptionDrafts((current) => ({ ...current, [figureId]: figure?.long_description ?? current[figureId] ?? "" }));
    setFigureTypeDrafts((current) => ({ ...current, [figureId]: figureCandidateType(figure?.figure_type) }));
    setFigureGuidanceDrafts((current) => ({ ...current, [figureId]: figure?.flowchart_guidance ?? current[figureId] ?? "" }));
    setEditableZones((zones) => zones.map((zone) => (
      zone.figure_candidate_id === sourceCandidateId || zone.figure_inventory_id === figureId
        ? {
            ...zone,
            figure_inventory_id: figureId,
            figure_status: figure?.status ?? (savedAltText ? "reviewed" : "needs_review"),
            figure_review_action: figure?.review_action ?? "keep",
            figure_is_decorative: Boolean(figure?.is_decorative),
            figure_has_alt_text: Boolean(savedAltText),
            figure_has_long_description: Boolean((figure?.long_description ?? "").trim()),
          }
        : zone
    )));
  }

  async function waitForBackgroundJob(token: string, jobId: string, options?: { attempts?: number; intervalMs?: number }) {
    const attempts = options?.attempts ?? 30;
    const intervalMs = options?.intervalMs ?? 2000;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const res = await fetch(`${API_URL}/canvas/jobs/${jobId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to refresh background job"));
      const job = await res.json() as BackgroundJobResponse;
      const status = String(job.status || "").toLowerCase();
      if (status === "succeeded") return job;
      if (TERMINAL_JOB_STATUSES.has(status)) {
        throw new Error(job.error_message || "Background job failed");
      }
      await wait(intervalMs);
    }
    return null;
  }

  async function refreshFigureCandidateFromTagFlow(token: string, candidate: TagFlowFigureCandidate, figureId: string) {
    const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/tagflow`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(await parseApiError(res, "Failed to refresh TagFlow figure text"));
    const payload = await res.json() as TagFlowDetailResponse;
    const page = payload.tagflow_state?.pages?.find((item) => item.page_number === editingPage?.page_number);
    const updatedCandidate = page?.figure_candidates?.find((item) => (
      item.figure_inventory_id === figureId || item.id === candidate.id
    ));
    await onFigureTextGenerated?.();
    if (!updatedCandidate) {
      router.refresh();
      return false;
    }
    applyFigureTextUpdate(
      { ...candidate, ...updatedCandidate },
      {
        id: updatedCandidate.figure_inventory_id ?? figureId,
        source_candidate_id: updatedCandidate.id ?? candidate.id ?? undefined,
        status: updatedCandidate.figure_status ?? undefined,
        review_action: updatedCandidate.review_action ?? "keep",
        is_decorative: Boolean(updatedCandidate.is_decorative),
        alt_text: updatedCandidate.alt_text ?? "",
        long_description: updatedCandidate.long_description ?? "",
        figure_type: figureCandidateType(updatedCandidate.figure_type),
        flowchart_guidance: updatedCandidate.flowchart_guidance ?? "",
      },
      updatedCandidate.alt_text ?? ""
    );
    return true;
  }

  async function saveFigureAltText(candidate: TagFlowFigureCandidate & { overlap_score?: number }) {
    const figureId = candidate.figure_inventory_id;
    const candidateId = candidate.id;
    const pageNumber = editingPage?.page_number;
    if (!figureId || !candidateId || !pageNumber || savingFigureAltId) return;
    const draftKey = figureId;
    const altText = (figureAltDrafts[draftKey] ?? candidate.alt_text ?? "").trim();
    const longDescription = (figureLongDescriptionDrafts[draftKey] ?? candidate.long_description ?? "").trim();
    const figureType = figureTypeDrafts[draftKey] ?? figureCandidateType(candidate.figure_type);
    const flowchartGuidance = (figureGuidanceDrafts[draftKey] ?? candidate.flowchart_guidance ?? "").trim();
    setSavingFigureAltId(figureId);
    setZoneError(null);
    setZoneNotice(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/figures/${encodeURIComponent(figureId)}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          alt_text: altText,
          long_description: longDescription,
          is_decorative: false,
          review_action: "keep",
          figure_type: figureType,
          flowchart_guidance: flowchartGuidance,
        }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to save figure alt text"));
      const data = await res.json() as { figure?: { id?: string; source_candidate_id?: string; status?: string; review_action?: "keep" | "ignore"; is_decorative?: boolean; alt_text?: string; long_description?: string; figure_type?: "image" | "diagram" | "flowchart"; flowchart_guidance?: string } };
      applyFigureTextUpdate(candidate, data.figure, altText);
      setZoneNotice("Figure text saved.");
    } catch (error) {
      setZoneError(error instanceof Error ? error.message : "Failed to save figure alt text");
    } finally {
      setSavingFigureAltId(null);
    }
  }

  async function generateFigureText(candidate: TagFlowFigureCandidate & { overlap_score?: number }, mode: "alt" | "long_desc" | "both") {
    const figureId = candidate.figure_inventory_id;
    if (!figureId || savingFigureAltId || generatingFigureAltId) return;
    setGeneratingFigureAltId(figureId);
    setZoneError(null);
    setZoneNotice(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/figures/${encodeURIComponent(figureId)}/generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode,
          figure_type: figureTypeDrafts[figureId] ?? figureCandidateType(candidate.figure_type),
          guidance: figureGuidanceDrafts[figureId] ?? candidate.flowchart_guidance ?? "",
        }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to generate figure text"));
      const data = await res.json() as {
        job_id?: string;
        created?: boolean;
        figure?: { id?: string; source_candidate_id?: string; status?: string; review_action?: "keep" | "ignore"; is_decorative?: boolean; alt_text?: string; long_description?: string; figure_type?: "image" | "diagram" | "flowchart"; flowchart_guidance?: string };
      };
      if (data.job_id) {
        setZoneNotice(data.created === false
          ? "Figure text generation is already queued. Waiting for the worker to finish."
          : "Figure text generation queued. Waiting for the worker to finish.");
        const completedJob = await waitForBackgroundJob(session.access_token, data.job_id);
        if (!completedJob) {
          setZoneNotice("Figure text generation is still running. Refresh this page in a moment to check again.");
          router.refresh();
          return;
        }
        const refreshed = await refreshFigureCandidateFromTagFlow(session.access_token, candidate, figureId);
        setZoneNotice(refreshed
          ? mode === "long_desc" ? "Figure long description generated." : mode === "both" ? "Figure text generated." : "Figure alt text generated."
          : "Figure text generated. Refreshed TagFlow data.");
        return;
      }
      applyFigureTextUpdate(candidate, data.figure, data.figure?.alt_text ?? "");
      setZoneNotice(mode === "long_desc" ? "Figure long description generated." : mode === "both" ? "Figure text generated." : "Figure alt text generated.");
    } catch (error) {
      setZoneError(error instanceof Error ? error.message : "Failed to generate figure text");
    } finally {
      setGeneratingFigureAltId(null);
    }
  }

  function updateFigureZoneText(zoneId: string, patch: Partial<EditableZone>) {
    setEditableZones((zones) => zones.map((zone) => (
      zone.id === zoneId
        ? {
            ...zone,
            ...patch,
            figure_has_alt_text: patch.alt_text !== undefined ? Boolean((patch.alt_text || "").trim()) : zone.figure_has_alt_text,
            figure_has_long_description: patch.long_description !== undefined ? Boolean((patch.long_description || "").trim()) : zone.figure_has_long_description,
          }
        : zone
    )));
    setHasUnsavedZoneChanges(true);
  }

  function addFlowchartNode(zoneId: string) {
    const zone = editableZones.find((item) => item.id === zoneId);
    if (!zone) return;
    const structure = normalizeFlowchartStructure(zone.flowchart, zone.flowchart_guidance ?? "");
    const nextNode: TagFlowFlowchartNode = {
      id: `node-${Date.now()}`,
      label: `Step ${structure.nodes.length + 1}`,
      description: "",
      reading_order: structure.nodes.length + 1,
    };
    updateFigureZoneText(zoneId, {
      figure_type: "flowchart",
      flowchart: {
        ...structure,
        nodes: [...structure.nodes, nextNode],
        reading_order: [...(structure.reading_order ?? []), nextNode.id],
      },
    });
  }

  function updateFlowchartNode(zoneId: string, nodeId: string, patch: Partial<TagFlowFlowchartNode>) {
    const zone = editableZones.find((item) => item.id === zoneId);
    if (!zone) return;
    const structure = normalizeFlowchartStructure(zone.flowchart, zone.flowchart_guidance ?? "");
    updateFigureZoneText(zoneId, {
      flowchart: {
        ...structure,
        nodes: structure.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node),
      },
    });
  }

  function removeFlowchartNode(zoneId: string, nodeId: string) {
    const zone = editableZones.find((item) => item.id === zoneId);
    if (!zone) return;
    const structure = normalizeFlowchartStructure(zone.flowchart, zone.flowchart_guidance ?? "");
    const nodes = structure.nodes.filter((node) => node.id !== nodeId).map((node, index) => ({ ...node, reading_order: index + 1 }));
    updateFigureZoneText(zoneId, {
      flowchart: {
        ...structure,
        nodes,
        connections: structure.connections.filter((connection) => connection.from_node_id !== nodeId && connection.to_node_id !== nodeId),
        reading_order: nodes.map((node) => node.id),
      },
    });
  }

  function addFlowchartConnection(zoneId: string) {
    const zone = editableZones.find((item) => item.id === zoneId);
    if (!zone) return;
    const structure = normalizeFlowchartStructure(zone.flowchart, zone.flowchart_guidance ?? "");
    if (structure.nodes.length < 2) return;
    updateFigureZoneText(zoneId, {
      figure_type: "flowchart",
      flowchart: {
        ...structure,
        connections: [
          ...structure.connections,
          {
            id: `connection-${Date.now()}`,
            from_node_id: structure.nodes[0].id,
            to_node_id: structure.nodes[1].id,
            label: "",
            description: "",
            order: structure.connections.length + 1,
          },
        ],
      },
    });
  }

  function updateFlowchartConnection(zoneId: string, connectionId: string, patch: Partial<TagFlowFlowchartConnection>) {
    const zone = editableZones.find((item) => item.id === zoneId);
    if (!zone) return;
    const structure = normalizeFlowchartStructure(zone.flowchart, zone.flowchart_guidance ?? "");
    updateFigureZoneText(zoneId, {
      flowchart: {
        ...structure,
        connections: structure.connections.map((connection) => connection.id === connectionId ? { ...connection, ...patch } : connection),
      },
    });
  }

  function removeFlowchartConnection(zoneId: string, connectionId: string) {
    const zone = editableZones.find((item) => item.id === zoneId);
    if (!zone) return;
    const structure = normalizeFlowchartStructure(zone.flowchart, zone.flowchart_guidance ?? "");
    updateFigureZoneText(zoneId, {
      flowchart: {
        ...structure,
        connections: structure.connections.filter((connection) => connection.id !== connectionId).map((connection, index) => ({ ...connection, order: index + 1 })),
      },
    });
  }

  async function generateSelectedZoneFigureText(mode: "alt" | "long_desc" | "both") {
    if (!editingPage || !selectedFigureZone || generatingZoneFigureTextId) return;
    const zone = selectedFigureZone;
    setGeneratingZoneFigureTextId(zone.id);
    setZoneError(null);
    setZoneNotice(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/tagflow/pages/${editingPage.page_number}/figure-text/generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          zone_id: zone.id,
          mode,
          x: zone.x,
          y: zone.y,
          width: zone.width,
          height: zone.height,
          figure_type: zone.figure_type ?? "image",
          guidance: flowchartGuidanceForZone(zone),
        }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to generate selected zone figure text"));
      const data = await res.json() as {
        alt_text?: string;
        long_description?: string;
        figure_type?: "image" | "diagram" | "flowchart";
        flowchart_guidance?: string;
      };
      updateFigureZoneText(zone.id, {
        alt_text: data.alt_text ?? zone.alt_text,
        long_description: data.long_description ?? zone.long_description,
        figure_type: figureCandidateType(data.figure_type ?? zone.figure_type),
        flowchart_guidance: data.flowchart_guidance ?? zone.flowchart_guidance,
      });
      setZoneNotice(mode === "long_desc" ? "Selected zone long description generated." : mode === "both" ? "Selected zone figure text generated." : "Selected zone alt text generated.");
    } catch (error) {
      setZoneError(error instanceof Error ? error.message : "Failed to generate selected zone figure text");
    } finally {
      setGeneratingZoneFigureTextId(null);
    }
  }

  async function saveZones(reviewStatus: "edited" | "remediated" = "edited") {
    if (!editingPage || savingZones) return;
    const issues = validateEditableZones(editableZones, effectiveEditingPage);
    if (reviewStatus === "remediated" && issues.length) {
      const proceed = window.confirm(`This page has ${issues.length} validation issue${issues.length === 1 ? "" : "s"}. Mark it remediated anyway?`);
      if (!proceed) return;
    }
    setSavingZones(true);
    setZoneError(null);
    setZoneNotice(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const res = await fetch(`${API_URL}/canvas/sessions/${sessionId}/documents/${documentId}/tagflow/pages/${editingPage.page_number}/zones`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          review_status: reviewStatus,
          zones: withReadingOrder(editableZones).map((zone) => ({
            ...zone,
            ...bindEditableFigureZone(effectiveEditingPage, zone),
            source: zone.source === "ai" ? "ai" : "manual",
          })),
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to save TagFlow zones"));
      const data = await res.json() as TagFlowDetailResponse;
      const updatedPage = data.tagflow_state?.pages?.find((page) => page.page_number === editingPage.page_number);
      if (updatedPage) {
        setPageOverrides((current) => ({
          ...current,
          [updatedPage.page_number]: updatedPage,
        }));
      }
      setHasUnsavedZoneChanges(false);
      try {
        await queuePagePreviewRefresh(session.access_token, editingPage.page_number, "Saved zones, but failed to queue tagged preview refresh");
      } catch (previewError) {
        setZoneNotice(previewError instanceof Error ? previewError.message : "Saved zones. Tagged preview refresh can be retried from this page.");
      }
      if (onTagFlowUpdated) {
        try {
          await onTagFlowUpdated();
          setPageOverrides((current) => {
            const next = { ...current };
            delete next[editingPage.page_number];
            return next;
          });
        } catch {
          // Keep the local save result visible if the parent refresh misses.
        }
      }
      setSelectedPageIndex(null);
      router.refresh();
    } catch (error) {
      setZoneError(error instanceof Error ? error.message : "Failed to save TagFlow zones");
    } finally {
      setSavingZones(false);
    }
  }

  useEffect(() => {
    shortcutStateRef.current = {
      editingPage,
      selectedZoneCount,
      drawingEnabled,
      draftZone,
      marqueeSelection,
      dragState,
      resizeState,
      redoZones,
      undoZones,
      saveZones,
      zoomEditor,
      clearZoneSelection,
      cancelDrawing,
      closeZoneEditor,
      switchAdjacentEditorPage,
      combineSelectedZoneWithAdjacent,
      refreshCurrentPagePreview,
      applyTagToSelectedZone,
      deleteSelectedZone,
    };
  });

  useEffect(() => {
    if (!editingPage) return undefined;

    function handleShortcut(event: KeyboardEvent) {
      const state = shortcutStateRef.current;
      if (!state?.editingPage) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;

      if (modifier && key === "z" && event.shiftKey) {
        event.preventDefault();
        state.redoZones();
        return;
      }
      if (modifier && key === "z") {
        event.preventDefault();
        state.undoZones();
        return;
      }
      if (modifier && key === "s") {
        event.preventDefault();
        void state.saveZones(event.shiftKey ? "remediated" : "edited");
        return;
      }
      if (modifier && (key === "+" || key === "=")) {
        event.preventDefault();
        state.zoomEditor(1);
        return;
      }
      if (modifier && key === "-") {
        event.preventDefault();
        state.zoomEditor(-1);
        return;
      }
      if (modifier && key === "0") {
        event.preventDefault();
        state.zoomEditor(0);
        return;
      }
      if (modifier || event.altKey) return;
      if (key === "escape") {
        event.preventDefault();
        if (state.selectedZoneCount) {
          state.clearZoneSelection();
        } else if (state.drawingEnabled || state.draftZone || state.marqueeSelection || state.dragState || state.resizeState) {
          setDrawingEnabled(false);
          state.cancelDrawing();
        } else {
          state.closeZoneEditor();
        }
        return;
      }
      if (key === "[" || key === "pageup") {
        event.preventDefault();
        state.switchAdjacentEditorPage(-1);
        return;
      }
      if (key === "]" || key === "pagedown") {
        event.preventDefault();
        state.switchAdjacentEditorPage(1);
        return;
      }
      if (key === "+" || key === "=") {
        event.preventDefault();
        state.zoomEditor(1);
        return;
      }
      if (key === "-") {
        event.preventDefault();
        state.zoomEditor(-1);
        return;
      }
      if (key === "0") {
        event.preventDefault();
        state.zoomEditor(0);
        return;
      }
      if (key === "n") {
        event.preventDefault();
        setDrawingEnabled((current) => !current);
        setOverlaysVisible(true);
        return;
      }
      if (key === "v") {
        event.preventDefault();
        setOverlaysVisible((current) => !current);
        return;
      }
      if (key === "m") {
        event.preventDefault();
        state.combineSelectedZoneWithAdjacent();
        return;
      }
      if (event.shiftKey && key === "r") {
        event.preventDefault();
        void state.refreshCurrentPagePreview();
        return;
      }
      const shortcutTag = TAG_SHORTCUTS[key];
      if (shortcutTag && state.selectedZoneCount) {
        event.preventDefault();
        state.applyTagToSelectedZone(shortcutTag);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        state.deleteSelectedZone();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [editingPage]);

  return (
    <>
      {showPageGrid ? (
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          {visiblePages.map((page, index) => {
          const hasOriginal = page.original_asset?.status === "generated";
          const originalActive = isAssetActive(page.original_asset);
          return (
            <article id={`tagflow-page-${page.page_number}`} key={page.page_number} className="scroll-mt-24 rounded-2xl bg-surface-container-low p-4">
              <button
                type="button"
                className="block w-full rounded-xl text-left transition focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface-container-low disabled:cursor-not-allowed disabled:opacity-70"
                disabled={!hasOriginal}
                onClick={() => {
                  setSelectedPreviewMode("original");
                  setSelectedPageIndex(index);
                }}
                aria-label={`Preview comparison for page ${page.page_number}`}
              >
                <PreviewFrame sessionId={sessionId} documentId={documentId} page={page} variant="original" />
              </button>
              <div className="mt-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-headline text-lg font-bold text-on-surface">{page.label || `Page ${page.page_number}`}</h3>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${pageStatusClass(page.review_status)}`}>
                    {pageStatusLabel(page.review_status)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-on-surface-variant">{reasonLabel(page.selection_reason)}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <StatusPill label="Original" status={assetStatusLabel(page.original_asset)} />
                  <StatusPill label="Tagged" status={assetStatusLabel(page.tagged_asset)} />
                </div>
                <div className={`mt-3 w-fit rounded-full px-3 py-1 text-xs font-bold ${validationStatusClass(page.validation)}`}>
                  Validation: {validationStatusLabel(page.validation)}
                </div>
                {!hasOriginal && originalActive ? (
                  <div className="mt-3 rounded-xl bg-primary-container/40 px-3 py-2 text-xs font-semibold text-on-surface">
                    Preparing preview image. This card will unlock automatically.
                  </div>
                ) : null}
                <button
                  type="button"
                  className="mt-4 w-full rounded-xl bg-surface-container-high px-3 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!hasOriginal}
                  onClick={() => {
                    setSelectedPreviewMode("original");
                    setSelectedPageIndex(index);
                  }}
                >
                  Open preview
                </button>
                <button
                  type="button"
                  className="mt-2 w-full rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!hasOriginal}
                  onClick={() => openZoneEditor(index)}
                >
                  Open page in TagFlow
                </button>
              </div>
            </article>
          );
          })}
          {hiddenPageCount ? (
          <article className="flex min-h-[320px] flex-col justify-center rounded-2xl border border-dashed border-outline-variant/70 bg-surface-container-low p-5 text-center">
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">More Pages</div>
            <div className="mt-3 font-headline text-4xl font-extrabold text-on-surface">+{hiddenPageCount}</div>
            <p className="mx-auto mt-3 max-w-xs text-sm text-on-surface-variant">
              Keep the default view compact, or open the full TagFlow page list for longer PDFs.
            </p>
            <button
              type="button"
              className="mx-auto mt-5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container"
              onClick={() => setShowAllPages(true)}
            >
              View all pages
            </button>
          </article>
        ) : showAllPages && effectivePages.length > COLLAPSED_PAGE_LIMIT ? (
          <article className="flex min-h-[160px] flex-col justify-center rounded-2xl border border-outline-variant/40 bg-surface-container-low p-5 text-center md:col-span-3">
            <div className="text-sm font-semibold text-on-surface">Showing all {effectivePages.length} pages</div>
            <button
              type="button"
              className="mx-auto mt-3 rounded-xl bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
              onClick={() => setShowAllPages(false)}
            >
              Show first {COLLAPSED_PAGE_LIMIT}
            </button>
          </article>
          ) : null}
        </div>
      ) : null}

      {selectedPage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[92vh] w-full max-w-6xl overflow-auto rounded-3xl bg-surface-container-lowest p-5 shadow-xl">
            <div className="flex flex-col gap-3 border-b border-outline-variant/40 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Page {selectedPage.page_number}</p>
                <h3 className="font-headline text-xl font-bold text-on-surface">{selectedPage.label || `Page ${selectedPage.page_number}`}</h3>
              </div>
              <button
                type="button"
                className="w-fit rounded-xl bg-surface-container-high px-4 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container"
                onClick={() => setSelectedPageIndex(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-surface-container-low p-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${selectedPreviewMode === "original" ? "bg-primary text-on-primary" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container-high"}`}
                  onClick={() => setSelectedPreviewMode("original")}
                  aria-pressed={selectedPreviewMode === "original"}
                >
                  Original
                </button>
                <button
                  type="button"
                  className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${selectedPreviewMode === "tagged" ? "bg-primary text-on-primary" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container-high"}`}
                  onClick={() => setSelectedPreviewMode("tagged")}
                  aria-pressed={selectedPreviewMode === "tagged"}
                >
                  Tagged overlay
                </button>
              </div>
              <div className="text-xs font-semibold text-on-surface-variant">
                {selectedPreviewMode === "tagged" ? "Overlay is rendered from saved TagFlow zones." : "Original preview without TagFlow overlays."}
              </div>
            </div>
            {effectivePages.length > 1 ? (
              <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-surface-container-low p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-xl bg-surface-container-lowest px-3 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!canMovePrevious}
                    onClick={() => setSelectedPageIndex((current) => current === null ? current : Math.max(0, current - 1))}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-surface-container-lowest px-3 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!canMoveNext}
                    onClick={() => setSelectedPageIndex((current) => current === null ? current : Math.min(effectivePages.length - 1, current + 1))}
                  >
                    Next
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {effectivePages.map((pageOption, index) => {
                    const active = index === selectedPageIndex;
                    return (
                      <button
                        key={pageOption.page_number}
                        type="button"
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${active ? "bg-primary text-on-primary" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container-high"}`}
                        onClick={() => setSelectedPageIndex(index)}
                        aria-current={active ? "page" : undefined}
                      >
                        Page {pageOption.page_number}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className="mt-5">
              <LiveOverlayPreview
                sessionId={sessionId}
                documentId={documentId}
                page={selectedPage}
                showOverlay={selectedPreviewMode === "tagged"}
              />
            </div>
          </div>
        </div>
      ) : null}

      {editingPage ? (
        <div className="fixed inset-0 z-50 bg-surface-container-lowest" role="dialog" aria-modal="true">
          <div className="flex h-screen min-h-0 flex-col">
            <header className="flex flex-col gap-3 border-b border-outline-variant/40 bg-surface-container-lowest px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">TagFlow editor</div>
                <h3 className="truncate font-headline text-xl font-bold text-on-surface">{editingPage.label || `Page ${editingPage.page_number}`}</h3>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Page {editingPage.page_number}
                  {generatedPageIndexes.length ? ` · ${editingGeneratedIndex + 1} of ${generatedPageIndexes.length} editable pages` : ""}
                  {hasUnsavedZoneChanges ? " · unsaved changes" : ""}
                </p>
                <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-bold ${pageStatusClass(editingPage.review_status)}`}>
                  {pageStatusLabel(editingPage.review_status)}
                </span>
                <span className={`ml-2 mt-2 inline-flex rounded-full px-3 py-1 text-xs font-bold ${currentValidationIssues.length ? "bg-error-container text-error" : validationStatusClass(editingPage.validation)}`}>
                  {currentValidationIssues.length
                    ? `${currentValidationIssues.length} issue${currentValidationIssues.length === 1 ? "" : "s"}`
                    : validationStatusLabel(editingPage.validation)}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-xl bg-surface-container-high px-4 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canEditPreviousPage}
                  onClick={() => switchAdjacentEditorPage(-1)}
                >
                  Previous page
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-surface-container-high px-4 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canEditNextPage}
                  onClick={() => switchAdjacentEditorPage(1)}
                >
                  Next page
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-surface-container-high px-3 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container"
                  onClick={() => zoomEditor(-1)}
                  title="Zoom out (-)"
                >
                  -
                </button>
                <span className="rounded-xl bg-surface-container-low px-3 py-2 text-sm font-semibold text-on-surface">
                  {Math.round(editorZoom * 100)}%
                </span>
                <button
                  type="button"
                  className="rounded-xl bg-surface-container-high px-3 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container"
                  onClick={() => zoomEditor(1)}
                  title="Zoom in (+)"
                >
                  +
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-surface-container-high px-4 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={refreshingPreview}
                  onClick={() => void refreshCurrentPagePreview()}
                  title="Queue preview refresh (Shift+R)"
                >
                  {refreshingPreview ? "Queueing" : "Refresh preview"}
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={savingZones}
                  onClick={() => void saveZones("edited")}
                >
                  {savingZones ? "Saving" : "Save zones"}
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-primary/50 bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-primary-container/35 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={savingZones}
                  onClick={() => void saveZones("remediated")}
                >
                  Save & mark remediated
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-surface-container-high px-4 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container"
                  onClick={closeZoneEditor}
                >
                  Close
                </button>
              </div>
            </header>
            {zoneError ? (
              <div className="mx-4 mt-3 rounded-xl border border-error/30 bg-error-container px-4 py-3 text-sm font-semibold text-error">
                {zoneError}
              </div>
            ) : null}
            {zoneNotice ? (
              <div className="mx-4 mt-3 rounded-xl border border-outline-variant/50 bg-surface-container-low px-4 py-3 text-sm font-semibold text-on-surface-variant">
                {zoneNotice}
              </div>
            ) : null}
            <div
              className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[var(--tagflow-left)_10px_minmax(0,1fr)_10px_var(--tagflow-right)]"
              style={{
                "--tagflow-left": `${leftRailWidth}px`,
                "--tagflow-right": `${rightRailWidth}px`,
              } as CSSProperties}
            >
              <aside className="hidden min-h-0 border-r border-outline-variant/40 bg-surface-container-low p-3 lg:block">
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Pages</div>
                <div className="mt-3 max-h-[calc(100vh-116px)] space-y-2 overflow-auto pr-1">
                  {generatedPageIndexes.map((pageIndex) => {
                    const page = effectivePages[pageIndex];
                    const active = pageIndex === editingPageIndex;
                    return (
                      <button
                        key={page.page_number}
                        type="button"
                        className={`w-full rounded-xl p-2 text-left transition-colors ${active ? "bg-primary text-on-primary" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container-high"}`}
                        onClick={() => switchZoneEditorPage(pageIndex)}
                        aria-current={active ? "page" : undefined}
                      >
                        <div className={`overflow-hidden rounded-lg border ${active ? "border-on-primary/40 bg-on-primary/10" : "border-outline-variant/40 bg-surface-container-low"}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- Authenticated thumbnails are served through the local API proxy. */}
                          <img
                            src={assetSrc(sessionId, documentId, page.page_number, "original", page.original_asset)}
                            alt={`Thumbnail for page ${page.page_number}`}
                            className="aspect-[3/4] w-full object-contain"
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-xs font-bold">Page {page.page_number}</span>
                          <span className="text-[10px] opacity-80">{page.zones?.length || 0} zones</span>
                        </div>
                        <div className={`mt-2 w-fit rounded-full px-2 py-0.5 text-[10px] font-bold ${active ? "bg-on-primary/15 text-on-primary" : pageStatusClass(page.review_status)}`}>
                          {pageStatusLabel(page.review_status)}
                        </div>
                        <div className={`mt-1 w-fit rounded-full px-2 py-0.5 text-[10px] font-bold ${active ? "bg-on-primary/15 text-on-primary" : validationStatusClass(page.validation)}`}>
                          {validationStatusLabel(page.validation)}
                        </div>
                        <div className="mt-1 truncate text-xs opacity-80">
                          {page.label || `Page ${page.page_number}`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </aside>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Drag to resize page rail"
                title="Drag to resize page rail"
                className="group hidden cursor-col-resize items-center justify-center bg-surface-container-low transition-colors hover:bg-primary/15 lg:flex"
                onPointerDown={(event) => startSidebarResize("left", event)}
              >
                <span className="h-12 w-1 rounded-full bg-outline-variant/70 transition-colors group-hover:bg-primary/70" />
              </div>
              <main className="min-h-0 overflow-auto bg-surface p-5">
                <div
                  ref={editorFrameRef}
                  className="relative mx-auto origin-top"
                  style={{
                    width: `${editorCanvasWidth}px`,
                    maxWidth: editorZoom <= 1 ? "100%" : "none",
                  }}
                >
                  <PreviewFrame
                    sessionId={sessionId}
                    documentId={documentId}
                    page={editingPage}
                    variant="original"
                    large
                    canvas
                    imageRef={editorImageRef}
                    onImageLoad={() => {
                      requestAnimationFrame(() => {
                        const frameElement = editorFrameRef.current;
                        const imageElement = editorImageRef.current;
                        if (!frameElement || !imageElement?.naturalWidth || !imageElement.naturalHeight) return;
                        const frameRect = frameElement.getBoundingClientRect();
                        const imageRect = imageElement.getBoundingClientRect();
                        const imageAspect = imageElement.naturalWidth / imageElement.naturalHeight;
                        const containerAspect = imageRect.width / imageRect.height;
                        let renderedWidth = imageRect.width;
                        let renderedHeight = imageRect.height;
                        let renderedLeft = imageRect.left - frameRect.left;
                        let renderedTop = imageRect.top - frameRect.top;

                        if (imageAspect > containerAspect) {
                          renderedHeight = imageRect.width / imageAspect;
                          renderedTop += (imageRect.height - renderedHeight) / 2;
                        } else {
                          renderedWidth = imageRect.height * imageAspect;
                          renderedLeft += (imageRect.width - renderedWidth) / 2;
                        }

                        setEditorOverlayBox({
                          left: renderedLeft,
                          top: renderedTop,
                          width: renderedWidth,
                          height: renderedHeight,
                        });
                      });
                    }}
                  />
                  <div
                    ref={editorOverlayRef}
                    className={`absolute ${drawingEnabled ? "cursor-crosshair" : "cursor-default"}`}
                    style={editorOverlayStyle}
                    onPointerDown={(event) => {
                      startDrawing(event);
                      startMarqueeSelection(event);
                    }}
                    onPointerMove={(event) => {
                      updateDrawing(event);
                      updateMarqueeSelection(event);
                      updateZoneDrag(event);
                      updateZoneResize(event);
                    }}
                    onPointerUp={(event) => {
                      finishDrawing(event);
                      finishMarqueeSelection(event);
                      finishZoneDrag(event);
                      finishZoneResize(event);
                    }}
                    onPointerCancel={cancelDrawing}
                  >
                    {overlaysVisible ? editableZones.map((zone, index) => {
                      const selected = selectedZoneIds.includes(zone.id);
                      const colors = tagColors(zone.tag);
                      return (
                        <button
                          key={zone.id}
                          type="button"
                          className="absolute box-border touch-none border-2 p-0 text-left transition-colors"
                          style={{
                            left: `${zone.x}%`,
                            top: `${zone.y}%`,
                            width: `${zone.width}%`,
                            height: `${zone.height}%`,
                            borderColor: selected ? "var(--color-primary)" : colors.border,
                            borderStyle: isArtifactZone(zone) ? "dashed" : "solid",
                            backgroundColor: selected ? "color-mix(in srgb, var(--color-primary-container) 30%, transparent)" : colors.bg,
                            boxShadow: selected ? `0 0 0 2px ${colors.border}55` : "none",
                          }}
                          onPointerDown={(event) => startMovingZone(event, zone)}
                          onClick={(event) => {
                            event.stopPropagation();
                            selectZone(zone.id, event.shiftKey);
                            setDrawingEnabled(false);
                          }}
                          aria-label={`Select zone ${index + 1}, ${zone.tag}`}
                        >
                          <span
                            className="absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-bold"
                            style={{
                              backgroundColor: selected ? "var(--color-primary)" : colors.labelBg,
                              color: selected ? "var(--color-on-primary)" : colors.labelText,
                            }}
                          >
                            {index + 1}. {zone.tag}
                          </span>
                          {selected ? (
                            <span
                              className="absolute bottom-[-5px] right-[-5px] h-3 w-3 cursor-nwse-resize rounded-full border border-primary bg-on-primary shadow-sm"
                              onPointerDown={(event) => startResizingZone(event, zone)}
                              aria-hidden="true"
                            />
                          ) : null}
                        </button>
                      );
                    }) : null}
                    {draftZone && overlaysVisible ? (
                      <div
                        className="absolute border-2 border-dashed border-primary bg-primary-container/20"
                        style={{
                          left: `${draftZone.x}%`,
                          top: `${draftZone.y}%`,
                          width: `${draftZone.width}%`,
                          height: `${draftZone.height}%`,
                        }}
                      />
                    ) : null}
                    {marqueeSelection && !drawingEnabled ? (
                      <div
                        className="pointer-events-none absolute border-2 border-primary bg-primary-container/20"
                        style={{
                          left: `${marqueeSelection.x}%`,
                          top: `${marqueeSelection.y}%`,
                          width: `${marqueeSelection.width}%`,
                          height: `${marqueeSelection.height}%`,
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              </main>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Drag to resize tools panel"
                title="Drag to resize tools panel"
                className="group hidden cursor-col-resize items-center justify-center bg-surface-container-low transition-colors hover:bg-primary/15 lg:flex"
                onPointerDown={(event) => startSidebarResize("right", event)}
              >
                <span className="h-12 w-1 rounded-full bg-outline-variant/70 transition-colors group-hover:bg-primary/70" />
              </div>
              <aside className="min-h-0 overflow-auto border-l border-outline-variant/40 bg-surface-container-low p-4">
                <div className="flex items-start gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-headline text-lg font-bold text-on-surface">Tagging</h4>
                      <Tooltip
                        content="Drag on the page to move or resize zones. Drag rows to adjust reading order. Drag side dividers to resize panels."
                        side="bottom"
                        align="start"
                      >
                        <button
                          type="button"
                          className="rounded-full p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                          aria-label="Zone editing tips"
                        >
                          <HelpCircle size={15} />
                        </button>
                      </Tooltip>
                    </div>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {drawingEnabled ? "Draw mode is on. Drag on the page to create a zone." : selectedZoneCount ? `${selectedZoneCount} zone${selectedZoneCount === 1 ? "" : "s"} selected.` : "Select a zone or press N to draw one."}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    className={`rounded-xl px-3 py-2 font-semibold transition-colors ${drawingEnabled ? "bg-primary text-on-primary" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container-high"}`}
                    onClick={() => {
                      setDrawingEnabled((current) => !current);
                      setOverlaysVisible(true);
                    }}
                  >
                    Draw zone <kbd className="ml-1 rounded bg-black/10 px-1 py-0.5 text-[10px]">N</kbd>
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-surface-container-lowest px-3 py-2 font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
                    onClick={() => setOverlaysVisible((current) => !current)}
                  >
                    {overlaysVisible ? "Hide" : "Show"} overlays <kbd className="ml-1 rounded bg-black/10 px-1 py-0.5 text-[10px]">V</kbd>
                  </button>
                </div>
                <div className="mt-4 overflow-hidden rounded-2xl bg-surface-container-lowest">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-container-low"
                    onClick={() => setLayoutHintOpen((current) => !current)}
                    aria-expanded={layoutHintOpen}
                  >
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Layout hint</div>
                      <div className="mt-1 text-xs font-semibold text-on-surface-variant">
                        Current: {layoutHintLabel(currentLayoutHint)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-surface-container-low px-2.5 py-1 text-[11px] font-bold text-on-surface-variant">
                        AI context
                      </span>
                      <ChevronDown size={16} className={`text-on-surface-variant transition-transform ${layoutHintOpen ? "rotate-180" : ""}`} />
                    </div>
                  </button>
                  {layoutHintOpen ? (
                    <div className="border-t border-outline-variant/30 px-4 pb-4 pt-3">
                      <select
                        className="w-full rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2 text-sm font-semibold text-on-surface outline-none transition-colors focus:border-primary"
                        value={layoutHintDraft}
                        onChange={(event) => setLayoutHintDraft(normalizeLayoutHint(event.target.value))}
                      >
                        {TAGFLOW_LAYOUT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      {aiSuggestionStatus === "stale" ? (
                        <div className="mt-3 rounded-xl bg-primary-container/30 px-3 py-2 text-xs font-semibold text-on-surface">
                          Suggestions are stale. Regenerate zones after saving the layout hint.
                        </div>
                      ) : null}
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <button
                          type="button"
                          className="rounded-xl bg-surface-container-low px-3 py-2 font-semibold text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={Boolean(savingLayoutHint)}
                          onClick={() => void saveLayoutHint("page")}
                        >
                          {savingLayoutHint === "page" ? "Saving" : "Apply to page"}
                        </button>
                        <button
                          type="button"
                          className="rounded-xl bg-surface-container-low px-3 py-2 font-semibold text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={Boolean(savingLayoutHint)}
                          onClick={() => void saveLayoutHint("document")}
                        >
                          {savingLayoutHint === "document" ? "Saving" : "Apply to document"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="mt-4 overflow-hidden rounded-2xl bg-surface-container-lowest">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-container-low"
                    onClick={() => setTagHotkeysOpen((current) => !current)}
                    aria-expanded={tagHotkeysOpen}
                  >
                    <span className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Tag hotkeys</span>
                    <ChevronDown size={16} className={`text-on-surface-variant transition-transform ${tagHotkeysOpen ? "rotate-180" : ""}`} />
                  </button>
                  {tagHotkeysOpen ? (
                  <div className="grid grid-cols-3 gap-2 px-4 pb-4 text-xs">
                    {[
                      ["1", "H1"],
                      ["2", "H2"],
                      ["3", "H3"],
                      ["4", "H4"],
                      ["5", "H5"],
                      ["6", "H6"],
                      ["P", "P"],
                      ["L", "L"],
                      ["I", "LI"],
                      ["F", "Figure"],
                      ["T", "Table"],
                      ["S", "Span"],
                      ["A", "Artifact"],
                      ["D", "Artifact"],
                    ].map(([keyLabel, tag]) => (
                      <button
                        key={`${keyLabel}-${tag}`}
                        type="button"
                        className={`rounded-xl px-2 py-2 font-semibold transition-colors ${selectedZoneCount ? "bg-surface-container-low text-on-surface hover:bg-surface-container-high" : "bg-surface-container-low text-on-surface-variant/60"}`}
                        disabled={!selectedZoneCount}
                        onClick={() => applyTagToSelectedZone(tag)}
                        title={`Set selected zone to ${tag}`}
                      >
                        <kbd className="mr-1 rounded bg-black/10 px-1 py-0.5 text-[10px]">{keyLabel}</kbd>
                        {tag}
                      </button>
                    ))}
                  </div>
                  ) : null}
                  {tagHotkeysOpen ? (
                  <p className="px-4 pb-4 text-xs text-on-surface-variant">
                    Select a zone, then press a tag key. Use 1-6 for heading levels. Artifact marks decorative or non-content regions and skips reading order.
                  </p>
                  ) : null}
                </div>
                <div className="mt-4 rounded-2xl bg-surface-container-lowest p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Extracted text</div>
                    <span className="rounded-full bg-surface-container-low px-2.5 py-1 text-[11px] font-bold text-on-surface-variant">
                      {selectedZoneCount ? `${selectedExtractedTextBlocks.length} block${selectedExtractedTextBlocks.length === 1 ? "" : "s"}` : "No zone"}
                    </span>
                  </div>
                  {selectedZoneCount ? (
                    selectedExtractedText ? (
                      <div className="mt-3 max-h-32 overflow-auto rounded-xl bg-surface-container-low px-3 py-2 text-xs leading-relaxed text-on-surface">
                        {selectedExtractedText}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-on-surface-variant">
                        No extracted PDF text overlaps the selected zone. This may be an image, artifact, scanned content, or a zone outside detected text bounds.
                      </p>
                    )
                  ) : (
                    <p className="mt-3 text-xs text-on-surface-variant">
                      Select a zone to inspect overlapping PDF text from the baseline analysis.
                    </p>
                  )}
                </div>
                <div className="mt-4 rounded-2xl bg-surface-container-lowest p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Figure candidates</div>
                    <span className="rounded-full bg-surface-container-low px-2.5 py-1 text-[11px] font-bold text-on-surface-variant">
                      {selectedZoneCount ? `${visibleFigureCandidates.length} match${visibleFigureCandidates.length === 1 ? "" : "es"}` : "No zone"}
                    </span>
                  </div>
                  {selectedZoneCount ? (
                    <>
                    {selectedFigureZone ? (
                      <div className="mt-3 rounded-xl bg-surface-container-low px-3 py-2 text-xs text-on-surface">
                        <div className="flex items-center justify-between gap-2 font-semibold">
                          <span>Selected zone crop</span>
                          <span className="text-on-surface-variant">
                            {Math.round(selectedFigureZone.width)}% x {Math.round(selectedFigureZone.height)}%
                          </span>
                        </div>
                        <p className="mt-1 text-on-surface-variant">
                          Use this for flattened slides where the PDF only exposes a whole-page image.
                        </p>
                        <div className="mt-2 space-y-2">
                          <select
                            className="w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                            value={selectedFigureZone.figure_type ?? "image"}
                            onChange={(event) => {
                              const figureType = event.target.value as "image" | "diagram" | "flowchart";
                              updateFigureZoneText(selectedFigureZone.id, {
                                figure_type: figureType,
                                flowchart: figureType === "flowchart" ? normalizeFlowchartStructure(selectedFigureZone.flowchart, selectedFigureZone.flowchart_guidance ?? "") : null,
                              });
                            }}
                            aria-label="Selected zone figure type"
                          >
                            <option value="image">Image</option>
                            <option value="diagram">Diagram</option>
                            <option value="flowchart">Flowchart</option>
                          </select>
                          <textarea
                            className="min-h-20 w-full resize-y rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface outline-none transition-colors focus:border-primary"
                            value={selectedFigureZone.alt_text ?? ""}
                            onChange={(event) => updateFigureZoneText(selectedFigureZone.id, { alt_text: event.target.value })}
                            placeholder="Alt text for this selected figure zone"
                          />
                          <textarea
                            className="min-h-20 w-full resize-y rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface outline-none transition-colors focus:border-primary"
                            value={selectedFigureZone.long_description ?? ""}
                            onChange={(event) => updateFigureZoneText(selectedFigureZone.id, { long_description: event.target.value })}
                            placeholder="Optional long description for this selected figure zone"
                          />
                          {(selectedFigureZone.figure_type ?? "image") !== "image" ? (
                            <>
                              <textarea
                                className="min-h-16 w-full resize-y rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface outline-none transition-colors focus:border-primary"
                                value={selectedFigureZone.flowchart_guidance ?? ""}
                                onChange={(event) => updateFigureZoneText(selectedFigureZone.id, { flowchart_guidance: event.target.value })}
                                placeholder="Flow guidance, e.g. Start -> Decision; Decision -> Yes path"
                              />
                              {(selectedFigureZone.figure_type ?? "image") === "flowchart" ? (
                                <div className="flex flex-col gap-2 rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="text-[11px] text-on-surface-variant">
                                    <span className="font-bold text-on-surface">{normalizeFlowchartStructure(selectedFigureZone.flowchart, selectedFigureZone.flowchart_guidance ?? "").nodes.length}</span> node{normalizeFlowchartStructure(selectedFigureZone.flowchart, selectedFigureZone.flowchart_guidance ?? "").nodes.length === 1 ? "" : "s"} / <span className="font-bold text-on-surface">{normalizeFlowchartStructure(selectedFigureZone.flowchart, selectedFigureZone.flowchart_guidance ?? "").connections.length}</span> connection{normalizeFlowchartStructure(selectedFigureZone.flowchart, selectedFigureZone.flowchart_guidance ?? "").connections.length === 1 ? "" : "s"}
                                  </div>
                                  <button
                                    type="button"
                                    className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-bold text-on-primary transition-colors hover:bg-primary-container"
                                    onClick={() => setFlowchartZoneModalId(selectedFigureZone.id)}
                                  >
                                    Build flowchart
                                  </button>
                                </div>
                              ) : null}
                            </>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded-lg bg-surface-container-high px-2.5 py-1.5 text-[11px] font-bold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={generatingZoneFigureTextId === selectedFigureZone.id}
                              onClick={() => void generateSelectedZoneFigureText("alt")}
                            >
                              {generatingZoneFigureTextId === selectedFigureZone.id ? "Generating" : "Generate zone alt"}
                            </button>
                            <button
                              type="button"
                              className="rounded-lg bg-surface-container-high px-2.5 py-1.5 text-[11px] font-bold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={generatingZoneFigureTextId === selectedFigureZone.id}
                              onClick={() => void generateSelectedZoneFigureText("long_desc")}
                            >
                              Generate zone long
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {visibleFigureCandidates.length ? (
                      <div className="mt-3 space-y-2">
                        {visibleFigureCandidates.slice(0, 3).map((candidate) => (
                          <div key={candidate.id || `${candidate.source}-${candidate.overlap_score}`} className="rounded-xl bg-surface-container-low px-3 py-2 text-xs text-on-surface">
                            {(() => {
                              const dismissKey = figureCandidateDismissKey(editingPage?.page_number, candidate.id);
                              const altDisabled = Boolean(
                                candidate.is_decorative
                                || candidate.figure_status === "decorative"
                                || candidate.review_action === "ignore"
                                || selectedZones.every(isArtifactZone)
                              );
                              return (
                                <>
                            <div className="flex items-center justify-between gap-2 font-semibold">
                              <span>{figureCandidateStatusLabel(candidate)}</span>
                              <span className="flex items-center gap-2 text-on-surface-variant">
                                {Math.round(candidate.overlap_score * 100)}% overlap
                                {dismissKey ? (
                                  <button
                                    type="button"
                                    className="rounded-md px-1.5 py-0.5 text-[10px] font-bold text-on-surface-variant transition-colors hover:bg-surface-container-lowest hover:text-on-surface"
                                    onClick={() => setDismissedFigureCandidateKeys((current) => ({ ...current, [dismissKey]: true }))}
                                  >
                                    Dismiss
                                  </button>
                                ) : null}
                              </span>
                            </div>
                            <div className="mt-1 text-on-surface-variant">
                              {candidate.fragment_count || 1} PDF image fragment{(candidate.fragment_count || 1) === 1 ? "" : "s"} grouped
                              {candidate.confidence ? ` · ${Math.round(candidate.confidence * 100)}% confidence` : ""}
                              {candidate.full_page_likely ? " · full-page fallback" : ""}
                            </div>
                            {candidate.alt_text ? (
                              <div className="mt-2 line-clamp-3 rounded-lg bg-surface-container-lowest px-2 py-1.5 text-on-surface-variant">
                                Alt: {candidate.alt_text}
                              </div>
                            ) : null}
                            {candidate.has_long_description ? (
                              <div className="mt-1 text-[11px] font-semibold text-on-surface-variant">
                                Long description saved
                              </div>
                            ) : null}
                            {candidate.figure_inventory_id ? (
                              <div className="mt-2 space-y-2">
                                <select
                                  className="w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                                  value={figureTypeDrafts[candidate.figure_inventory_id] ?? figureCandidateType(candidate.figure_type)}
                                  onChange={(event) => setFigureTypeDrafts((current) => ({
                                    ...current,
                                    [candidate.figure_inventory_id!]: event.target.value as "image" | "diagram" | "flowchart",
                                  }))}
                                  disabled={altDisabled}
                                  aria-label="Figure type"
                                >
                                  <option value="image">Image</option>
                                  <option value="diagram">Diagram</option>
                                  <option value="flowchart">Flowchart</option>
                                </select>
                                <textarea
                                  className="min-h-20 w-full resize-y rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                                  value={figureAltDrafts[candidate.figure_inventory_id] ?? candidate.alt_text ?? ""}
                                  onChange={(event) => setFigureAltDrafts((current) => ({
                                    ...current,
                                    [candidate.figure_inventory_id!]: event.target.value,
                                  }))}
                                  disabled={altDisabled}
                                  placeholder={altDisabled ? "Alt text is disabled for decorative or artifact figures" : "Add alt text for this figure"}
                                />
                                <textarea
                                  className="min-h-20 w-full resize-y rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                                  value={figureLongDescriptionDrafts[candidate.figure_inventory_id] ?? candidate.long_description ?? ""}
                                  onChange={(event) => setFigureLongDescriptionDrafts((current) => ({
                                    ...current,
                                    [candidate.figure_inventory_id!]: event.target.value,
                                  }))}
                                  disabled={altDisabled}
                                  placeholder="Optional long description"
                                />
                                {(figureTypeDrafts[candidate.figure_inventory_id] ?? figureCandidateType(candidate.figure_type)) !== "image" ? (
                                  <textarea
                                    className="min-h-16 w-full resize-y rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                                    value={figureGuidanceDrafts[candidate.figure_inventory_id] ?? candidate.flowchart_guidance ?? ""}
                                    onChange={(event) => setFigureGuidanceDrafts((current) => ({
                                      ...current,
                                      [candidate.figure_inventory_id!]: event.target.value,
                                    }))}
                                    disabled={altDisabled}
                                    placeholder="Flow guidance, e.g. Start -> Decision; Decision -> Yes path"
                                  />
                                ) : null}
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className="rounded-lg bg-surface-container-high px-2.5 py-1.5 text-[11px] font-bold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={altDisabled || generatingFigureAltId === candidate.figure_inventory_id || savingFigureAltId === candidate.figure_inventory_id}
                                    onClick={() => void generateFigureText(candidate, "alt")}
                                  >
                                    {generatingFigureAltId === candidate.figure_inventory_id ? "Generating" : "Generate alt text"}
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded-lg bg-surface-container-high px-2.5 py-1.5 text-[11px] font-bold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={altDisabled || generatingFigureAltId === candidate.figure_inventory_id || savingFigureAltId === candidate.figure_inventory_id}
                                    onClick={() => void generateFigureText(candidate, "long_desc")}
                                  >
                                    Generate long
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-bold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={altDisabled || savingFigureAltId === candidate.figure_inventory_id || generatingFigureAltId === candidate.figure_inventory_id}
                                    onClick={() => void saveFigureAltText(candidate)}
                                  >
                                    {savingFigureAltId === candidate.figure_inventory_id ? "Saving" : "Save figure text"}
                                  </button>
                                  {(candidate.is_decorative || candidate.figure_status === "decorative" || candidate.review_action === "ignore") ? (
                                    <button
                                      type="button"
                                      className="rounded-lg bg-surface-container-high px-2.5 py-1.5 text-[11px] font-bold text-on-surface transition-colors hover:bg-surface-container"
                                      onClick={() => applyTagToSelectedZone("Artifact")}
                                    >
                                      Mark zone as Artifact
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}
                                </>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-on-surface-variant">
                        No grouped PDF figure candidate overlaps this zone. If this is visibly an image, it may be vector artwork, text-as-paths, or a figure that should be captured from the zone during export.
                      </p>
                    )}
                    </>
                  ) : (
                    <p className="mt-3 text-xs text-on-surface-variant">
                      Select a figure zone to inspect grouped PDF image fragments for future alt-text generation.
                    </p>
                  )}
                  {editingPage?.diagnostics?.likely_ocr_gap ? (
                    <p className="mt-3 rounded-xl bg-error-container/40 px-3 py-2 text-xs font-semibold text-error">
                      This page has sparse extractable text and image content. OCR or visual AI may be needed for complete tagging.
                    </p>
                  ) : null}
                </div>
                <div className="mt-4">
                  <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Reading Order</div>
                  <div className="mt-1 text-xs text-on-surface-variant">Drag to reorder content zones. Artifact / decorative zones are skipped at export.</div>
                </div>
                <div className="mt-2 divide-y divide-outline-variant/30 overflow-hidden rounded-2xl bg-surface-container-lowest">
                  {editableZones.length ? editableZones.map((zone, index) => {
                    const dropPosition = readingOrderDropTarget?.zoneId === zone.id ? readingOrderDropTarget.position : null;
                    return (
                    <div
                      key={zone.id}
                      className={`relative px-2.5 py-2 transition-colors ${selectedZoneIds.includes(zone.id) ? "bg-primary-container/20" : "bg-surface-container-lowest"} ${draggedZoneId === zone.id ? "opacity-60" : ""} ${dropPosition ? "bg-primary-container/10" : ""}`}
                      onDragOver={(event) => updateReadingOrderDropTarget(event, zone.id)}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (draggedZoneId && dropPosition) reorderZone(draggedZoneId, zone.id, dropPosition);
                        setDraggedZoneId(null);
                        setReadingOrderDropTarget(null);
                      }}
                    >
                      {dropPosition === "before" ? (
                        <div className="pointer-events-none absolute inset-x-3 top-0 z-10 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
                          <span className="h-0.5 flex-1 rounded-full bg-primary" />
                          <span className="rounded-full bg-primary px-2 py-0.5 text-on-primary shadow-sm">Drop here</span>
                          <span className="h-0.5 flex-1 rounded-full bg-primary" />
                        </div>
                      ) : null}
                      {dropPosition === "after" ? (
                        <div className="pointer-events-none absolute inset-x-3 bottom-0 z-10 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
                          <span className="h-0.5 flex-1 rounded-full bg-primary" />
                          <span className="rounded-full bg-primary px-2 py-0.5 text-on-primary shadow-sm">Drop here</span>
                          <span className="h-0.5 flex-1 rounded-full bg-primary" />
                        </div>
                      ) : null}
                      <div className="flex items-center gap-1.5">
                        <div
                          draggable
                          role="button"
                          tabIndex={0}
                          className="grid cursor-grab grid-cols-2 gap-0.5 px-1 py-0.5 active:cursor-grabbing"
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            setDraggedZoneId(zone.id);
                            setReadingOrderDropTarget(null);
                          }}
                          onClick={(event) => event.stopPropagation()}
                          onDragEnd={() => {
                            setDraggedZoneId(null);
                            setReadingOrderDropTarget(null);
                          }}
                          aria-label={`Drag zone ${index + 1} to change reading order`}
                        >
                          {Array.from({ length: 6 }).map((_, dotIndex) => (
                            <span key={dotIndex} className="h-1 w-1 rounded-full bg-on-surface-variant/40" />
                          ))}
                        </div>
                        <button
                          type="button"
                          className={`min-w-7 text-left text-xs font-semibold transition-colors hover:text-primary ${isArtifactZone(zone) ? "text-on-surface-variant/70" : "text-on-surface-variant"}`}
                          onClick={(event) => selectZone(zone.id, event.shiftKey)}
                        >
                          {isArtifactZone(zone) ? "Skip" : `${contentZoneOrder.get(zone.id) || index + 1}.`}
                        </button>
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: tagColors(zone.tag).border }}
                        />
                        <label className="w-14 text-xs font-semibold text-on-surface-variant">
                          <span className="sr-only">Tag for zone {index + 1}</span>
                          <select
                            value={zone.tag}
                            onChange={(event) => {
                              const tag = event.target.value;
                              commitZones((zones) => withReadingOrder(zones.map((item) => item.id === zone.id ? { ...item, tag } : item)));
                            }}
                            className="w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-xs font-semibold text-on-surface-variant hover:border-outline-variant/50 hover:bg-surface-container-low"
                          >
                            {TAG_OPTIONS.map((tag) => (
                              <option key={tag} value={tag}>{tag}</option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-on-surface"
                          onClick={(event) => selectZone(zone.id, event.shiftKey)}
                          title={`Zone ${index + 1}`}
                        >
                          Zone {index + 1}
                          {isArtifactZone(zone) ? (
                            <span className="ml-1.5 rounded-full bg-surface-container-low px-1.5 py-0.5 text-[10px] font-bold text-on-surface-variant">
                              Decorative / skipped
                            </span>
                          ) : null}
                        </button>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="rounded-lg px-1 py-0.5 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:text-on-surface-variant/40"
                            disabled={index === 0}
                            onClick={() => moveZone(index, -1)}
                            aria-label={`Move zone ${index + 1} up`}
                          >
                            ^
                          </button>
                          <button
                            type="button"
                            className="rounded-lg px-1 py-0.5 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:text-on-surface-variant/40"
                            disabled={index === editableZones.length - 1}
                            onClick={() => moveZone(index, 1)}
                            aria-label={`Move zone ${index + 1} down`}
                          >
                            v
                          </button>
                        </div>
                        <button
                          type="button"
                          className="rounded-lg px-1.5 py-0.5 text-xs font-bold text-on-surface-variant transition-colors hover:bg-surface-container-low"
                          onClick={() => {
                            selectZone(zone.id);
                            setOpenZoneMenuId((current) => current === zone.id ? null : zone.id);
                          }}
                          aria-expanded={openZoneMenuId === zone.id}
                          aria-label={`Open options for zone ${index + 1}`}
                        >
                          ...
                        </button>
                      </div>
                      {openZoneMenuId === zone.id ? (
                        <div className="mt-3 rounded-xl bg-surface-container-low px-3 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="text-xs font-bold uppercase tracking-[0.12em] text-on-surface-variant">Zone options</div>
                              <div className="mt-1 text-xs text-on-surface-variant">Fine tune position or remove this zone.</div>
                            </div>
                            <button
                              type="button"
                              className="rounded-lg px-2 py-1 text-xs font-semibold text-error transition-colors hover:bg-error-container"
                              onClick={() => removeZone(zone.id)}
                            >
                              Remove
                            </button>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                          {(["x", "y", "width", "height"] as const).map((field) => (
                            <label key={field} className="text-xs font-semibold capitalize text-on-surface-variant">
                              {field}
                              <input
                                type="number"
                                min={field === "width" || field === "height" ? 1 : 0}
                                max={100}
                                step={0.5}
                                value={zone[field]}
                                onChange={(event) => updateZone(zone.id, { [field]: Number(event.target.value) || 0 })}
                                className="mt-1 w-full rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-2 py-1.5 text-sm text-on-surface"
                              />
                            </label>
                          ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    );
                  }) : (
                    <div className="rounded-xl bg-surface-container-lowest p-4 text-sm text-on-surface-variant">
                      Draw zones to begin defining reading order and tags for this page.
                    </div>
                  )}
                </div>
                <div className="mt-4 overflow-hidden rounded-2xl bg-surface-container-lowest">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    onClick={() => setShowDocumentMetadata((current) => !current)}
                    aria-expanded={showDocumentMetadata}
                  >
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Document</div>
                      <div className="mt-1 text-xs text-on-surface-variant">PDF title and language for export readiness.</div>
                    </div>
                    <ChevronDown
                      size={16}
                      className={`shrink-0 text-on-surface-variant transition-transform ${showDocumentMetadata ? "rotate-180" : ""}`}
                    />
                  </button>
                  {showDocumentMetadata ? (
                    <div className="space-y-3 border-t border-outline-variant/30 px-4 py-3">
                      <label className="block">
                        <span className="text-xs font-semibold text-on-surface-variant">PDF title</span>
                        <input
                          value={metadataDraft.title}
                          onChange={(event) => setMetadataDraft((current) => ({ ...current, title: event.target.value }))}
                          className="mt-1 w-full rounded-lg border border-outline-variant/50 bg-surface-container-low px-2 py-1.5 text-sm text-on-surface outline-none transition-colors focus:border-primary"
                          placeholder="Document title"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-on-surface-variant">PDF language</span>
                        <select
                          value={metadataLanguageSelectValue}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (value === CUSTOM_PDF_LANGUAGE_VALUE) {
                              setMetadataLanguageCustomMode(true);
                              setMetadataDraft((current) => ({
                                ...current,
                                language: pdfLanguageUsesCustomMode(current.language) ? current.language : "",
                              }));
                              return;
                            }
                            setMetadataLanguageCustomMode(false);
                            setMetadataDraft((current) => ({ ...current, language: value }));
                          }}
                          className="mt-1 w-full rounded-lg border border-outline-variant/50 bg-surface-container-low px-2 py-1.5 text-sm text-on-surface outline-none transition-colors focus:border-primary"
                        >
                          <option value="">Choose a language</option>
                          {PDF_LANGUAGE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                          <option value={CUSTOM_PDF_LANGUAGE_VALUE}>Custom language code</option>
                        </select>
                        {metadataLanguageCustomMode ? (
                          <input
                            value={metadataDraft.language}
                            onChange={(event) => setMetadataDraft((current) => ({ ...current, language: event.target.value }))}
                            className="mt-2 w-full rounded-lg border border-outline-variant/50 bg-surface-container-low px-2 py-1.5 text-sm text-on-surface outline-none transition-colors focus:border-primary"
                            placeholder="en-US"
                          />
                        ) : null}
                      </label>
                      <button
                        type="button"
                        className="w-full rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={savingMetadata || !metadataDirty}
                        onClick={() => void saveDocumentMetadata()}
                      >
                        {savingMetadata ? "Saving metadata" : "Save metadata"}
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="mt-4 rounded-2xl bg-surface-container-lowest p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">Validation</div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${currentValidationIssues.length ? "bg-error-container text-error" : "bg-tertiary-container text-on-tertiary-container"}`}>
                      {currentValidationIssues.length ? `${currentValidationIssues.length} issue${currentValidationIssues.length === 1 ? "" : "s"}` : "No issues"}
                    </span>
                  </div>
                  {currentValidationIssues.length ? (
                    <ul className="mt-3 space-y-2">
                      {currentValidationIssues.slice(0, 5).map((issue, index) => (
                        <li key={`${issue.code || "issue"}-${issue.zone_id || index}`} className="rounded-xl bg-error-container/50 px-3 py-2 text-xs font-semibold text-error">
                          {issue.message || "Validation issue detected."}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-on-surface-variant">
                      Current zones pass the lightweight page checks.
                    </p>
                  )}
                </div>
                <div className="mt-4 overflow-hidden rounded-2xl bg-surface-container-lowest">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-container-low"
                    onClick={() => setAISuggestionsOpen((current) => !current)}
                    aria-expanded={aiSuggestionsOpen}
                  >
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">AI suggestions</div>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        Auto-generated zones are already applied. Open this only to regenerate or inspect the suggestion payload.
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-surface-container-low px-2.5 py-1 text-[11px] font-bold text-on-surface-variant">
                        {currentAISuggestions?.status || "Not run"}
                      </span>
                      <ChevronDown size={16} className={`text-on-surface-variant transition-transform ${aiSuggestionsOpen ? "rotate-180" : ""}`} />
                    </div>
                  </button>
                  {aiSuggestionsOpen ? (
                    <div className="border-t border-outline-variant/30 px-4 pb-4 pt-3">
                      {currentAISuggestions?.error_message ? (
                        <p className="rounded-xl bg-error-container/40 px-3 py-2 text-xs font-semibold text-error">
                          {currentAISuggestions.error_message}
                        </p>
                      ) : null}
                      {aiSuggestedZones.length ? (
                        <div className="space-y-2">
                          <div className="rounded-xl bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
                            {aiSuggestedZones.length} suggested zone{aiSuggestedZones.length === 1 ? "" : "s"} ready for review.
                          </div>
                          <div className="max-h-36 space-y-2 overflow-auto pr-1">
                            {(currentAISuggestions?.zones ?? []).slice(0, 6).map((zone, index) => (
                              <div key={zone.id || `${zone.tag}-${index}`} className="rounded-xl bg-surface-container-low px-3 py-2 text-xs text-on-surface">
                                <div className="flex items-center justify-between gap-2 font-semibold">
                                  <span>{index + 1}. {zone.tag}</span>
                                  <span className="text-on-surface-variant">
                                    {zone.confidence ? `${Math.round(zone.confidence * 100)}%` : "No score"}
                                  </span>
                                </div>
                                <div className="mt-1 text-on-surface-variant">
                                  {evidenceLabel(zone.evidence_type)}
                                  {zone.evidence_ids?.length ? ` · ${zone.evidence_ids.slice(0, 2).join(", ")}` : ""}
                                </div>
                                {zone.note ? (
                                  <div className="mt-1 line-clamp-2 text-on-surface-variant">{zone.note}</div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : aiSuggestionsActive ? (
                        <div className="rounded-xl bg-primary-container/40 px-3 py-2 text-xs font-semibold text-on-surface">
                          Generating suggestions. This panel will update automatically.
                        </div>
                      ) : null}
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <button
                          type="button"
                          className="rounded-xl bg-surface-container-low px-3 py-2 font-semibold text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={generatingSuggestions || aiSuggestionsActive}
                          onClick={() => void queueCurrentPageSuggestions()}
                        >
                          {generatingSuggestions || aiSuggestionsActive ? "Generating" : "Suggest zones"}
                        </button>
                        <button
                          type="button"
                          className="rounded-xl bg-primary px-3 py-2 font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!aiSuggestedZones.length}
                          onClick={applyAISuggestionsToDraft}
                        >
                          Apply to draft
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </aside>
            </div>
          </div>
        </div>
      ) : null}
      {flowchartModalZone && flowchartModalStructure && editingPage ? (
        <FlowchartBuilderModal
          subtitle={`Page ${editingPage.page_number} selected Figure zone`}
          preview={(
            <FlowchartVisualAnnotator
              imageSrc={zoneImageSrc(sessionId, documentId, editingPage.page_number, flowchartModalZone)}
              structure={flowchartModalStructure}
              guidance={flowchartModalZone.flowchart_guidance ?? ""}
              onStructureChange={(flowchart) => updateFigureZoneText(flowchartModalZone.id, { figure_type: "flowchart", flowchart })}
              onGuidanceChange={(flowchart_guidance) => updateFigureZoneText(flowchartModalZone.id, { flowchart_guidance })}
            />
          )}
          structure={flowchartModalStructure}
          guidance={flowchartModalZone.flowchart_guidance ?? ""}
          closeLabel="Done"
          zIndexClassName="z-[60]"
          onGuidanceChange={(value) => updateFigureZoneText(flowchartModalZone.id, { flowchart_guidance: value })}
          onAddNode={() => addFlowchartNode(flowchartModalZone.id)}
          onUpdateNode={(nodeId, patch) => updateFlowchartNode(flowchartModalZone.id, nodeId, patch)}
          onRemoveNode={(nodeId) => removeFlowchartNode(flowchartModalZone.id, nodeId)}
          onAddConnection={() => addFlowchartConnection(flowchartModalZone.id)}
          onUpdateConnection={(connectionId, patch) => updateFlowchartConnection(flowchartModalZone.id, connectionId, patch)}
          onRemoveConnection={(connectionId) => removeFlowchartConnection(flowchartModalZone.id, connectionId)}
          onClose={() => setFlowchartZoneModalId(null)}
        />
      ) : null}
    </>
  );
}
