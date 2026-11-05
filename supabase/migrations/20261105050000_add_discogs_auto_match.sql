-- Automatic Discogs match by artist + album. Null discogs_auto_match = not processed, or confirmed by the admin.
alter table public.vinyl_records
  add column if not exists discogs_auto_match text
    check (discogs_auto_match in ('provisional', 'ambiguous', 'no_match')),
  add column if not exists discogs_auto_match_score numeric(4, 3),
  add column if not exists discogs_auto_matched_at timestamptz,
  add column if not exists discogs_auto_cover boolean not null default false;

-- Same view as before, except that a provisional link stays out of the storefront: it may be another pressing.
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
  case when v.discogs_auto_match = 'provisional' then null else v.discogs_link end as discogs_link,
  v.is_hero,
  v.hero_tagline,
  public.record_sale_price_cad(v) as sale_price_cad,
  v.record_group
from public.vinyl_records v
where v.sold = false
  and v.sell_possibility = true
  and (v.reserved_until is null or v.reserved_until <= now())
  and public.record_sale_price_cad(v) is not null;
