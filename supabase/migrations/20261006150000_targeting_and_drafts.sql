-- Ad-set targeting: cities, interests/behaviors (audience presets) -- used by ai-auto-launch-tests.
alter table ad_set_configs
  add column if not exists cities jsonb,
  add column if not exists interests jsonb,
  add column if not exists behaviors jsonb,
  add column if not exists audience_presets text[];

-- Campaign builder drafts: autosaved by the dashboard, visible only to their owner.
create table if not exists campaign_drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id(),
  profile_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  ad_account_id uuid,
  name text,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table campaign_drafts enable row level security;
create policy campaign_drafts_own on campaign_drafts for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Private bucket for the images/videos attached to a draft (first path segment = the owner's user id).
insert into storage.buckets (id, name, public, file_size_limit) values ('draft-media', 'draft-media', false, 52428800)
  on conflict (id) do nothing;
create policy draft_media_own on storage.objects for all to authenticated
  using (bucket_id = 'draft-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'draft-media' and (storage.foldername(name))[1] = auth.uid()::text);
