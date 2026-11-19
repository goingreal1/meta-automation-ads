-- Ads that run an existing Facebook/Instagram post (post id) instead of a new image/video.
alter table public.creative_assets add column if not exists meta_post_id text;
alter table public.creative_assets drop constraint if exists creative_assets_asset_type_check;
alter table public.creative_assets add constraint creative_assets_asset_type_check check (asset_type = any (array['video','image','post']));
