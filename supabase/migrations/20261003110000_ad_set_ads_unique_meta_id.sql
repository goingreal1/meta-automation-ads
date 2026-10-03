-- sync-meta-structure is being fixed to upsert into ad_set_ads for every ad
-- (previously it only ever linked the first ad via ad_sets.creative_id, so
-- ad sets with 2+ ads silently lost ads 2-5 from the dashboard). An upsert
-- needs something to conflict on so repeat syncs update instead of
-- duplicating -- meta_ad_id is already unique per Meta ad, so it's the
-- natural key here, same as campaigns/ad_sets/creatives already use
-- meta_campaign_id/meta_adset_id/meta_ad_id for the same purpose.

alter table ad_set_ads add column if not exists meta_ad_id text;
create unique index if not exists ad_set_ads_meta_ad_id_key on ad_set_ads(meta_ad_id) where meta_ad_id is not null;
