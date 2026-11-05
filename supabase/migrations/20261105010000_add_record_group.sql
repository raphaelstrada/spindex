-- Optional group a record belongs to (e.g. a Marketplace lot). Shown on the storefront, so public_catalog exposes it.
alter table public.vinyl_records
  add column if not exists record_group text;

-- Same view as before; a replaced view can only gain columns at the end.
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
  public.record_sale_price_cad(v) as sale_price_cad,
  v.record_group
from public.vinyl_records v
where v.sold = false
  and v.sell_possibility = true
  and (v.reserved_until is null or v.reserved_until <= now())
  and public.record_sale_price_cad(v) is not null;
