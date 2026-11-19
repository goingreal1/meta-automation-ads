-- Carousel ads: one creative with 2-10 cards.
alter table public.creative_assets add column if not exists carousel_cards jsonb;
alter table public.creative_assets drop constraint if exists creative_assets_asset_type_check;
alter table public.creative_assets add constraint creative_assets_asset_type_check check (asset_type = any (array['video','image','post','carousel']));
