-- Meta special ad category (HOUSING / NONE) carried from the plan to the launcher.
alter table public.creative_assets add column if not exists special_ad_category text;
comment on column public.creative_assets.special_ad_category is 'Meta special ad category for the campaign this ad belongs to: HOUSING or NONE. Null = NONE.';

-- Currency of the Meta ad account (NGN, USD, KES...). Null = not yet read from Meta, treat as NGN.
alter table public.ad_accounts add column if not exists currency text;

-- Country per ad set (ISO 2-letter). Null = NG. No states/cities = the whole country.
alter table public.ad_set_configs add column if not exists country text;
