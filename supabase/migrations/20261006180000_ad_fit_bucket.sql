-- Public bucket for images the dashboard has fitted to a Meta-friendly ratio (so Meta shows the whole image
-- instead of cropping it) and for preview images. Signed-in users can only write inside their own folder.
insert into storage.buckets (id, name, public, file_size_limit) values ('ad-fit', 'ad-fit', true, 10485760)
  on conflict (id) do nothing;
create policy ad_fit_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'ad-fit' and (storage.foldername(name))[1] = auth.uid()::text);
