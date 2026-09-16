-- User-editable campaign name (was always auto-generated from product+filename+
-- timestamp, which the user found confusing to identify in Meta Ads Manager).
alter table creative_assets add column if not exists campaign_name text;

-- Direct, explicit ad-set builder replacing the abstract targeting_presets
-- checkbox flow ("Wellness Interest" etc, which the user found confusing).
-- One row per ad set the user builds/duplicates for a creative -- real Meta
-- fields (budget, age, gender, geography), no hidden defaults.
create table if not exists ad_set_configs (
  id uuid primary key default gen_random_uuid(),
  creative_id uuid not null references creative_assets(id) on delete cascade,
  label text not null,
  budget_naira numeric not null default 5000,
  age_min int not null default 25,
  age_max int not null default 65,
  gender text not null default 'all' check (gender in ('all', 'male', 'female')),
  geo_type text not null default 'nationwide' check (geo_type in ('nationwide', 'states')),
  states text[],
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table ad_set_configs enable row level security;
create policy "ad_set_configs_all" on ad_set_configs for all to authenticated using (true) with check (true);
grant all on ad_set_configs to authenticated;
