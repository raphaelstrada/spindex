-- RLS acceptance check. Run in the Supabase SQL editor after the phase 2 migration and after
-- the admins rows exist. Replace <raphael-user-uuid>. Everything is rolled back.
-- Requires at least one Tim row. Any failed check raises an exception.

begin;

-- As Raphael ----------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<raphael-user-uuid>","role":"authenticated"}', true);

do $$
declare
  affected integer;
  inserted_owner text;
begin
  if public.current_admin_owner() is distinct from 'Raphael' then
    raise exception 'FAIL: current_admin_owner() is %, expected Raphael', public.current_admin_owner();
  end if;

  if (select count(*) from public.vinyl_records where collection_owner = 'Tim') <> 0 then
    raise exception 'FAIL: Raphael can read Tim rows';
  end if;

  if (select count(*) from public.vinyl_records where collection_owner <> 'Raphael') <> 0 then
    raise exception 'FAIL: Raphael can read rows of another owner';
  end if;

  update public.vinyl_records set notes = notes where collection_owner = 'Tim';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: Raphael updated % Tim rows', affected; end if;

  delete from public.vinyl_records where collection_owner = 'Tim';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: Raphael deleted % Tim rows', affected; end if;

  begin
    insert into public.vinyl_records (artist, title, collection_owner) values ('rls-test', 'rls-test', 'Tim');
    raise exception 'FAIL: Raphael inserted a Tim row';
  exception when insufficient_privilege then
    null; -- expected: RLS violation
  end;

  begin
    update public.vinyl_records set collection_owner = 'Tim'
    where id = (select id from public.vinyl_records limit 1);
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'FAIL: Raphael moved a row to Tim'; end if;
  exception when insufficient_privilege then
    null; -- expected: WITH CHECK violation
  end;

  insert into public.vinyl_records (artist, title) values ('rls-test', 'rls-test')
  returning collection_owner into inserted_owner;
  if inserted_owner is distinct from 'Raphael' then
    raise exception 'FAIL: default owner is %, expected Raphael', inserted_owner;
  end if;

  raise notice 'PASS: Raphael is isolated from Tim';
end
$$;

-- As anon -------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  begin
    perform 1 from public.vinyl_records limit 1;
    raise exception 'FAIL: anon can read vinyl_records';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform 1 from public.app_settings limit 1;
    raise exception 'FAIL: anon can read app_settings';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform 1 from public.admins limit 1;
    raise exception 'FAIL: anon can read admins';
  exception when insufficient_privilege then
    null;
  end;

  perform 1 from public.public_catalog limit 1;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'public_catalog'
      and column_name in ('notes', 'source_url', 'discogs_synced_at', 'discogs_lowest_price',
                          'price_on_discogs', 'marketplace_price', 'marketplace_currency')
  ) then
    raise exception 'FAIL: public_catalog exposes a private column';
  end if;

  raise notice 'PASS: anon can only read public_catalog';
end
$$;

rollback;
