-- meetings — cached Granola meeting notes, keyed by Granola's stable ID.
-- The dashboard reads from here so a transient Granola/MCP outage doesn't
-- blank out meeting history. Sync writers upsert; readers cache locally.

create table if not exists public.meetings (
  granola_id    text primary key,
  course_id     text not null,
  meeting_date  date,
  title         text,
  people        jsonb default '[]'::jsonb,
  summary       text,
  decisions     jsonb default '[]'::jsonb,
  action_items  jsonb default '[]'::jsonb,
  follow_up     jsonb,
  granola_url   text,
  transcript_url text,
  source        text default 'granola',
  raw           jsonb,
  synced_at     timestamptz default now(),
  created_at    timestamptz default now()
);

create index if not exists meetings_course_id_idx on public.meetings (course_id);
create index if not exists meetings_meeting_date_idx on public.meetings (meeting_date desc);

-- RLS: read open (publishable key needs it); writes locked to service_role.
alter table public.meetings enable row level security;

drop policy if exists "meetings_select_anon" on public.meetings;
create policy "meetings_select_anon" on public.meetings
  for select using (true);

-- No insert/update/delete policies for anon → service_role can still write.
