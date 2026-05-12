/**
 * Types for the session-level Pending Review workflow.
 *
 * These shapes mirror the existing Canvas review endpoints while the backend
 * routes are still being extracted from the legacy Canvas router.
 */

export type PendingContentChange = {
  content_item_id: string;
  title: string | null;
  content_type: string | null;
  module_name: string | null;
  review_status: string;
  latest_revision_number: number | null;
  latest_changed_at: string | null;
  affected_fields: string[];
  change_summary: string | null;
  diff_summary: string;
  word_delta: number;
  has_changes: boolean;
};

export type PendingDiffResponse = PendingContentChange & {
  unified_diff: string;
};

export type PendingModuleChange = {
  id: string;
  operation_type: string;
  title: string | null;
  action_label: string;
  detail: string | null;
  review_status: string;
  content_item_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
};

export type PendingChangesResponse = {
  content_changes: PendingContentChange[];
  module_changes: PendingModuleChange[];
  counts: {
    content: number;
    modules: number;
    total: number;
  };
};

export type BatchPushState = {
  status: "queued" | "pushing" | "pushed" | "failed";
  message?: string;
};

export type PushHistoryItem = {
  id: string;
  content_item_id: string;
  batch_id: string | null;
  title: string | null;
  content_type: string | null;
  canvas_id: string | null;
  revision_count: number;
  first_revision_number: number | null;
  latest_revision_number: number | null;
  latest_change_summary: string | null;
  change_summaries: string[];
  created_at: string;
};

export type ModuleApplyHistoryOperation = {
  id: string;
  operation_type: string;
  title: string | null;
};

export type ModuleApplyHistoryItem = {
  id: string;
  operation_ids: string[];
  applied_count: number;
  failed_count: number;
  operations: ModuleApplyHistoryOperation[];
  created_at: string;
};
