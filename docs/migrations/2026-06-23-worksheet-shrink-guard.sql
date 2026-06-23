-- Count total attached Drive files across activities + materials.
create or replace function public._attached_files_count(d jsonb) returns int language sql immutable as $$
  select coalesce((
    select sum(jsonb_array_length(coalesce(it->'attachedFiles','[]'::jsonb)))::int
    from (
      select it from jsonb_each(coalesce(d->'courseActivities','{}'::jsonb)) e(k,v), jsonb_array_elements(v) it
      union all
      select it from jsonb_each(coalesce(d->'courseMaterials','{}'::jsonb)) e(k,v), jsonb_array_elements(v) it
    ) x), 0);
$$;

-- Guard against a stale/old client wiping out a big chunk of a course's work.
-- The existing trigger only catches a key going fully EMPTY; this catches a
-- partial SHRINK (e.g. 28 MLOs -> 14, or losing most file links). On a clobber
-- it keeps the OLD value for that key and bumps its timestamp so it wins; other
-- keys in the same save still go through. The history table makes the rare
-- false-positive (a legit big deletion) recoverable.
create or replace function public.protect_worksheet_shrink() returns trigger
language plpgsql as $$
declare old_mlo int; new_mlo int; old_f int; new_f int; bump bigint;
begin
  begin
    if new.data is null or old.data is null then return new; end if;
    bump := (extract(epoch from clock_timestamp())*1000)::bigint + 1000;

    old_mlo := public._mod_mlo_count(old.data->'moduleOverviewData');
    new_mlo := public._mod_mlo_count(new.data->'moduleOverviewData');
    if old_mlo >= 4 and new_mlo::numeric < old_mlo * 0.6 then
      new.data := jsonb_set(new.data, '{moduleOverviewData}', old.data->'moduleOverviewData', true);
      new.data := jsonb_set(new.data, '{__modifiedAt,moduleOverviewData}', to_jsonb(bump), true);
      if old.data ? 'eloMloAlignment' then
        new.data := jsonb_set(new.data, '{eloMloAlignment}', old.data->'eloMloAlignment', true);
        new.data := jsonb_set(new.data, '{__modifiedAt,eloMloAlignment}', to_jsonb(bump+1), true);
      end if;
    end if;

    old_f := public._attached_files_count(old.data);
    new_f := public._attached_files_count(new.data);
    if old_f >= 5 and new_f::numeric < old_f * 0.3 then
      new.data := jsonb_set(new.data, '{courseActivities}', old.data->'courseActivities', true);
      new.data := jsonb_set(new.data, '{courseMaterials}',  old.data->'courseMaterials',  true);
      new.data := jsonb_set(new.data, '{__modifiedAt,courseActivities}', to_jsonb(bump+2), true);
      new.data := jsonb_set(new.data, '{__modifiedAt,courseMaterials}',  to_jsonb(bump+3), true);
    end if;
  exception when others then null;
  end;
  return new;
end; $$;

drop trigger if exists trg_protect_worksheet_shrink on public.worksheets;
create trigger trg_protect_worksheet_shrink before update on public.worksheets
  for each row execute function public.protect_worksheet_shrink();
