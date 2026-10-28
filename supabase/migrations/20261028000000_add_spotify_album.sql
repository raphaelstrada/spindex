-- Spotify album matched to each record (admin "Sync with Spotify" or pasted by hand).
-- Admin-only data: covered by the existing owner RLS on vinyl_records, not exposed by public_catalog.
alter table public.vinyl_records
  add column if not exists spotify_album_id text check (spotify_album_id ~ '^[A-Za-z0-9]{22}$'),
  add column if not exists spotify_matched_at timestamptz;
