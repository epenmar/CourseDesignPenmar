-- Track C — C2 support: make the shared handle_new_user trigger skip anonymous
-- users. APPLIED LIVE 2026-06-18 (required so share-link anonymous sessions can
-- be created — without this, anonymous sign-in 500s because the trigger tries to
-- insert a user_profiles row from a null email).
--
-- Only adds an early-return for is_anonymous; Google/email sign-ups (you + Curate)
-- are unchanged. Anonymous share-link sessions intentionally get no user_profiles row.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if coalesce(new.is_anonymous, false) then
    return new;  -- share-link (anonymous) sessions don't belong in user_profiles
  end if;
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
$function$;
