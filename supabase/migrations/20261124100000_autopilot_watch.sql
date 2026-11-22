-- Autopilot watch step: what the team saw today for this run's campaign, and the items that need the owner's tap.
-- watch = { checked_at, campaign_ids[], day, today{spend,orders,lpv,clicks,impressions,cost_per_order,conversion_pct}, life{...}, days[{day,spend,orders}], kills_since, needs[{id,kind,title,body,status,hook,image_id,at}] }
-- Money in watch is in autopilot_runs.billing_currency (the ad account's own currency).
alter table public.autopilot_runs add column if not exists watch jsonb not null default '{}'::jsonb;
