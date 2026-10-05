-- Names typed in the builder. When set, ai-auto-launch-tests uses them as-is for
-- the Meta ad set / ad instead of generating "Ad Set 2-file-<timestamp>" names.
alter table ad_set_configs add column if not exists display_name text;
alter table creative_assets add column if not exists ad_name text;

-- WhatsApp greeting + pre-filled message per ad (Click-to-WhatsApp). Used as-is by the
-- launch function; blank falls back to a neutral default instead of the campaign name.
alter table creative_assets add column if not exists whatsapp_greeting text;
alter table creative_assets add column if not exists whatsapp_prefill text;

-- Which ad set (its position, 0-based, in ad_set_configs.sort_order) an ad belongs to. NULL = every
-- ad set (how older launches worked); the builder now sets it so each ad runs only in its own ad set.
alter table creative_assets add column if not exists ad_set_sort_order integer;
