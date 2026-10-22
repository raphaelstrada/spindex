-- Discogs market data, refreshed by the admin "Discogs Sync Verification" and price lookups.
-- discogs_market_price is Discogs' price suggestion for the record's media condition (based on real
-- sales, so it ignores 1/500 outlier listings). It replaces discogs_lowest_price in the admin UI.
-- Informational only: never used by record_sale_price_cad nor exposed by public_catalog.
alter table public.vinyl_records
  add column if not exists discogs_market_price numeric(10, 2),
  add column if not exists discogs_market_currency text,
  -- Condition the suggestion is for: the record's media_condition, or VG+ when Discogs has none for it.
  add column if not exists discogs_market_condition text,
  add column if not exists discogs_num_for_sale integer,
  add column if not exists discogs_market_checked_at timestamptz;
