-- Phase 2: admin auth, per-owner RLS, server-side pricing and the public catalog view.

-- Safety guard: RLS compares collection_owner exactly, so any other spelling would make rows
-- silently disappear. Fail instead of rewriting data.
do $$
declare
  bad_count integer;
begin
  select count(*) into bad_count
  from public.vinyl_records
  where collection_owner is null or collection_owner not in ('Raphael', 'Tim');

  if bad_count > 0 then
    raise exception '% vinyl_records rows have a collection_owner other than Raphael/Tim. Fix them before running this migration.', bad_count;
  end if;
end
$$;

-- Admins ----------------------------------------------------------------------

create table if not exists public.admins (
  user_id uuid primary key references auth.users on delete cascade,
  collection_owner text not null check (collection_owner in ('Raphael', 'Tim'))
);

alter table public.admins enable row level security;
revoke all on public.admins from anon;
grant select on public.admins to authenticated;

drop policy if exists "Admins can read their own row" on public.admins;
create policy "Admins can read their own row"
on public.admins
for select
to authenticated
using (user_id = auth.uid());

create or replace function public.current_admin_owner()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select collection_owner from public.admins where user_id = auth.uid()
$$;

revoke all on function public.current_admin_owner() from public;
grant execute on function public.current_admin_owner() to authenticated;

-- vinyl_records: hero fields, forced owner, RLS --------------------------------

alter table public.vinyl_records
  add column if not exists is_hero boolean not null default false,
  add column if not exists hero_tagline text;

alter table public.vinyl_records
  alter column collection_owner set default public.current_admin_owner();

alter table public.vinyl_records enable row level security;

-- Drop any pre-existing (anon) policies so the table is not left open.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'vinyl_records'
  loop
    execute format('drop policy %I on public.vinyl_records', policy_record.policyname);
  end loop;
end
$$;

revoke all on public.vinyl_records from anon;
grant select, insert, update, delete on public.vinyl_records to authenticated;

create policy "Admins read their own records"
on public.vinyl_records
for select
to authenticated
using (collection_owner = public.current_admin_owner());

create policy "Admins insert their own records"
on public.vinyl_records
for insert
to authenticated
with check (collection_owner = public.current_admin_owner());

create policy "Admins update their own records"
on public.vinyl_records
for update
to authenticated
using (collection_owner = public.current_admin_owner())
with check (collection_owner = public.current_admin_owner());

create policy "Admins delete their own records"
on public.vinyl_records
for delete
to authenticated
using (collection_owner = public.current_admin_owner());

-- Pricing ---------------------------------------------------------------------

create table if not exists public.app_settings (
  key text primary key,
  value text not null
);

insert into public.app_settings (key, value)
values ('usd_to_cad', '1.38')
on conflict (key) do nothing;

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon;
grant select, update on public.app_settings to authenticated;

drop policy if exists "Admins read settings" on public.app_settings;
create policy "Admins read settings"
on public.app_settings
for select
to authenticated
using (public.current_admin_owner() is not null);

drop policy if exists "Admins update settings" on public.app_settings;
create policy "Admins update settings"
on public.app_settings
for update
to authenticated
using (public.current_admin_owner() is not null)
with check (public.current_admin_owner() is not null);

-- Single source of truth for the sale price (public view and checkout).
-- marketplace_price is in marketplace_currency (null/empty = CAD); price_on_discogs is USD.
-- Takes the greatest non-null CAD value, rounded up to the next whole dollar.
-- discogs_lowest_price is informational only and must never be used here.
create or replace function public.record_sale_price_cad(r public.vinyl_records)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with rate as (
    select (select value::numeric from public.app_settings where key = 'usd_to_cad') as usd_to_cad
  )
  select ceil(greatest(
    case
      when r.marketplace_price is null then null
      when upper(coalesce(nullif(trim(r.marketplace_currency), ''), 'CAD')) = 'USD'
        then r.marketplace_price * rate.usd_to_cad
      else r.marketplace_price
    end,
    r.price_on_discogs * rate.usd_to_cad
  ))
  from rate
$$;

revoke all on function public.record_sale_price_cad(public.vinyl_records) from public;
grant execute on function public.record_sale_price_cad(public.vinyl_records) to anon, authenticated;

-- Public catalog --------------------------------------------------------------

create or replace view public.public_catalog
with (security_invoker = false)
as
select
  v.id,
  v.collection_owner,
  v.artist,
  v.title,
  v.year_pressed,
  v.genre,
  v.sub_genre,
  v.record_label,
  v.record_type,
  v.record_size,
  v.country_pressed,
  v.media_condition,
  v.sleeve_condition,
  v.is_original,
  v.is_special_edition,
  v.special_edition_reason,
  v.image_url,
  v.original_image_url,
  v.discogs_link,
  v.is_hero,
  v.hero_tagline,
  public.record_sale_price_cad(v) as sale_price_cad
from public.vinyl_records v
where v.sold = false
  and v.sell_possibility = true
  and public.record_sale_price_cad(v) is not null;

revoke all on public.public_catalog from anon, authenticated;
grant select on public.public_catalog to anon, authenticated;

-- Storage: photo uploads now happen as a logged-in admin, not anon -------------

drop policy if exists "Allow anonymous vinyl original photo uploads" on storage.objects;
drop policy if exists "Admins upload vinyl original photos" on storage.objects;
create policy "Admins upload vinyl original photos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'vinyl-originals'
  and public.current_admin_owner() is not null
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif')
);

-- Admin rows: create both users in the Supabase dashboard (Auth > Users), then run:
-- insert into public.admins (user_id, collection_owner) values
--   ('<raphael-user-uuid>', 'Raphael'),
--   ('<tim-user-uuid>', 'Tim');
