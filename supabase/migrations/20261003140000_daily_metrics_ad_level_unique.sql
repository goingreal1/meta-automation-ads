-- The existing unique constraint is (ad_set_id, metric_date) -- fine for
-- ad-set-level rows (ad_set_ad_id null), but an ad-level row also carries
-- its parent ad_set_id (for easy rollups), so two different ads in the same
-- ad set on the same date would collide on THAT constraint and the second
-- ad's upsert would silently overwrite the first ad's row. Ad-level rows
-- need their own conflict target: (ad_set_ad_id, metric_date).
--
-- A plain UNIQUE constraint, not a partial index -- learned the hard way on
-- ad_set_ads earlier in this session: PostgREST's upsert onConflict can't
-- infer a partial index (Postgres only does that when the INSERT statement
-- repeats the exact same WHERE predicate, which a plain onConflict string
-- never does). A plain UNIQUE constraint still allows unlimited NULLs
-- (Postgres never treats NULL = NULL), so every ad-set-level row
-- (ad_set_ad_id always null) is naturally exempt -- no partial clause needed.

alter table daily_metrics add constraint daily_metrics_ad_set_ad_id_metric_date_key unique (ad_set_ad_id, metric_date);
