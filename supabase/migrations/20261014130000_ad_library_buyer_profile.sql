-- The library follows the buyer, not the ad account: where it came from, and which product it is about.
alter table public.ad_library
  add column if not exists source text not null default 'meta_import',
  add column if not exists product_id uuid,
  add column if not exists product_name text;
create index if not exists ad_library_buyer_idx on public.ad_library (media_buyer_id, product_name);
