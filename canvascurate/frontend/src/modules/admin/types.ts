export type AdminProfile = {
  id: string;
  email: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  role: "id" | "system_admin" | "super_admin" | string;
  is_active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type QueueDiagnosticsSummary = {
  limit: number;
  sampled_jobs: number;
  active_total: number;
  by_status: Record<string, number>;
  health?: {
    warning_level: "none" | "info" | "warning" | "critical" | string;
    message: string;
    warning_group_count: number;
    info_group_count: number;
    worst_group?: string | null;
  };
};

export type QueueDiagnosticsJobType = {
  job_type: string;
  group?: string | null;
  total: number;
  latest_queued_at?: string | null;
  queued: number;
  retrying: number;
  running: number;
  succeeded: number;
  failed: number;
};

export type QueueDiagnosticsJobGroup = {
  group: string;
  total: number;
  active_total: number;
  oldest_active_queued_at?: string | null;
  oldest_active_age_seconds?: number | null;
  latest_queued_at?: string | null;
  warning_level: "none" | "info" | "warning" | "critical" | string;
  warning_message?: string | null;
  queued: number;
  retrying: number;
  running: number;
  succeeded: number;
  failed: number;
};

export type QueueDiagnosticsJob = {
  id: string;
  job_type: string;
  group?: string | null;
  status: string;
  attempts?: number | null;
  max_attempts?: number | null;
  user_id?: string | null;
  user_email?: string | null;
  user_role?: string | null;
  session_id?: string | null;
  session_name?: string | null;
  session_type?: string | null;
  session_status?: string | null;
  payload?: Record<string, unknown>;
  error_message?: string | null;
  queued_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

export type QueueDiagnosticsResponse = {
  summary: QueueDiagnosticsSummary;
  job_groups: QueueDiagnosticsJobGroup[];
  job_types: QueueDiagnosticsJobType[];
  recent_jobs: QueueDiagnosticsJob[];
};
