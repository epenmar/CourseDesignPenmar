/**
 * Shared frontend types for the Documents inventory and remediation workflow.
 */

export type StatusFilter =
  | "all"
  | "linked"
  | "unlinked"
  | "filename_links"
  | "replacement_deployed"
  | "ready_to_archive"
  | "still_placed"
  | "cleanup_marked"
  | "archived";

export type FileTypeFilter = "all" | "pdf" | "word" | "powerpoint" | "spreadsheet" | "image" | "other";
export type SortOption = "priority" | "name_asc" | "name_desc";

export type LinkedFrom = {
  content_item_id: string;
  content_title: string | null;
  content_type: string;
  content_canvas_url: string | null;
  module_name: string | null;
  link_index: number;
  href: string;
  text: string | null;
  issue_code: string | null;
  is_filename_label: boolean;
};

export type SourceContentItem = {
  id: string;
  title: string | null;
  content_type: string;
  canvas_url: string | null;
  module_name: string | null;
};

export type AccessibilityReview = {
  status?: string;
  page_count?: number | null;
  issues?: { code: string; message: string }[];
};

export type PdfReviewType = {
  level: "simple" | "moderate" | "complex";
  label: string;
  detail?: string | null;
};

export type ReviewingDocument = {
  previousReviewedAt: string | null;
  startedAt: number;
};

export type DocumentRemediation = {
  extracted_at?: string | null;
  export_readiness?: {
    status?: string | null;
    error_count?: number;
    warning_count?: number;
    issue_count?: number;
  };
  tagflow_state?: {
    status?: string | null;
    preview_generation?: {
      status?: string | null;
      stale_page_numbers?: number[];
    };
    ai_suggestion_generation?: {
      status?: string | null;
    };
    pages?: {
      page_number?: number;
      preview_asset_status?: string | null;
      original_asset?: {
        status?: string | null;
      };
      ai_suggestions?: {
        status?: string | null;
      };
      ai_draft_applied?: {
        status?: string | null;
      };
      zones?: unknown[];
      zone_count?: number;
    }[];
  };
};

export type ReplacementCandidate = {
  status?: string;
  export_artifact_id?: string | null;
  canvas_deployment?: {
    status?: string;
    canvas_file_id?: string | null;
    canvas_url?: string | null;
  };
};

export type InventoryDecision = {
  id: string;
  content_item_id: string;
  action: "keep" | "delete" | "defer";
  reason: string | null;
  applied_to_canvas: boolean | null;
  applied_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type CanvasArchive = {
  status: string;
  archived_at?: string | null;
  folder_id?: string | number | null;
  folder_name?: string | null;
  folder_path?: string | null;
};

export type DocumentJobSummary = {
  id: string;
  job_type: string;
  status: string | null;
  payload?: Record<string, unknown> | null;
  error_message?: string | null;
  queued_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

export type DocumentRow = {
  id: string;
  canvas_id: string | null;
  title: string | null;
  filename: string | null;
  extension: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  folder_name: string | null;
  folder_path: string | null;
  canvas_url: string | null;
  published: boolean | null;
  module_canvas_id?: string | null;
  module_name: string | null;
  is_orphaned: boolean;
  uploaded_via?: string | null;
  accessibility_status?: "needs_review" | "passed_initial_check" | "not_checked" | "unsupported_file_type";
  accessibility_issue_count?: number;
  accessibility_review?: AccessibilityReview | null;
  pdf_review_type?: PdfReviewType | null;
  pdf_reviewed_at?: string | null;
  document_remediation?: DocumentRemediation | null;
  source_content_item?: SourceContentItem | null;
  linked_from: LinkedFrom[];
  linked_count: number;
  filename_link_count: number;
  generic_link_count: number;
  is_image_file?: boolean;
  non_embedded_image_file?: boolean;
  is_replacement_file?: boolean;
  replacement_candidate?: ReplacementCandidate | null;
  replacement_status?: string | null;
  replacement_canvas_file_id?: string | null;
  inventory_decision?: InventoryDecision | null;
  decision_action?: InventoryDecision["action"] | null;
  decision_reason?: string | null;
  canvas_archive?: CanvasArchive | null;
  document_jobs?: DocumentJobSummary[];
};

export type DocumentsResponse = {
  items: DocumentRow[];
  total_count: number;
  next_offset: number | null;
  counts: {
    all: number;
    linked: number;
    unlinked: number;
    filename_links: number;
    replacement_deployed: number;
    ready_to_archive: number;
    still_placed: number;
    cleanup_marked: number;
    archived: number;
  };
  file_type_counts?: Record<FileTypeFilter, number>;
};
