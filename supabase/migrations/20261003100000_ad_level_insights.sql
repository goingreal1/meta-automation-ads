-- Every daily_metrics row has only ever been ad-set-level (Meta's insights
-- were pulled with level=adset). The new Campaign UI needs per-AD
-- performance -- which creative variant inside an ad set is actually
-- carrying it -- so this adds an optional link to the specific ad. A row
-- with ad_set_ad_id null is the existing ad-set-level rollup (unchanged
-- behavior everywhere that already reads this table); a row with it set is
-- the new per-ad breakdown.

alter table daily_metrics add column if not exists ad_set_ad_id uuid references ad_set_ads(id);
create index if not exists daily_metrics_ad_set_ad_idx on daily_metrics(ad_set_ad_id);
