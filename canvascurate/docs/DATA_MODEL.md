# Data Model - Canvas Curate v2

This document defines the database and storage model for the current Canvas
Curate v2 rebuild. It is paired with `docs/migration.sql`, which remains the
SQL source of truth.

- Database: Supabase Postgres
- Blob storage: Cloudflare R2
- Tenancy: single-tenant (ASU only)
- Design goal: keep hot-path structured reads in Postgres, keep binaries in R2

## Core Principles

1. Postgres is the source of truth for structured data.
2. R2 stores blobs only (PDFs, image binaries, exports, cold archives).
3. Canvas sync is incremental and asynchronous, not request-path full fetch.
4. List endpoints are pagination-first and metadata-first.
5. Soft delete first, then cold archive after 30 days.
6. Events and errors are first-class internal tables.

## Schema Overview

```text
auth.users (Supabase managed)
  -> user_profiles
  -> user_canvas_credentials
  -> sessions
       -> courses (via source_course_id / target_course_id)
       -> course_sync_runs
       -> course_content_items
            -> course_content_bodies
            -> content_revisions
            -> content_inventory_decisions
            -> health_findings
       -> course_modules
            -> course_module_items
            -> module_queue_operations
       -> health_runs
       -> course_images
       -> documents
       -> reports
       -> background_jobs
       -> session_archive_records
  -> platform_events
  -> error_logs
```

## Enums

```sql
create type app_role as enum (
  'id', 'system_admin', 'super_admin'
);

create type credential_type as enum ('pat', 'oauth');
create type credential_status as enum ('active', 'expired', 'revoked');

create type session_type as enum ('curate', 'create', 'transfer', 'document');
create type session_status as enum ('active', 'archived', 'deleted');

create type content_type as enum (
  'page', 'assignment', 'discussion', 'quiz', 'quiz_question', 'file', 'module', 'module_item'
);

create type decision_action as enum ('keep', 'delete', 'defer');
create type severity as enum ('critical', 'warning', 'info');

create type image_status as enum ('new', 'cached', 'failed');
create type doc_status as enum (
  'uploaded', 'processing', 'ready', 'tagging', 'tagged', 'exporting', 'exported', 'archived', 'deleted'
);

create type report_type as enum (
  'health_xlsx', 'inventory_xlsx', 'faculty_review_xlsx',
  'transfer_report_xlsx', 'health_summary_xlsx', 'edit_history_csv', 'pdf'
);
create type job_status as enum ('queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled');
create type log_level as enum ('debug', 'info', 'warning', 'error', 'critical');
```

## Tables

### `user_profiles`

```sql
create table user_profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text not null unique,
  full_name           text,
  avatar_url          text,
  role                app_role not null default 'id',
  is_active           boolean not null default true,
  auth_provider       text not null default 'google', -- future: cas/saml
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_user_profiles_role on user_profiles (role);
```

### `user_canvas_credentials`

PAT first, OAuth-ready schema now.

```sql
create table user_canvas_credentials (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references user_profiles(id) on delete cascade,
  canvas_base_url     text not null,                              -- https://canvas.asu.edu
  credential_type     credential_type not null default 'pat',
  status              credential_status not null default 'active',

  -- PAT path (encrypted only)
  pat_token_enc       text,

  -- OAuth path (future)
  oauth_access_enc    text,
  oauth_refresh_enc   text,
  oauth_expires_at    timestamptz,

  expires_at          timestamptz not null,                       -- weekly PAT expiry
  last_validated_at   timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint chk_pat_or_oauth
    check (
      (credential_type = 'pat' and pat_token_enc is not null)
      or
      (credential_type = 'oauth' and oauth_access_enc is not null)
    )
);

create unique index ux_user_canvas_credential_active
  on user_canvas_credentials (user_id, canvas_base_url)
  where status = 'active';

create index idx_canvas_credentials_expiry on user_canvas_credentials (expires_at);
```

### `courses`

Per-user local course registry used for fast dashboard/query paths.

```sql
create table courses (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references user_profiles(id) on delete cascade,
  canvas_base_url     text not null,
  canvas_course_id    text not null,
  course_name         text,
  workflow_state      text,
  term_name           text,
  last_synced_at      timestamptz,
  sync_version        bigint not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, canvas_base_url, canvas_course_id)
);

create index idx_courses_user_updated on courses (user_id, updated_at desc);
```

### `sessions`

```sql
create table sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references user_profiles(id) on delete cascade,
  type                session_type not null,
  status              session_status not null default 'active',
  name                text not null,

  source_course_id    uuid references courses(id) on delete set null,
  target_course_id    uuid references courses(id) on delete set null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz,
  deleted_at          timestamptz,
  purge_after_at      timestamptz,                                -- deleted_at + interval '30 days'
  cold_migrated_at    timestamptz,
  cold_storage_key    text,                                       -- R2 path after cold move
  meta                jsonb not null default '{}'
);

create index idx_sessions_user_status_updated
  on sessions (user_id, status, updated_at desc);
create index idx_sessions_purge_after on sessions (purge_after_at)
  where purge_after_at is not null;
```

