-- Names typed in the builder. When set, ai-auto-launch-tests uses them as-is for
-- the Meta ad set / ad instead of generating "Ad Set 2-file-<timestamp>" names.
alter table ad_set_configs add column if not exists display_name text;
alter table creative_assets add column if not exists ad_name text;
