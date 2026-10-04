-- The campaign builder no longer requires linking a product to launch --
-- product_id stays optional (for Shop checkout + pixel Purchase-event
-- tracking), but the destination itself (WhatsApp number or landing page
-- URL) can now be set directly on the creative/campaign, independent of any
-- product. Nullable, and ai-auto-launch-tests prefers these over the linked
-- product's own fields only when set, falling back to the product exactly
-- as before -- an existing product-linked row keeps launching identically.
alter table creative_assets add column if not exists destination_type text check (destination_type in ('website', 'whatsapp'));
alter table creative_assets add column if not exists whatsapp_number text;
alter table creative_assets add column if not exists landing_page_url text;
