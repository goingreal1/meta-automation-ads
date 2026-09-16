-- ad_set_configs was scoped to the authenticated role only, but the dashboard
-- normally runs on the anon key (matches every other table's pattern:
-- creative_assets, products, etc. all use role "public"). Reads were being
-- silently blocked, which hung the creative detail modal indefinitely since
-- the resulting rejected promise was never caught.
drop policy if exists "ad_set_configs_all" on ad_set_configs;
create policy "ad_set_configs_all" on ad_set_configs for all to public using (true) with check (true);
grant all on ad_set_configs to anon, authenticated;
