-- One-off: keep 20 random records in Aaron's store and hide the rest (they stay in the admin).
-- To undo: update public.vinyl_records set sell_possibility = true
--          where collection_owner = 'Aaron' and id in (select record_id from public.hidden_store_records);

with listed as (
  select id from public.public_catalog where collection_owner = 'Aaron'
),
keep as (
  select id from listed order by random() limit 20
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