### `course_sync_runs`

Auditable sync history and delta behavior.

```sql
create table course_sync_runs (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references sessions(id) on delete cascade,
  user_id             uuid not null references user_profiles(id) on delete cascade,
  course_id           uuid references courses(id) on delete set null,
  sync_kind           text not null,                              -- full | delta | targeted
  status              job_status not null default 'queued',
  started_at          timestamptz,
  finished_at         timestamptz,
  duration_ms         integer,
  fetched_count       integer not null default 0,
  changed_count       integer not null default 0,
  next_cursor         text,
  error_message       text,
  created_at          timestamptz not null default now()
);

create index idx_course_sync_runs_session_created
  on course_sync_runs (session_id, created_at desc);
```

### `course_content_items`

Metadata table for list pages (small rows).

```sql
create table course_content_items (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references sessions(id) on delete cascade,
  user_id             uuid not null references user_profiles(id) on delete cascade,
  canvas_id           text not null,
  content_type        content_type not null,
  title               text,
  canvas_url          text,
  published           boolean,
  module_canvas_id    text,
  module_name         text,
  position            integer,

  body_hash           text,                                       -- delta detection
  body_word_count     integer,
  last_canvas_edit_at timestamptz,
  last_synced_at      timestamptz not null default now(),

  marked_deleted      boolean not null default false,
  is_orphaned         boolean not null default false,
  duplicate_group_key text,

  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (session_id, canvas_id, content_type)
);

create index idx_content_items_session_type_updated
  on course_content_items (session_id, content_type, updated_at desc);
create index idx_content_items_session_pagination
  on course_content_items (session_id, created_at desc, id desc);
create index idx_content_items_orphaned
  on course_content_items (session_id, is_orphaned) where is_orphaned = true;
```

### `course_modules`

Authoritative module baseline from Canvas, used by the Phase 4 queue/builder.

```sql
create table course_modules (
  id                          uuid primary key default gen_random_uuid(),
  session_id                  uuid not null references sessions(id) on delete cascade,
  user_id                     uuid not null references user_profiles(id) on delete cascade,
  canvas_module_id            text not null,
  name                        text not null,
  position                    integer,
  published                   boolean,
  workflow_state              text,
  items_count                 integer,
  unlock_at                   timestamptz,
  require_sequential_progress boolean,
  metadata                    jsonb not null default '{}',
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (session_id, canvas_module_id)
);
```

### `course_module_items`

Canvas module-item placement rows. Unlike `course_content_items`, these preserve every module placement, indent, ordering, and completion requirement.

```sql
create table course_module_items (
  id                       uuid primary key default gen_random_uuid(),
  session_id               uuid not null references sessions(id) on delete cascade,
  user_id                  uuid not null references user_profiles(id) on delete cascade,
  module_id                uuid not null references course_modules(id) on delete cascade,
  content_item_id          uuid references course_content_items(id) on delete set null,
  canvas_module_id         text not null,
  canvas_module_item_id    text not null,
  canvas_content_id        text,
  page_url                 text,
  title                    text,
  module_item_type         text,
  content_type             content_type,
  position                 integer,
  indent                   integer not null default 0,
  published                boolean,
  completion_requirement   jsonb not null default '{}',
  html_url                 text,
  external_url             text,
  new_tab                  boolean,
  metadata                 jsonb not null default '{}',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (session_id, canvas_module_item_id)
);
```

### `module_queue_operations`

Local staged module-builder operations. These are reviewed before Canvas apply and are separate from the Canvas baseline in `course_modules` / `course_module_items`. New modules are inserted into `course_modules` with a `local:{uuid}` `canvas_module_id` and a paired `module_create` operation; applying the operation creates the Canvas module and replaces the local Canvas id.

```sql
create table module_queue_operations (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references sessions(id) on delete cascade,
  user_id               uuid not null references user_profiles(id) on delete cascade,
  operation_key         text not null,
  operation_type        text not null,
  target_type           text not null,
  module_id             uuid references course_modules(id) on delete cascade,
  module_item_id        uuid references course_module_items(id) on delete cascade,
  content_item_id       uuid references course_content_items(id) on delete set null,
  canvas_module_id      text,
  canvas_module_item_id text,
  title                 text,
  action_label          text not null,
  detail                text,
  before_state          jsonb not null default '{}',
  after_state           jsonb not null default '{}',
  status                text not null default 'staged',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (session_id, operation_key)
);
```

### `course_content_bodies`

Large HTML/text stored separately to keep list queries fast.

