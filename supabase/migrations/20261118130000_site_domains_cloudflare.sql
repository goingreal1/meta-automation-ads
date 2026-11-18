-- Domains connected from Revora can be set up on Cloudflare automatically (DNS, HTTPS, cache). cf_zone_id is the Cloudflare zone Revora manages for the domain.
alter table public.site_domains add column if not exists cf_zone_id text, add column if not exists cf_status text;
