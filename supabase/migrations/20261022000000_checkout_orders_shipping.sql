-- Phase 3: Stripe Checkout. Reservations, orders, shipping settings and the server-side bag quote.

-- Reservations ----------------------------------------------------------------

alter table public.vinyl_records
  add column if not exists reserved_until timestamptz null,
  add column if not exists stripe_session_id text null;

-- Orders (written only by the stripe-webhook function with the service role) -----

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  stripe_session_id text unique,
  email text,
  shipping jsonb,
  total_cents int,
  currency text,
  record_ids uuid[],
  status text check (status in ('paid', 'needs_review')),
  created_at timestamptz default now()
);

alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;
grant select on public.orders to authenticated;

-- An order can mix both owners' records; each admin sees the orders that contain at least one of theirs.
drop policy if exists "Admins read orders with their records" on public.orders;
create policy "Admins read orders with their records"
on public.orders
for select
to authenticated
using (
  exists (
    select 1 from public.vinyl_records v
    where v.id = any(orders.record_ids)
      and v.collection_owner = public.current_admin_owner()
  )
);

-- Shipping settings (Canada only) -----------------------------------------------

create table if not exists public.shipping_settings (
  id int primary key default 1 check (id = 1),
  base_cad numeric not null default 20 check (base_cad >= 0),
  included_items int not null default 3 check (included_items >= 0),
  additional_item_cad numeric not null default 5 check (additional_item_cad >= 0),
  -- null means shipping is never free.
  free_over_cad numeric default 150 check (free_over_cad is null or free_over_cad >= 0)
);

insert into public.shipping_settings (id) values (1) on conflict (id) do nothing;

alter table public.shipping_settings enable row level security;
revoke all on public.shipping_settings from anon, authenticated;
grant select, update on public.shipping_settings to authenticated;

drop policy if exists "Admins read shipping settings" on public.shipping_settings;
create policy "Admins read shipping settings"
on public.shipping_settings
for select
to authenticated
using (public.current_admin_owner() is not null);

drop policy if exists "Admins update shipping settings" on public.shipping_settings;
create policy "Admins update shipping settings"
on public.shipping_settings
for update
to authenticated
using (public.current_admin_owner() is not null)
with check (public.current_admin_owner() is not null);

-- Single source of truth for shipping (bag quote and checkout).
-- base_cad covers up to included_items records, each extra record adds additional_item_cad,
-- and shipping is free when the subtotal is strictly above free_over_cad.
create or replace function public.shipping_cad(item_count int, subtotal numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when item_count <= 0 then 0
    when s.free_over_cad is not null and subtotal > s.free_over_cad then 0
    else s.base_cad + greatest(item_count - s.included_items, 0) * s.additional_item_cad
  end
  from public.shipping_settings s
  where s.id = 1
$$;

revoke all on function public.shipping_cad(int, numeric) from public, anon, authenticated;
grant execute on function public.shipping_cad(int, numeric) to service_role;

-- Public catalog: hide reserved rows ------------------------------------------------

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
  and (v.reserved_until is null or v.reserved_until <= now())
  and public.record_sale_price_cad(v) is not null;

revoke all on public.public_catalog from anon, authenticated;
grant select on public.public_catalog to anon, authenticated;

-- Bag quote (public): what the drawer shows. Reads only public_catalog, so prices come from the DB.
-- free_shipping_remaining_cad is the whole-dollar amount that pushes the subtotal strictly above free_over_cad.
create or replace function public.bag_quote(p_ids uuid[])
returns json
language sql
stable
security definer
set search_path = public
as $$
  with items as (
    select c.id, c.sale_price_cad
    from public.public_catalog c
    where c.id = any(p_ids[1:50])
  ),
  totals as (
    select
      coalesce(array_agg(items.id), '{}'::uuid[]) as ids,
      count(*)::int as item_count,
      coalesce(sum(items.sale_price_cad), 0) as subtotal
    from items
  ),
  quote as (
    select totals.*, public.shipping_cad(totals.item_count, totals.subtotal) as shipping, s.free_over_cad
    from totals
    cross join public.shipping_settings s
    where s.id = 1
  )
  select json_build_object(
    'available_ids', quote.ids,
    'subtotal_cad', quote.subtotal,
    'shipping_cad', quote.shipping,
    'free_shipping_remaining_cad',
      case
        when quote.item_count > 0 and quote.shipping > 0 and quote.free_over_cad is not null
          then floor(quote.free_over_cad - quote.subtotal) + 1
      end
  )
  from quote
$$;

revoke all on function public.bag_quote(uuid[]) from public, anon, authenticated;
grant execute on function public.bag_quote(uuid[]) to anon, authenticated, service_role;

-- Atomic reservation (create-checkout only) -----------------------------------------
-- Locks the rows so two checkouts for the same record cannot both succeed: the second waits,
-- then sees the first reservation. Reserves all ids or none.
create or replace function public.reserve_records(p_ids uuid[], p_until timestamptz)
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  unavailable uuid[];
  reserved json;
begin
  perform 1 from public.vinyl_records v where v.id = any(p_ids) order by v.id for update;

  select coalesce(array_agg(requested.id), '{}'::uuid[]) into unavailable
  from unnest(p_ids) as requested(id)
  where not exists (
    select 1 from public.vinyl_records v
    where v.id = requested.id
      and v.sold = false
      and v.sell_possibility = true
      and (v.reserved_until is null or v.reserved_until <= now())
      and public.record_sale_price_cad(v) is not null
  );

  if cardinality(unavailable) > 0 then
    return json_build_object('ok', false, 'unavailable_ids', unavailable);
  end if;

  update public.vinyl_records v
  set reserved_until = p_until, stripe_session_id = null
  where v.id = any(p_ids);

  select json_agg(json_build_object(
    'id', v.id,
    'artist', v.artist,
    'title', v.title,
    'price_cad', public.record_sale_price_cad(v)
  ) order by v.artist, v.title) into reserved
  from public.vinyl_records v
  where v.id = any(p_ids);

  return json_build_object('ok', true, 'records', reserved);
end
$$;

revoke all on function public.reserve_records(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.reserve_records(uuid[], timestamptz) to service_role;
