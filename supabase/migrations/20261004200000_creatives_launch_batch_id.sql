-- Lets the dashboard group duplicated ads under their original in the Ads
-- list (mirroring Meta's own "show copies nested under the original, named
-- Copy 1/2/3" UI) instead of a flat list where a duplicated ad looks
-- unrelated to the one it came from. Copied straight from the originating
-- creative_assets row's own launch_batch_id by ai-auto-launch-tests when it
-- creates each real Meta ad creative.
alter table creatives add column if not exists launch_batch_id uuid;
create index if not exists creatives_launch_batch_id_idx on creatives(launch_batch_id);
