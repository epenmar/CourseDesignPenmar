/**
 * Shared frontend types for the Reports & Downloads workspace.
 */

export type ReportDownloadKind =
  | "content_inventory"
  | "faculty_review"
  | "transfer_report"
  | "health_summary"
  | "edit_history";

export type ReportDownloadOption = {
  kind: ReportDownloadKind;
  title: string;
  description: string;
  format: "csv" | "json" | string;
  enabled: boolean;
};

export type ReportsOverview = {
  session: {
    id: string;
    name?: string | null;
    type?: string | null;
    status?: string | null;
    source_course_id?: string | null;
    updated_at?: string | null;
  };
  summary: {
    content_items: number;
    images: number;
    issues_found: number;
    files: number;
    content_counts: Record<string, number>;
  };
  latest_health_run?: {
    id: string;
    status: string;
    items_scanned?: number;
    duration_ms?: number | null;
    summary?: Record<string, unknown>;
    created_at?: string;
    finished_at?: string | null;
  } | null;
  latest_transfer_jobs: Array<{
    id: string;
    job_type: string;
    status: string;
    result?: {
      summary?: Record<string, unknown>;
      report?: Record<string, unknown[]>;
    } | null;
    error_message?: string | null;
    queued_at?: string;
    finished_at?: string | null;
  }>;
  latest_backup_job?: ReportsBackupJob | null;
  recent_events: Array<{
    id: string;
    event_type: string;
    properties?: Record<string, unknown>;
    created_at: string;
  }>;
  course_creation?: {
    status?: string | null;
    title?: string | null;
    module_count?: number;
    draft_status?: string | null;
    exported_to_canvas_clean?: boolean;
  } | null;
  report_history: Array<{
    id: string;
    report_type: string;
    r2_key: string;
    file_size_bytes?: number | null;
    created_at: string;
  }>;
  downloads: ReportDownloadOption[];
};

export type ReportsBackupJob = {
  id: string;
  session_id?: string;
  job_type: "reports_course_backup" | string;
  status: "queued" | "running" | "retrying" | "succeeded" | "failed" | string;
  attempts?: number | null;
  payload?: Record<string, unknown> | null;
  result?: {
    status?: string;
    progress?: number;
    source_course?: Record<string, unknown>;
    summary?: {
      export_id?: string;
      workflow_state?: string;
      backup_download_url?: string;
      backup_filename?: string;
      source_canvas_course_id?: string;
    };
    events?: Array<{
      message: string;
      status?: string;
      at?: string;
    }>;
    error?: string;
  } | null;
  error_message?: string | null;
  queued_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
};

export type FacultyReviewUploadResult = {
  image_updates: number;
  decision_updates: number;
  decision_created: number;
  decision_updated: number;
  synced_image_reviews: number;
  synced_file_decisions: number;
  skipped_count: number;
  skipped: Array<{
    sheet?: string | null;
    row?: number | null;
    reason: string;
  }>;
};

export type PrintableContentType = "page" | "assignment" | "discussion" | "quiz";

export type PrintableCourseItem = {
  id: string;
  placement_id?: string | null;
  title: string;
  content_type: PrintableContentType | string;
  module_name?: string | null;
  module_position?: number | null;
  module_item_position?: number | null;
  canvas_url?: string | null;
  published?: boolean | null;
  updated_at?: string | null;
  html_body: string;
  media_replacements?: Array<{
    image_id: string;
    source_url?: string | null;
    canvas_file_id?: string | null;
    print_src?: string | null;
  }>;
};

export type PrintableCourseContent = {
  session: {
    id: string;
    name?: string | null;
    type?: string | null;
  };
  course: {
    name: string;
    url?: string | null;
  };
  generated_at: string;
  modules: Array<{
    name: string;
    position?: number | null;
    item_count: number;
  }>;
  items: PrintableCourseItem[];
};
