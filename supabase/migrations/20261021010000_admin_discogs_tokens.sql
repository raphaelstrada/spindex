-- Per-user Discogs personal access tokens, used only server-side by the discogs-sync function.
-- Clients can save/replace their own token through set_my_discogs_token() but can never read it back.

create table if not exists public.admin_discogs_tokens (
  user_id uuid primary key references public.admins (user_id) on delete cascade,
  token text not null check (length(token) between 10 and 200),
  updated_at timestamptz not null default now()
);

alter table public.admin_discogs_tokens enable row level security;
revoke all on public.admin_discogs_tokens from anon, authenticated;

create or replace function public.set_my_discogs_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_admin_owner() is null then
    raise exception 'Not an admin' using errcode = '42501';
  end if;

  insert into public.admin_discogs_tokens (user_id, token, updated_at)
  values (auth.uid(), trim(p_token), now())
  on conflict (user_id) do update
    set token = excluded.token,
        updated_at = excluded.updated_at;
end
$$;

revoke all on function public.set_my_discogs_token(text) from public, anon;
grant execute on function public.set_my_discogs_token(text) to authenticated;
