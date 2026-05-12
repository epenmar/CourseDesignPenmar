-- ============================================================
-- Canvas Curate v2 — Full Schema Migration
-- Run this in the Supabase SQL editor (paste and execute).
-- Truly idempotent: safe to re-run at any time.
-- ============================================================


create extension if not exists pgcrypto;


-- ────────────────────────────────────────────────────────────
-- ENUMS
-- PostgreSQL has no CREATE TYPE IF NOT EXISTS — use DO blocks instead.
-- ────────────────────────────────────────────────────────────

do $$ begin
  create type app_role as enum ('id', 'system_admin', 'super_admin');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type credential_type as enum ('pat', 'oauth');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type credential_status as enum ('active', 'expired', 'revoked');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type session_type as enum ('curate', 'create', 'transfer', 'document');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type session_status as enum ('active', 'archived', 'deleted');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type content_type as enum (
    'page', 'assignment', 'discussion', 'quiz', 'quiz_question',
    'file', 'module', 'module_item'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type decision_action as enum ('keep', 'delete', 'defer');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type severity as enum ('critical', 'warning', 'info');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type image_status as enum ('new', 'cached', 'failed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type doc_status as enum (
    'uploaded', 'processing', 'ready', 'tagging', 'tagged',
    'exporting', 'exported', 'archived', 'deleted'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type report_type as enum (
    'health_xlsx', 'inventory_xlsx', 'faculty_review_xlsx',
    'transfer_report_xlsx', 'health_summary_xlsx', 'edit_history_csv', 'pdf'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type report_type add value if not exists 'transfer_report_xlsx';
  alter type report_type add value if not exists 'health_summary_xlsx';
  alter type report_type add value if not exists 'edit_history_csv';
exception when undefined_object then null;
end $$;

do $$ begin
  create type job_status as enum (
    'queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type log_level as enum ('debug', 'info', 'warning', 'error', 'critical');
exception when duplicate_object then null;
end $$;


-- ────────────────────────────────────────────────────────────
-- TABLES
-- ────────────────────────────────────────────────────────────

create table if not exists user_profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null unique,
  full_name     text,
  avatar_url    text,
  role          app_role not null default 'id',
  is_active     boolean not null default true,
  auth_provider text not null default 'google',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_user_profiles_role on user_profiles (role);

-- ────────────────────────────────────────────────────────────

create table if not exists user_canvas_credentials (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references user_profiles(id) on delete cascade,
  canvas_base_url    text not null,
  credential_type    credential_type not null default 'pat',
  status             credential_status not null default 'active',

  pat_token_enc      text,

  oauth_access_enc   text,
  oauth_refresh_enc  text,
  oauth_expires_at   timestamptz,

  expires_at         timestamptz not null,
  last_validated_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint chk_pat_or_oauth check (
    (credential_type = 'pat' and pat_token_enc is not null)
    or
    (credential_type = 'oauth' and oauth_access_enc is not null)
  )
);

create unique index if not exists ux_user_canvas_credential_active
  on user_canvas_credentials (user_id, canvas_base_url)
  where status = 'active';

create index if not exists idx_canvas_credentials_expiry
  on user_canvas_credentials (expires_at);

-- ────────────────────────────────────────────────────────────

create table if not exists courses (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references user_profiles(id) on delete cascade,
  canvas_base_url  text not null,
  canvas_course_id text not null,
  course_name      text,
  workflow_state   text,
  term_name        text,
  last_synced_at   timestamptz,
  sync_version     bigint not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, canvas_base_url, canvas_course_id)
);

create index if not exists idx_courses_user_updated on courses (user_id, updated_at desc);

-- ────────────────────────────────────────────────────────────

create table if not exists sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references user_profiles(id) on delete cascade,
  type             session_type not null,
  status           session_status not null default 'active',
  name             text not null,

  source_course_id uuid references courses(id) on delete set null,
  target_course_id uuid references courses(id) on delete set null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,
  deleted_at       timestamptz,
  purge_after_at   timestamptz,
  cold_migrated_at timestamptz,
  cold_storage_key text,
  meta             jsonb not null default '{}'
);

create index if not exists idx_sessions_user_status_updated
  on sessions (user_id, status, updated_at desc);
create index if not exists idx_sessions_purge_after
  on sessions (purge_after_at)
  where purge_after_at is not null;

-- ────────────────────────────────────────────────────────────

create table if not exists course_sync_runs (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references sessions(id) on delete cascade,
  user_id        uuid not null references user_profiles(id) on delete cascade,
  course_id      uuid references courses(id) on delete set null,
  sync_kind      text not null,
  status         job_status not null default 'queued',
  started_at     timestamptz,
  finished_at    timestamptz,
  duration_ms    integer,
  fetched_count  integer not null default 0,
  changed_count  integer not null default 0,
  next_cursor    text,
  error_message  text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_course_sync_runs_session_created
  on course_sync_runs (session_id, created_at desc);

-- ────────────────────────────────────────────────────────────

create table if not exists course_content_items (
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

  body_hash           text,
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

create index if not exists idx_content_items_session_type_updated
  on course_content_items (session_id, content_type, updated_at desc);
create index if not exists idx_content_items_session_pagination
  on course_content_items (session_id, created_at desc, id desc);
create index if not exists idx_content_items_orphaned
  on course_content_items (session_id, is_orphaned)
  where is_orphaned = true;

-- ────────────────────────────────────────────────────────────

create table if not exists course_modules (
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

create index if not exists idx_course_modules_session_position
  on course_modules (session_id, position, canvas_module_id);

create table if not exists course_module_items (
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

create index if not exists idx_course_module_items_session_module_position
  on course_module_items (session_id, canvas_module_id, position, canvas_module_item_id);
create index if not exists idx_course_module_items_content_item
  on course_module_items (content_item_id);

-- ────────────────────────────────────────────────────────────

create table if not exists module_queue_operations (
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

create index if not exists idx_module_queue_operations_session_status
  on module_queue_operations (session_id, status, updated_at desc);
create index if not exists idx_module_queue_operations_module_item
  on module_queue_operations (module_item_id);

-- ────────────────────────────────────────────────────────────

create table if not exists course_content_bodies (
  content_item_id uuid primary key
    references course_content_items(id) on delete cascade,
  html_body        text,
  plain_text       text,
  extracted_at     timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────

create table if not exists content_revisions (
  id              uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references course_content_items(id) on delete cascade,
  session_id      uuid not null references sessions(id) on delete cascade,
  user_id         uuid not null references user_profiles(id) on delete cascade,
  revision_number integer not null,
  before_title    text,
  after_title     text,
  before_html     text,
  after_html      text,
  change_summary  text,
  created_at      timestamptz not null default now(),
  unique (content_item_id, revision_number)
);

create index if not exists idx_content_revisions_item_created
  on content_revisions (content_item_id, created_at desc);

-- ────────────────────────────────────────────────────────────

create table if not exists content_inventory_decisions (
  id               uuid primary key default gen_random_uuid(),
  content_item_id  uuid not null references course_content_items(id) on delete cascade,
  session_id       uuid not null references sessions(id) on delete cascade,
  user_id          uuid not null references user_profiles(id) on delete cascade,
  action           decision_action not null,
  reason           text,
  applied_to_canvas boolean not null default false,
  applied_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (content_item_id, session_id)
);

create index if not exists idx_inventory_decisions_session_action
  on content_inventory_decisions (session_id, action);

-- ────────────────────────────────────────────────────────────

create table if not exists health_runs (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions(id) on delete cascade,
  user_id       uuid not null references user_profiles(id) on delete cascade,
  status        job_status not null default 'queued',
  items_scanned integer not null default 0,
  duration_ms   integer,
  summary       jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index if not exists idx_health_runs_session_created
  on health_runs (session_id, created_at desc);

-- ────────────────────────────────────────────────────────────

create table if not exists health_findings (
  id              uuid primary key default gen_random_uuid(),
  health_run_id   uuid not null references health_runs(id) on delete cascade,
  session_id      uuid not null references sessions(id) on delete cascade,
  content_item_id uuid references course_content_items(id) on delete cascade,
  finding_type    text not null,
  finding_code    text,
  severity        severity not null,
  description     text,
  context         jsonb not null default '{}',
  is_resolved     boolean not null default false,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_health_findings_session_severity
  on health_findings (session_id, severity);
create index if not exists idx_health_findings_content
  on health_findings (content_item_id);

-- ────────────────────────────────────────────────────────────

create table if not exists course_images (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references sessions(id) on delete cascade,
  user_id          uuid not null references user_profiles(id) on delete cascade,
  content_item_id  uuid references course_content_items(id) on delete set null,

  canvas_url       text not null,
  canvas_file_id   text,
  canvas_course_id text,

  status           image_status not null default 'new',
  r2_original_key  text,
  r2_thumb_key     text,

  existing_alt_text text,
  edited_alt_text   text,
  long_description  text,
  is_decorative     boolean not null default false,
  review_action     decision_action not null default 'keep',

  width            integer,
  height           integer,
  mime_type        text,
  file_size_bytes  bigint,
  is_broken        boolean not null default false,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (session_id, canvas_url)
);

create index if not exists idx_course_images_session_created
  on course_images (session_id, created_at desc, id desc);

alter table if exists course_images
  add column if not exists review_action decision_action not null default 'keep';

-- ────────────────────────────────────────────────────────────

create table if not exists documents (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references user_profiles(id) on delete cascade,
  session_id       uuid references sessions(id) on delete set null,
  filename         text not null,
  status           doc_status not null default 'uploaded',

  r2_original_key  text not null,
  r2_working_key   text,
  r2_export_key    text,

  page_count       integer,
  tag_data         jsonb not null default '{}',
  ai_suggestions   jsonb not null default '{}',

  archived_at      timestamptz,
  deleted_at       timestamptz,
  purge_after_at   timestamptz,
  cold_migrated_at timestamptz,
  cold_storage_key text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_documents_user_status_updated
  on documents (user_id, status, updated_at desc);

-- ────────────────────────────────────────────────────────────

create table if not exists reports (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid references sessions(id) on delete set null,
  user_id        uuid not null references user_profiles(id) on delete cascade,
  report_type    report_type not null,
  r2_key         text not null,
  file_size_bytes bigint,
  generated_from jsonb not null default '{}',
  created_at     timestamptz not null default now()
);

create index if not exists idx_reports_session_created
  on reports (session_id, created_at desc);

-- ────────────────────────────────────────────────────────────

create table if not exists background_jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references user_profiles(id) on delete set null,
  session_id    uuid references sessions(id) on delete set null,
  job_type      text not null,
  status        job_status not null default 'queued',
  priority      integer not null default 100,
  attempts      integer not null default 0,
  max_attempts  integer not null default 3,
  request_id    text,
  payload       jsonb not null default '{}',
  result        jsonb not null default '{}',
  error_message text,
  queued_at     timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);

create index if not exists idx_background_jobs_status_priority
  on background_jobs (status, priority, queued_at);
create index if not exists idx_background_jobs_session
  on background_jobs (session_id, queued_at desc);

-- ────────────────────────────────────────────────────────────

create table if not exists session_archive_records (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions(id) on delete cascade,
  user_id      uuid not null references user_profiles(id) on delete cascade,
  archive_kind text not null,
  state        text not null,
  r2_archive_key text,
  metadata     jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create index if not exists idx_session_archive_records_session_created
  on session_archive_records (session_id, created_at desc);

-- ────────────────────────────────────────────────────────────

create table if not exists platform_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references user_profiles(id) on delete set null,
  session_id uuid references sessions(id) on delete set null,
  request_id text,
  job_id     uuid references background_jobs(id) on delete set null,
  event_type text not null,
  properties jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_platform_events_type_created
  on platform_events (event_type, created_at desc);
create index if not exists idx_platform_events_user_created
  on platform_events (user_id, created_at desc);
create index if not exists idx_platform_events_session_created
  on platform_events (session_id, created_at desc);

-- ────────────────────────────────────────────────────────────

create table if not exists error_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references user_profiles(id) on delete set null,
  session_id  uuid references sessions(id) on delete set null,
  request_id  text,
  job_id      uuid references background_jobs(id) on delete set null,
  source      text not null,
  level       log_level not null default 'error',
  error_class text,
  message     text not null,
  stack_trace text,
  context     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists idx_error_logs_level_created
  on error_logs (level, created_at desc);
create index if not exists idx_error_logs_session_created
  on error_logs (session_id, created_at desc);


-- ────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
--
-- Pattern:
--   All writes go through the Python backend using the service role key,
--   which bypasses RLS. Browser client (anon/user JWT) is read-only.
--   Policies below cover frontend SELECT access only, except where noted.
--
--   user_canvas_credentials is backend-only — browser reads are blocked
--   with a RESTRICTIVE policy (permissive USING (false) would be OR'd away).
-- ────────────────────────────────────────────────────────────

alter table user_profiles             enable row level security;
alter table user_canvas_credentials   enable row level security;
alter table courses                   enable row level security;
alter table sessions                  enable row level security;
alter table course_sync_runs          enable row level security;
alter table course_content_items      enable row level security;
alter table course_modules            enable row level security;
alter table course_module_items       enable row level security;
alter table module_queue_operations   enable row level security;
alter table course_content_bodies     enable row level security;
alter table content_revisions         enable row level security;
alter table content_inventory_decisions enable row level security;
alter table health_runs               enable row level security;
alter table health_findings           enable row level security;
alter table course_images             enable row level security;
alter table documents                 enable row level security;
alter table reports                   enable row level security;
alter table background_jobs           enable row level security;
alter table session_archive_records   enable row level security;
alter table platform_events           enable row level security;
alter table error_logs                enable row level security;

-- user_profiles
drop policy if exists "users_see_own_profile" on user_profiles;
create policy "users_see_own_profile"
  on user_profiles for select using (id = auth.uid());

drop policy if exists "users_update_own_profile" on user_profiles;
create policy "users_update_own_profile"
  on user_profiles for update using (id = auth.uid());

-- user_canvas_credentials: backend-only table.
-- RESTRICTIVE deny blocks all browser reads regardless of other policies.
drop policy if exists "no_browser_read_credentials" on user_canvas_credentials;
create policy "no_browser_read_credentials"
  on user_canvas_credentials as restrictive
  for select
  using (false);

-- courses
drop policy if exists "users_manage_own_courses" on courses;
create policy "users_manage_own_courses"
  on courses for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- sessions
drop policy if exists "users_manage_own_sessions" on sessions;
create policy "users_manage_own_sessions"
  on sessions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- course_sync_runs
drop policy if exists "users_manage_own_sync_runs" on course_sync_runs;
create policy "users_manage_own_sync_runs"
  on course_sync_runs for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- course_content_items
drop policy if exists "users_manage_own_content_items" on course_content_items;
create policy "users_manage_own_content_items"
  on course_content_items for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- course_modules
drop policy if exists "users_manage_own_course_modules" on course_modules;
create policy "users_manage_own_course_modules"
  on course_modules for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- course_module_items
drop policy if exists "users_manage_own_course_module_items" on course_module_items;
create policy "users_manage_own_course_module_items"
  on course_module_items for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- module_queue_operations
drop policy if exists "users_manage_own_module_queue_operations" on module_queue_operations;
create policy "users_manage_own_module_queue_operations"
  on module_queue_operations for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- course_content_bodies (no user_id — scoped via content_item join)
drop policy if exists "users_manage_own_content_bodies" on course_content_bodies;
create policy "users_manage_own_content_bodies"
  on course_content_bodies for all
  using (
    exists (
      select 1 from course_content_items i
      where i.id = course_content_bodies.content_item_id
        and i.user_id = auth.uid()
    )
  );

-- content_revisions
drop policy if exists "users_manage_own_revisions" on content_revisions;
create policy "users_manage_own_revisions"
  on content_revisions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- content_inventory_decisions
drop policy if exists "users_manage_own_decisions" on content_inventory_decisions;
create policy "users_manage_own_decisions"
  on content_inventory_decisions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- health_runs
drop policy if exists "users_manage_own_health_runs" on health_runs;
create policy "users_manage_own_health_runs"
  on health_runs for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- health_findings (no user_id — scoped via session join)
drop policy if exists "users_manage_own_health_findings" on health_findings;
create policy "users_manage_own_health_findings"
  on health_findings for all
  using (
    exists (
      select 1 from sessions s
      where s.id = health_findings.session_id
        and s.user_id = auth.uid()
    )
  );

-- course_images
drop policy if exists "users_manage_own_images" on course_images;
create policy "users_manage_own_images"
  on course_images for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- documents
drop policy if exists "users_manage_own_documents" on documents;
create policy "users_manage_own_documents"
  on documents for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- reports
drop policy if exists "users_manage_own_reports" on reports;
create policy "users_manage_own_reports"
  on reports for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- background_jobs
drop policy if exists "users_see_own_jobs" on background_jobs;
create policy "users_see_own_jobs"
  on background_jobs for select
  using (user_id = auth.uid());

-- session_archive_records
drop policy if exists "users_manage_own_archive_records" on session_archive_records;
create policy "users_manage_own_archive_records"
  on session_archive_records for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- platform_events
drop policy if exists "users_insert_own_events" on platform_events;
create policy "users_insert_own_events"
  on platform_events for insert
  with check (user_id = auth.uid());

drop policy if exists "users_see_own_events" on platform_events;
create policy "users_see_own_events"
  on platform_events for select
  using (user_id = auth.uid());

-- error_logs: backend writes only; users can read their own
drop policy if exists "users_see_own_error_logs" on error_logs;
create policy "users_see_own_error_logs"
  on error_logs for select
  using (user_id = auth.uid());


-- ────────────────────────────────────────────────────────────
-- TRIGGER: auto-create user_profile on first sign-in
-- ────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, full_name, avatar_url, auth_provider)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(new.raw_user_meta_data ->> 'provider', 'google')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
