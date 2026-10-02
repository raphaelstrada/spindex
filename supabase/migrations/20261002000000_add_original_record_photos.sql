alter table public.vinyl_records
  add column if not exists original_image_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vinyl-originals',
  'vinyl-originals',
  true,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Allow anonymous vinyl original photo uploads"
on storage.objects
for insert
to anon
with check (
  bucket_id = 'vinyl-originals'
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif')
);