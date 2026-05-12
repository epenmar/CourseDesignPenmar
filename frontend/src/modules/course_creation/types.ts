export type CourseCreationSetup = {
  course_title: string;
  course_code: string;
  course_description: string;
  audience: string;
  level: string;
  term_length: string;
  module_count: number | null;
  module_cadence: string;
  source_notes: string;
};

export type CourseCreationChunkPreview = {
  id: string;
  type: string;
  title: string;
  text_preview: string;
  char_count: number;
  source_locator?: Record<string, string | number | null>;
};

export type CourseCreationExtractionSummary = {
  status: string;
  message?: string;
  chunk_count?: number;
  text_char_count?: number;
  page_count?: number | null;
  preview_chunks?: CourseCreationChunkPreview[];
  artifact_key?: string;
  extracted_at?: string;
};

export type CourseCreationJob = {
  id: string;
  job_type: string;
  status: "queued" | "running" | "succeeded" | "failed" | string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error_message?: string | null;
  queued_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
};

export type CourseCreationSource = {
  id: string;
  filename: string;
  content_type?: string | null;
  size_bytes?: number | null;
  status: string;
  extraction_status: "not_started" | "queued" | "running" | "succeeded" | "failed" | "needs_extractor" | string;
  extraction_summary?: CourseCreationExtractionSummary | null;
  extraction_job_id?: string | null;
  latest_job?: CourseCreationJob | null;
  created_at?: string;
  updated_at?: string;
};

export type CourseCreationSourceAnalysisItem = {
  id: string;
  source_id?: string;
  source_title?: string;
  summary: string;
  topics?: string[];
  learning_objectives?: string[];
  recommended_use?: string;
  content_types?: string[];
  confidence?: number | null;
  source_locator?: Record<string, string | number | null>;
};

export type CourseCreationOutlineItem = {
  type: string;
  title: string;
  purpose?: string;
  source_chunk_ids?: string[];
};

export type CourseCreationOutlineModule = {
  id: string;
  title: string;
  overview?: string;
  objectives?: string[];
  topics?: string[];
  estimated_workload?: string;
  source_chunk_ids?: string[];
  items?: CourseCreationOutlineItem[];
};

export type CourseCreationOutline = {
  title: string;
  description?: string;
  status?: string;
  modules: CourseCreationOutlineModule[];
  gaps?: string[];
  assumptions?: string[];
  generated_at?: string;
  job_id?: string;
  review_revision_id?: string;
};

export type CourseCreationSourceAnalysis = {
  generated_at?: string;
  job_id?: string;
  source_chunk_count?: number;
  items?: CourseCreationSourceAnalysisItem[];
};

export type CourseCreationOutlineGeneration = {
  status: "queued" | "running" | "succeeded" | "failed" | string;
  job_id?: string;
  source_chunk_count?: number;
  source_analysis_count?: number;
  module_count?: number;
  error?: string;
  warning?: string;
  raw_response_length?: number;
  raw_response_excerpt?: string;
  debug_artifact_key?: string;
  started_at?: string;
  finished_at?: string;
};

export type CourseCreationDraftGeneration = {
  status?: "queued" | "running" | "succeeded" | "failed" | string;
  job_id?: string;
  run_id?: string;
  module_count?: number;
  content_item_count?: number;
  created_module_count?: number;
  created_content_item_count?: number;
  skipped_existing_module_count?: number;
  skipped_existing_content_item_count?: number;
  error?: string;
  started_at?: string;
  finished_at?: string;
  use_ai_body_generation?: boolean;
  ai_body_generation?: {
    enabled?: boolean;
    succeeded?: number;
    fallback?: number;
    not_configured?: number;
    not_requested?: number;
  };
  module_ids?: string[];
  content_item_ids?: string[];
  created_at?: string;
};

export type CourseCreationProject = {
  session_id: string;
  name: string;
  status: string;
  setup: CourseCreationSetup;
  sources: CourseCreationSource[];
  source_analysis?: CourseCreationSourceAnalysis | null;
  outline?: CourseCreationOutline | null;
  outline_generation?: CourseCreationOutlineGeneration | null;
  draft_generation?: CourseCreationDraftGeneration | null;
  created_at?: string;
  updated_at?: string;
};

export type CourseCreationDraftPreviewItem = {
  id: string;
  title?: string | null;
  content_type?: string | null;
  position?: number | null;
  html_body?: string;
  plain_text?: string;
};

export type CourseCreationDraftPreviewModule = {
  id: string;
  title?: string | null;
  position?: number | null;
  items: CourseCreationDraftPreviewItem[];
};

export type CourseCreationDraftPreview = {
  module_count: number;
  content_item_count: number;
  modules: CourseCreationDraftPreviewModule[];
};
