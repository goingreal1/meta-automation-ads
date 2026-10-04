-- Opens up the ad-set settings that were previously hardcoded in
-- ai-auto-launch-tests (placements, device, bid strategy, billing event,
-- optimization goal, Advantage+ audience expansion) as real per-ad-set
-- choices in the dashboard's builder. Every column is nullable and
-- ai-auto-launch-tests falls back to its existing fixed defaults when null,
-- so every ad_set_configs row written before this migration keeps launching
-- exactly as it did before -- nothing here changes existing behavior unless
-- a value is explicitly set.
alter table ad_set_configs add column if not exists optimization_goal text;
alter table ad_set_configs add column if not exists bid_strategy text;
alter table ad_set_configs add column if not exists bid_amount_naira numeric;
alter table ad_set_configs add column if not exists billing_event text;
alter table ad_set_configs add column if not exists device_platforms text[];
alter table ad_set_configs add column if not exists placement_preset text;
alter table ad_set_configs add column if not exists advantage_audience boolean not null default true;
