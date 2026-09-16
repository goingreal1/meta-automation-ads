-- The product's own real photo (jar/bottle/package) -- separate from
-- creative_assets, which is ad content meant for Meta ads, not a product
-- reference image. Used by the WhatsApp bot to show/send the real product to
-- customers (warm-up message, order confirmation, etc).
alter table products add column if not exists product_image_url text;
