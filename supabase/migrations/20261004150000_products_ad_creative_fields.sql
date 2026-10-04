-- Per-product Meta Ads creative defaults, set from the new Shop tab (click a
-- product -> fill its ad fields) rather than the launch-time Creative Vault
-- flow -- this is the "what should an ad for THIS product generally say"
-- default, separate from any one specific ad/creative_assets row.
alter table products add column if not exists ad_image_url text;
alter table products add column if not exists ad_primary_text text;
alter table products add column if not exists ad_headline text;
alter table products add column if not exists ad_description text;
alter table products add column if not exists ad_cta_type text not null default 'SHOP_NOW';
-- 'product': ads for this product link to its own order.html page (today's
-- only option, still the default). 'shop': link to the full multi-product
-- shop instead -- not live yet (shop.html doesn't exist), but harmless to
-- let someone set the preference now; nothing reads it until that ships.
alter table products add column if not exists ad_link_target text not null default 'product' check (ad_link_target in ('product', 'shop'));
-- Overrides the fixed "Hi! Interested in {product}?" template
-- ai-auto-launch-tests builds for a click-to-WhatsApp ad on this product.
alter table products add column if not exists whatsapp_welcome_message text;
