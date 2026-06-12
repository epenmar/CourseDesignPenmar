-- Extend worksheet protection to nested wipes: moduleOverviewData stays a
-- non-empty object (one key per module) even when every module's `mlos` array
-- is emptied, so the whole-value emptiness check missed it. Same for
-- courseActivities/courseMaterials (module-keyed arrays). Add content-count
-- helpers and protect those keys by total inner content, not outer emptiness.

create or replace function public._mod_mlo_count(d jsonb) returns int
language sql immutable as $$
  select coalesce(sum(
    case when jsonb_typeof(v->'mlos')='array' then jsonb_array_length(v->'mlos') else 0 end
  ),0)::int
  from jsonb_each(case when jsonb_typeof(d)='object' then d else '{}'::jsonb end) as t(key, v)
  where jsonb_typeof(v)='object';
$$;

create or replace function public._nested_item_count(d jsonb) returns int
language sql immutable as $$
  select coalesce(sum(
    case when jsonb_typeof(v)='array' then jsonb_array_length(v) else 0 end
  ),0)::int
  from jsonb_each(case when jsonb_typeof(d)='object' then d else '{}'::jsonb end) as t(key, v);
$$;

create or replace function public.protect_worksheet_destructive_keys()
returns trigger
language plpgsql
as $$
declare
  k text;
  -- whole-value keys: protected when OLD non-empty and NEW empty ([] / {} / null)
  whole_keys text[] := array['clos','flatElos','elos','cloEloAlignment','eloMloAlignment'];
  old_v jsonb;
  new_v jsonb;
  bump bigint;
  procedure_keep boolean;
begin
  if new.data is null or old.data is null then
    return new;
  end if;
  if not (new.data ? '__modifiedAt') then
    new.data := jsonb_set(new.data, '{__modifiedAt}', '{}'::jsonb, true);
  end if;

  foreach k in array whole_keys loop
    old_v := old.data -> k;
    new_v := new.data -> k;
    procedure_keep := (old_v is not null and old_v not in ('null'::jsonb,'[]'::jsonb,'{}'::jsonb))
                      and (new_v is null or new_v in ('null'::jsonb,'[]'::jsonb,'{}'::jsonb));
    if procedure_keep then
      new.data := jsonb_set(new.data, array[k], old_v, true);
      bump := greatest(coalesce((new.data->'__modifiedAt'->>k)::bigint,0),
                       (extract(epoch from clock_timestamp())*1000)::bigint) + 1000;
      new.data := jsonb_set(new.data, array['__modifiedAt', k], to_jsonb(bump), true);
    end if;
  end loop;

  -- moduleOverviewData: keep OLD when it had MLOs and NEW would have none.
  if public._mod_mlo_count(old.data->'moduleOverviewData') > 0
     and public._mod_mlo_count(new.data->'moduleOverviewData') = 0 then
    new.data := jsonb_set(new.data, '{moduleOverviewData}', old.data->'moduleOverviewData', true);
    bump := greatest(coalesce((new.data->'__modifiedAt'->>'moduleOverviewData')::bigint,0),
                     (extract(epoch from clock_timestamp())*1000)::bigint) + 1000;
    new.data := jsonb_set(new.data, array['__modifiedAt','moduleOverviewData'], to_jsonb(bump), true);
  end if;

  -- courseActivities / courseMaterials: keep OLD when it had items and NEW would have none.
  foreach k in array array['courseActivities','courseMaterials'] loop
    if public._nested_item_count(old.data->k) > 0
       and public._nested_item_count(new.data->k) = 0 then
      new.data := jsonb_set(new.data, array[k], old.data->k, true);
      bump := greatest(coalesce((new.data->'__modifiedAt'->>k)::bigint,0),
                       (extract(epoch from clock_timestamp())*1000)::bigint) + 1000;
      new.data := jsonb_set(new.data, array['__modifiedAt', k], to_jsonb(bump), true);
    end if;
  end loop;

  return new;
end;
$$;
