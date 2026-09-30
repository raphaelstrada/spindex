alter table public.vinyl_records
add column if not exists discogs_lowest_price numeric(10, 2);