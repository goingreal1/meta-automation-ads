-- Gate for ai-auto-launch-tests: a creative only gets auto-posted if the
-- product it's linked to (creative_assets.product_id, which already existed
-- unused) has auto-posting explicitly turned on. Off by default so nothing
-- posts until the product owner opts in.
alter table products add column if not exists auto_post_enabled boolean not null default false;