```sql
create table course_content_bodies (
  content_item_id     uuid primary key references course_content_items(id) on delete cascade,
  html_body           text,
  plain_text          text,
  extracted_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
```

### `content_revisions`

```sql
create table content_revisions (
  id                  uuid primary key default gen_random_uuid(),
  content_item_id     uuid not null references course_content_items(id) on delete cascade,
  session_id          uuid not null references sessions(id) on delete cascade,
  user_id             uuid not null references user_profiles(id) on delete cascade,
  revision_number     integer not null,
  before_title        text,
  after_title         text,
  before_html         text,
  after_html          text,
  change_summary      text,
  created_at          timestamptz not null default now(),
  unique (content_item_id, revision_number)
);

create index idx_content_revisions_item_created
  on content_revisions (content_item_id, created_at desc);
```

### `content_inventory_decisions`

Explicit keep/delete/defer state with auditability.

```sql
create table content_inventory_decisions (
  id                  uuid primary key default gen_random_uuid(),
  content_item_id     uuid not null references course_content_items(id) on delete cascade,
  session_id          uuid not null references sessions(id) on delete cascade,
  user_id             uuid not null references user_profiles(id) on delete cascade,
  action              decision_action not null,
  reason              text,
  applied_to_canvas   boolean not null default false,
  applied_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (content_item_id, session_id)
);

create index idx_inventory_decisions_session_action
  on content_inventory_decisions (session_id, action);
```

### `health_runs`

```sql
create table health_runs (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references sessions(id) on delete cascade,
  user_id             uuid not null references user_profiles(id) on delete cascade,
  status              job_status not null default 'queued',
  items_scanned       integer not null default 0,
  duration_ms         integer,
  summary             jsonb not null default '{}',                -- counts by severity/type
  created_at          timestamptz not null default now(),
  finished_at         timestamptz
);

create index idx_health_runs_session_created
  on health_runs (session_id, created_at desc);
```

### `health_findings`

```sql
create table health_findings (
  id                  uuid primary key default gen_random_uuid(),
  health_run_id       uuid not null references health_runs(id) on delete cascade,
  session_id          uuid not null references sessions(id) on delete cascade,
  content_item_id     uuid references course_content_items(id) on delete cascade,
  finding_type        text not null,                              -- missing_alt_text, duplicate_content, etc.
  finding_code        text,
  severity            severity not null,
  description         text,
  context             jsonb not null default '{}',
  is_resolved         boolean not null default false,
  resolved_at         timestamptz,
  created_at          timestamptz not null default now()
);

create index idx_health_findings_session_severity
  on health_findings (session_id, severity);
create index idx_health_findings_content
  on health_findings (content_item_id);
```

### `course_images`

Image metadata and references, with binaries in R2. `content_item_id` points to the content record where the image was found; for quiz-question images this is the child `quiz_question` row, while Pending Review and Canvas push are routed through the parent quiz.

```sql
create table course_images (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references sessions(id) on delete cascade,
  user_id             uuid not null references user_profiles(id) on delete cascade,
  content_item_id     uuid references course_content_items(id) on delete set null,

  canvas_url          text not null,
  canvas_file_id      text,
  canvas_course_id    text,

  status              image_status not null default 'new',
  r2_original_key     text,
  r2_thumb_key        text,

  existing_alt_text   text,
  edited_alt_text     text,
  long_description    text,
  is_decorative       boolean not null default false,
  review_action       decision_action not null default 'keep',

  width               integer,
  height              integer,
  mime_type           text,
  file_size_bytes     bigint,
  is_broken           boolean not null default false,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (session_id, canvas_url)
);

create index idx_course_images_session_created
  on course_images (session_id, created_at desc, id desc);
```

### `documents`

Standalone PDF remediation and exports.

```sql
create table documents (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references user_profiles(id) on delete cascade,
  session_id          uuid references sessions(id) on delete set null,
  filename            text not null,
  status              doc_status not null default 'uploaded',

  r2_original_key     text not null,
  r2_working_key      text,
  r2_export_key       text,

  page_count          integer,
  tag_data            jsonb not null default '{}',
  ai_suggestions      jsonb not null default '{}',

  archived_at         timestamptz,
  deleted_at          timestamptz,
  purge_after_at      timestamptz,
  cold_migrated_at    timestamptz,
  cold_storage_key    text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_documents_user_status_updated
  on documents (user_id, status, updated_at desc);
```

### `reports`

```sql
create table reports (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid references sessions(id) on delete set null,
  user_id             uuid not null references user_profiles(id) on delete cascade,
  report_type         report_type not null,
  r2_key              text not null,
  file_size_bytes     bigint,
  generated_from      jsonb not null default '{}',
  created_at          timestamptz not null default now()
);

create index idx_reports_session_created
  on reports (session_id, created_at desc);
```

