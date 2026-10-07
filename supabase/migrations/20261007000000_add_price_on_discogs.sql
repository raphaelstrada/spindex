alter table vinyl_records
  add column if not exists price_on_discogs numeric;

alter table vinyl_records
  add column if not exists discogs_synced_at timestamptz;
