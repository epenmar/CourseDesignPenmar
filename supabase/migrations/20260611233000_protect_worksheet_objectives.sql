-- Server-side guard: never let a worksheet UPDATE empty out a destructive key
-- (CLOs/ELOs/module data/etc.) that was previously populated. Protects against
-- any client — old cached code or concurrent editors — pushing an empty array/
-- object over real data. The populated OLD value is kept and its __modifiedAt
-- is bumped above the incoming stamp so other clients converge to it.
create or replace function public.protect_worksheet_destructive_keys()
returns trigger
language plpgsql
as $$
declare
  k text;
  keys text[] := array['clos','flatElos','elos','cloEloAlignment',
                       'courseActivities','courseMaterials','moduleOverviewData','eloMloAlignment'];
  old_v jsonb;
  new_v jsonb;
  bump bigint;
begin
  if new.data is null or old.data is null then
    return new;
  end if;
  if not (new.data ? '__modifiedAt') then
    new.data := jsonb_set(new.data, '{__modifiedAt}', '{}'::jsonb, true);
  end if;
  foreach k in array keys loop
    old_v := old.data -> k;
    new_v := new.data -> k;
    if (old_v is not null and old_v not in ('null'::jsonb, '[]'::jsonb, '{}'::jsonb))
       and (new_v is null or new_v in ('null'::jsonb, '[]'::jsonb, '{}'::jsonb)) then
      new.data := jsonb_set(new.data, array[k], old_v, true);
      bump := greatest(
        coalesce((new.data->'__modifiedAt'->>k)::bigint, 0),
        (extract(epoch from clock_timestamp())*1000)::bigint
      ) + 1000;
      new.data := jsonb_set(new.data, array['__modifiedAt', k], to_jsonb(bump), true);
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_protect_worksheet_destructive on public.worksheets;
create trigger trg_protect_worksheet_destructive
  before update on public.worksheets
  for each row execute function public.protect_worksheet_destructive_keys();
