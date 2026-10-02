alter table public.vinyl_records
  add column if not exists marketplace_price numeric(10, 2),
  add column if not exists marketplace_currency text;