-- Sites belong to the media buyer who created them; their orders inherit that buyer (receive-order).
alter table sites add column if not exists media_buyer_id uuid references media_buyers(id) on delete set null;
create or replace function current_buyer_id() returns uuid language sql stable security definer set search_path = public as $f$ select media_buyer_id from profiles where id = auth.uid() $f$;
alter table sites alter column media_buyer_id set default current_buyer_id();
drop policy if exists sites_company on sites;
drop policy if exists site_pages_company on site_pages;
create policy sites_scoped on sites for all to authenticated
  using (company_id = current_company_id() and (current_user_role() = any (array['owner','admin','customer_care']) or media_buyer_id = current_buyer_id()))
  with check (company_id = current_company_id() and (current_user_role() = any (array['owner','admin','customer_care']) or media_buyer_id = current_buyer_id()));
create policy site_pages_scoped on site_pages for all to authenticated
  using (company_id = current_company_id() and (current_user_role() = any (array['owner','admin','customer_care']) or exists (select 1 from sites s where s.id = site_pages.site_id and s.media_buyer_id = current_buyer_id())))
  with check (company_id = current_company_id() and (current_user_role() = any (array['owner','admin','customer_care']) or exists (select 1 from sites s where s.id = site_pages.site_id and s.media_buyer_id = current_buyer_id())));
