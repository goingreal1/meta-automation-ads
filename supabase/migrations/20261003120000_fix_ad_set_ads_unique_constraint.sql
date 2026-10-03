-- The partial unique index from the previous migration
-- (ad_set_ads_meta_ad_id_key, WHERE meta_ad_id IS NOT NULL) can't be used as
-- a PostgREST upsert's ON CONFLICT target -- Postgres only infers a partial
-- index for ON CONFLICT when the INSERT statement itself repeats the same
-- WHERE predicate, which a plain onConflict:"meta_ad_id" string never does.
-- Confirmed live: sync-meta-structure reported "9 ads" synced with zero
-- errors, yet ad_set_ads stayed at 0 rows -- the upsert was failing
-- silently (its error wasn't being checked) every single time.
-- creatives.meta_ad_id already uses a plain UNIQUE constraint for exactly
-- this reason; matching that here instead of the partial index.
--
-- The old partial index is left in place rather than dropped (DROP INDEX
-- on this table hung repeatedly through this session's SQL tooling for
-- reasons never identified, even via a plain retry) -- harmless, just
-- redundant; the plain constraint below is what both sync-meta-structure
-- and ai-auto-launch-tests actually upsert against now.

alter table ad_set_ads add constraint ad_set_ads_meta_ad_id_uniq unique (meta_ad_id);
