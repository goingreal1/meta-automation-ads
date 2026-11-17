-- Captured from the live production database (project rrkhkhgdxhmogxxtbvyt) on 2026-11-17. Apply in file order on a NEW Supabase project.
-- NOTE: the new project will NOT hold the big media. See docs/BACKEND_MIGRATION.md (media goes to Cloudflare R2).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('draft-media', 'draft-media', 'f', '52428800', NULL) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('ad-fit', 'ad-fit', 't', '10485760', NULL) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('social-media', 'social-media', 't', '104857600', NULL) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('creative-vault', 'creative-vault', 't', NULL, NULL) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('site-image-originals', 'site-image-originals', 'f', NULL, NULL) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('site-media', 'site-media', 't', '52428800', NULL) on conflict (id) do nothing;
