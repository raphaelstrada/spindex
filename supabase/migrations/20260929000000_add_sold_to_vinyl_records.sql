alter table public.vinyl_records
add column if not exists sold boolean not null default false;