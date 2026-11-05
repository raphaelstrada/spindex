-- Third collection owner. vinyl_records has no owner constraint, so only admins needs widening.
alter table public.admins drop constraint admins_collection_owner_check;
alter table public.admins
  add constraint admins_collection_owner_check check (collection_owner in ('Raphael', 'Tim', 'Aaron'));

-- Admin row: create the user in the Supabase dashboard (Auth > Users), then run:
-- insert into public.admins (user_id, collection_owner) values ('<aaron-user-uuid>', 'Aaron');
