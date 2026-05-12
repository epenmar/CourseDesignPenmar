/**
 * Shared frontend types for Phase 6 Transfer readiness and push workflows.
 */

export type TransferMode = "same_course" | "target_course" | "copy_course";

export type TransferModeOption = {
  mode: TransferMode;
  title: string;
  description: string;
  enabled: boolean;
  disabled_reason?: string | null;
  recommended?: boolean;
};

export type TransferReadinessSession = {
  id: string;
  name?: string | null;
  type?: string | null;
  source_course_id?: string | null;
  is_course_creation_export?: boolean;
  updated_at?: string | null;
};

export type TransferSourceCourse = {
  id?: string | null;
  name?: string | null;
  canvas_course_id?: string | number | null;
  canvas_base_url?: string | null;
};

export type TransferPendingItem = {
  id: string;
  title: string;
  content_type: string;
  module_name?: string | null;
  canvas_url?: string | null;
  updated_at?: string | null;
  revision_count?: number;
  latest_change_summary?: string | null;
  badges: string[];
};

export type TransferModuleOperation = {
  id: string;
  title?: string | null;
  operation_type?: string | null;
  detail?: string | null;
  created_at?: string | null;
};

export type TransferDeletionItem = {
  id: string;
  title: string;
  content_type: string;
  reason?: string | null;
  action: "delete" | "review" | string;
};

export type TransferIssue = {
  id: string;
  title: string;
  content_type: string;
  reason: string;
  severity?: "info" | "warning" | "error" | string;
  impact?: string | null;
};

export type TransferReadiness = {
  session: TransferReadinessSession;
  source_course: TransferSourceCourse | null;
  recommended_mode: TransferMode;
  modes: TransferModeOption[];
  summary: {
    content_counts: Record<"page" | "assignment" | "discussion" | "quiz" | "file", number>;
    module_count: number;
    module_item_count: number;
    staged_module_operation_count: number;
    transferable_content_count: number;
    referenced_file_count?: number;
    transfer_payload_count?: number;
    same_course_push_count?: number;
    same_course_module_create_count?: number;
    same_course_module_operation_count?: number;
    same_course_module_item_operation_count?: number;
    same_course_create_count?: number;
    same_course_delete_count?: number;
    same_course_action_count?: number;
    pending_content_count: number;
    generated_content_count: number;
    modified_content_count: number;
    new_local_content_count: number;
    deletion_candidate_count: number;
    transfer_issue_count?: number;
    ready_item_count: number;
  };
  pending_items: TransferPendingItem[];
  module_operations: TransferModuleOperation[];
  deletion_items: TransferDeletionItem[];
  transfer_issues?: TransferIssue[];
};

export type TransferTargetCourse = {
  canvas_base_url: string;
  credential_base_url?: string | null;
  canvas_course_id: string;
  name: string;
  course_code?: string | null;
  workflow_state?: string | null;
  term_name?: string | null;
};

export type TransferTargetValidationResponse = {
  target_course: TransferTargetCourse;
};

export type TransferJobEvent = {
  message: string;
  status?: "info" | "done" | "warning" | "error" | string;
  at?: string | null;
};

export type TransferJobReportCategory =
  | "created"
  | "updated"
  | "deleted"
  | "placed"
  | "migrated_files"
  | "protected"
  | "skipped"
  | "warnings"
  | "errors";

export type TransferJobReportItem = {
  title: string;
  content_type?: string | null;
  action?: string | null;
  status?: string | null;
  reason?: string | null;
  canvas_url?: string | null;
};

export type TransferJobReport = Partial<Record<TransferJobReportCategory, TransferJobReportItem[]>>;

export type TransferJob = {
  id: string;
  session_id?: string;
  job_type: string;
  status: "queued" | "running" | "retrying" | "succeeded" | "failed" | "cancelled" | string;
  attempts?: number;
  payload?: Record<string, unknown>;
  result?: {
    status?: string;
    progress?: number;
    events?: TransferJobEvent[];
    report?: TransferJobReport;
    target_course?: TransferTargetCourse;
    summary?: {
      mode?: string;
      modules_created?: number;
      module_operations_applied?: number;
      module_item_operations_applied?: number;
      pages_created?: number;
      assignments_created?: number;
      discussions_created?: number;
      quizzes_created?: number;
      quiz_questions_created?: number;
      placements_created?: number;
      page_placements_created?: number;
      items_remapped?: number;
      pages_remapped?: number;
      linked_items_created?: number;
      files_migrated?: number;
      target_items_erased?: number;
      target_modules_erased?: number;
      target_pages_erased?: number;
      target_assignments_erased?: number;
      target_discussions_erased?: number;
      target_quizzes_erased?: number;
      target_files_erased?: number;
      migration_id?: string;
      source_canvas_course_id?: string;
      backup_download_url?: string;
      backup_filename?: string;
      target_canvas_course_id?: string;
      export_id?: string;
      workflow_state?: string;
      file_warnings?: number;
      items_updated?: number;
      pages_updated?: number;
      assignments_updated?: number;
      discussions_updated?: number;
      quizzes_updated?: number;
      quiz_questions_updated?: number;
      items_created?: number;
      items_deleted?: number;
      pages_deleted?: number;
      assignments_deleted?: number;
      discussions_deleted?: number;
      quizzes_deleted?: number;
      quiz_questions_deleted?: number;
      files_deleted?: number;
      protected_skipped?: number;
      items_skipped?: number;
      warnings?: number;
      unsupported_skipped?: Record<string, number>;
      errors?: number;
    };
    error?: string;
  };
  error_message?: string | null;
  queued_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

export type TransferJobResponse = {
  job: TransferJob;
};
