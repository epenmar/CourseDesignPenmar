-- Extend worksheet protection to formData (Course Info, policies, etc.). A
-- load-race wipe empties many previously-populated fields in one update; a
-- normal edit clears at most one or two. So: if an update would blank >= 3
-- fields that were non-empty, treat it as a wipe and keep those old values.
-- Single-field clears pass through untouched.
create or replace function public.protect_worksheet_destructive_keys()
returns trigger
language plpgsql
as $$
declare
  k text;
  whole_keys text[] := array['clos','flatElos','elos','cloEloAlignment','eloMloAlignment'];
  old_v jsonb;
  new_v jsonb;
  bump bigint;
  fd_old jsonb;
  fd_new jsonb;
  emptied_keys text[];
  fk text;
begin
  if new.data is null or old.data is null then
    return new;
  end if;
  if not (new.data ? '__modifiedAt') then
    new.data := jsonb_set(new.data, '{__modifiedAt}', '{}'::jsonb, true);
  end if;

  -- whole-value keys
  foreach k in array whole_keys loop
    old_v := old.data -> k;
    new_v := new.data -> k;
    if (old_v is not null and old_v not in ('null'::jsonb,'[]'::jsonb,'{}'::jsonb))
       and (new_v is null or new_v in ('null'::jsonb,'[]'::jsonb,'{}'::jsonb)) then
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

  -- formData: bulk-wipe protection (>= 3 non-empty fields cleared at once).
  fd_old := old.data->'formData';
  fd_new := new.data->'formData';
  if jsonb_typeof(fd_old)='object' and jsonb_typeof(fd_new)='object' then
    select array_agg(o.key) into emptied_keys
    from jsonb_each_text(fd_old) as o(key, val)
    where o.val is not null and btrim(o.val) <> ''
      and coalesce(btrim(fd_new->>o.key), '') = '';
    if emptied_keys is not null and array_length(emptied_keys,1) >= 3 then
      foreach fk in array emptied_keys loop
        fd_new := jsonb_set(fd_new, array[fk], fd_old->fk, true);
      end loop;
      new.data := jsonb_set(new.data, '{formData}', fd_new, true);
      bump := greatest(coalesce((new.data->'__modifiedAt'->>'formData')::bigint,0),
                       (extract(epoch from clock_timestamp())*1000)::bigint) + 1000;
      new.data := jsonb_set(new.data, array['__modifiedAt','formData'], to_jsonb(bump), true);
    end if;
  end if;

  return new;
end;
$$;
