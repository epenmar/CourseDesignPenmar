-- Honor an explicit, short-lived intentional-shrink token so a DELIBERATE MLO
-- deletion is allowed through the worksheet protection triggers.
--
-- Background: protect_worksheet_shrink and protect_worksheet_destructive_keys
-- revert moduleOverviewData (and eloMloAlignment) whenever the MLO count drops
-- past a threshold or to zero, and they bump __modifiedAt to clock+1s. That bump
-- makes the reverted cloud copy look NEWER than the client's delete, so the next
-- pull resurrects the MLOs. The guards must stay on to stop *accidental* wipes
-- (restore-script bugs, positional-formData corruption) which never carry intent.
--
-- The worksheet now stamps data.__intentionalShrink = <epoch ms> when the user
-- deliberately deletes an MLO. Both guards skip their moduleOverviewData /
-- eloMloAlignment branches when that token is within 120s of now. Recency-gating
-- means a stale token left in the blob can't disarm protection on a later,
-- unrelated bug-wipe.

create or replace function public._intentional_shrink_active(d jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce((d->>'__intentionalShrink')::bigint, 0)
         > (extract(epoch from clock_timestamp())*1000)::bigint - 120000;
$$;

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
  intentional boolean;
begin
  if new.data is null or old.data is null then
    return new;
  end if;
  if not (new.data ? '__modifiedAt') then
    new.data := jsonb_set(new.data, '{__modifiedAt}', '{}'::jsonb, true);
  end if;

  intentional := public._intentional_shrink_active(new.data);

  -- whole-value keys
  foreach k in array whole_keys loop
    -- eloMloAlignment legitimately empties when its MLOs are intentionally deleted.
    if intentional and k = 'eloMloAlignment' then
      continue;
    end if;
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

  -- moduleOverviewData: keep OLD when it had MLOs and NEW would have none —
  -- UNLESS the user deliberately emptied it.
  if not intentional
     and public._mod_mlo_count(old.data->'moduleOverviewData') > 0
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

create or replace function public.protect_worksheet_shrink()
returns trigger
language plpgsql
as $$
declare old_mlo int; new_mlo int; old_f int; new_f int; bump bigint; intentional boolean;
begin
  begin
    if new.data is null or old.data is null then return new; end if;
    bump := (extract(epoch from clock_timestamp())*1000)::bigint + 1000;
    intentional := public._intentional_shrink_active(new.data);

    old_mlo := public._mod_mlo_count(old.data->'moduleOverviewData');
    new_mlo := public._mod_mlo_count(new.data->'moduleOverviewData');
    if not intentional and old_mlo >= 4 and new_mlo::numeric < old_mlo * 0.6 then
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
end;
$$;
