-- One-off: keep 40 random records in Tim's store and hide the rest (they stay in the admin).
-- To undo: update public.vinyl_records set sell_possibility = true
--          where collection_owner = 'Tim' and id in (select record_id from public.hidden_store_records);

create table public.hidden_store_records (
  record_id uuid primary key,
  hidden_at timestamptz not null default now()
);

-- No policies: not reachable with the anon or authenticated keys.
alter table public.hidden_store_records enable row level security;

with listed as (
  select id from public.public_catalog where collection_owner = 'Tim'
),
keep as (
  select id from listed order by random() limit 40
),
hidden as (
  update public.vinyl_records v
  set sell_possibility = false
  where v.id in (select id from listed)
    and v.id not in (select id from keep)
  returning v.id
)
insert into public.hidden_store_records (record_id)
select id from hidden;