Current report downloads are generated directly from Supabase data for Content
Inventory, Faculty Review, Latest Transfer Report, Health Summary, Edit
History, and printable course content. The `reports` table remains the durable
artifact ledger for R2-backed generated reports as that persistence path is
expanded.

### `background_jobs`

Durable async execution ledger.

```sql
create table background_jobs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references user_profiles(id) on delete set null,
  session_id          uuid references sessions(id) on delete set null,
  job_type            text not null,                              -- sync_course, generate_alt_text, tag_pdf, etc.
  status              job_status not null default 'queued',
  priority            integer not null default 100,
  attempts            integer not null default 0,
  max_attempts        integer not null default 3,
  request_id          text,                                       -- correlation id
  payload             jsonb not null default '{}',
  result              jsonb not null default '{}',
  error_message       text,
  queued_at           timestamptz not null default now(),
  started_at          timestamptz,
  finished_at         timestamptz
);

create index idx_background_jobs_status_priority
  on background_jobs (status, priority, queued_at);
create index idx_background_jobs_session
  on background_jobs (session_id, queued_at desc);
```

### `session_archive_records`

Tracks lifecycle from soft-delete to cold storage.

```sql
create table session_archive_records (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references sessions(id) on delete cascade,
  user_id             uuid not null references user_profiles(id) on delete cascade,
  archive_kind        text not null,                              -- session | create_output | document
  state               text not null,                              -- soft_deleted | cold_migrated | restored
  r2_archive_key      text,
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now()
);

create index idx_session_archive_records_session_created
  on session_archive_records (session_id, created_at desc);
```

### `platform_events`

Append-only internal analytics.

```sql
create table platform_events (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references user_profiles(id) on delete set null,
  session_id          uuid references sessions(id) on delete set null,
  request_id          text,
  job_id              uuid references background_jobs(id) on delete set null,
  event_type          text not null,
  properties          jsonb not null default '{}',
  created_at          timestamptz not null default now()
);

create index idx_platform_events_type_created
  on platform_events (event_type, created_at desc);
create index idx_platform_events_user_created
  on platform_events (user_id, created_at desc);
create index idx_platform_events_session_created
  on platform_events (session_id, created_at desc);
```

### `error_logs`

Structured logging for backend/frontend/worker errors.

```sql
create table error_logs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references user_profiles(id) on delete set null,
  session_id          uuid references sessions(id) on delete set null,
  request_id          text,
  job_id              uuid references background_jobs(id) on delete set null,
  source              text not null,                              -- frontend | backend | worker
  level               log_level not null default 'error',
  error_class         text,
  message             text not null,
  stack_trace         text,
  context             jsonb not null default '{}',
  created_at          timestamptz not null default now()
);

create index idx_error_logs_level_created
  on error_logs (level, created_at desc);
create index idx_error_logs_session_created
  on error_logs (session_id, created_at desc);
```

## Row Level Security

Use RLS on user-scoped tables. Example:

```sql
alter table sessions enable row level security;

create policy "users_see_own_sessions"
  on sessions for select
  using (user_id = auth.uid());

create policy "users_manage_own_sessions"
  on sessions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

Apply equivalent policies to user-owned tables (`courses`, `course_content_items`, `documents`, etc.).

## R2 Layout (Target)

```text
r2-bucket/
  images/
    canvas-cache/{session_id}/
      {image_id}/original.{ext}
      {image_id}/thumb.webp
    editor-uploads/{session_id}/
      {image_id}/original.{ext}
      {image_id}/thumb.webp
  documents/
    {user_id}/{document_id}/
      original.pdf
      working.pdf
      exported.pdf
  reports/
    {session_id}/
      {report_id}.xlsx
      {report_id}.pdf
  archive/
    sessions/{session_id}/snapshot.json
    documents/{document_id}/original.pdf
```

## Operational Notes

1. Keep list endpoints metadata-only by default (join `course_content_items`, not body table).
2. Load full HTML bodies only on-demand in editor/detail endpoints.
3. Use cursor pagination (`created_at`, `id`) consistently.
4. Store correlation ids in `platform_events`, `error_logs`, and `background_jobs`.
5. Maintain PAT expiry and rotation policy at app layer, with DB status reflecting revocation/expiry.
6. Keep long-running Canvas, AI, PDF, Transfer, Reports, and Course Creation
   work in `background_jobs`; web requests should queue work and workers should
   update progress/result payloads.

## Free Tier Fit (Initial Estimate)

This model is designed to stay within Supabase free tier for early rollout by:

- moving binary and archive payloads to R2,
- separating heavy text bodies from list metadata,
- keeping analytics/events append-only and compressible/archivable.

If event volume grows quickly, add scheduled archival (for example, roll older event rows to R2 exports).
