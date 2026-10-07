-- Security hardening (audit of 2026-10-07). Already applied to the live project statement by statement
-- (DROP POLICY hangs on this project because of its DDL event triggers, so policies are altered in place).
-- 1. personal_earnings: owner/admin only (was every role of the company).
-- 2. media_buyers: only owner/admin write; a buyer may read their own row and change only meta_partner_business_id
--    (payout bank details can no longer be edited by the buyer).
-- 3. orders: only owner/admin insert/delete; buyers, customer care and delivery agents can still read/update their
--    orders but not the value, quantity, product, owner, pixel/ad links or event id.
-- 4. company_settings_public: only your own company.
-- 5. meta_connections: with-check now also restricts to own buyer.
-- 6. anon loses all table and function privileges in public.
-- 7. search_path pinned on functions that had none.

-- 1
alter policy personal_earnings_company_all on personal_earnings to authenticated
  using (company_id = current_company_id() and current_user_role() in ('owner','admin'))
  with check (company_id = current_company_id() and current_user_role() in ('owner','admin'));

-- 2
alter policy media_buyers_company_all on media_buyers to authenticated
  using (company_id = current_company_id() and current_user_role() in ('owner','admin'))
  with check (company_id = current_company_id() and current_user_role() in ('owner','admin'));
create policy media_buyers_read on media_buyers for select to authenticated
  using (company_id = current_company_id() and (current_user_role() in ('owner','admin','customer_care')
    or id = (select p.media_buyer_id from profiles p where p.id = auth.uid())));
create policy media_buyers_self_update on media_buyers for update to authenticated
  using (company_id = current_company_id() and id = (select p.media_buyer_id from profiles p where p.id = auth.uid()))
  with check (company_id = current_company_id() and id = (select p.media_buyer_id from profiles p where p.id = auth.uid()));
create or replace function media_buyers_guard_columns() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or current_user_role() in ('owner','admin') then return new; end if;
  if (to_jsonb(new) - 'meta_partner_business_id') is distinct from (to_jsonb(old) - 'meta_partner_business_id') then
    raise exception 'Only an owner or admin can change this';
  end if;
  return new;
end $$;
create trigger media_buyers_guard before update on public.media_buyers for each row execute function public.media_buyers_guard_columns();

-- 3
alter policy orders_company_scoped on orders to authenticated
  using (company_id = current_company_id() and current_user_role() in ('owner','admin'))
  with check (company_id = current_company_id() and current_user_role() in ('owner','admin'));
create policy orders_read on orders for select to authenticated
  using (company_id = current_company_id() and (current_user_role() in ('owner','admin','customer_care')
    or media_buyer_id = (select p.media_buyer_id from profiles p where p.id = auth.uid())
    or (current_user_role() = 'delivery_agent' and delivery_agent_id = (select p.delivery_agent_id from profiles p where p.id = auth.uid()))));
create policy orders_update on orders for update to authenticated
  using (company_id = current_company_id() and (current_user_role() in ('owner','admin','customer_care')
    or media_buyer_id = (select p.media_buyer_id from profiles p where p.id = auth.uid())
    or (current_user_role() = 'delivery_agent' and delivery_agent_id = (select p.delivery_agent_id from profiles p where p.id = auth.uid()))))
  with check (company_id = current_company_id());
create or replace function orders_guard_columns() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or current_user_role() in ('owner','admin') then return new; end if;
  if new.company_id is distinct from old.company_id or new.media_buyer_id is distinct from old.media_buyer_id
     or new.product_id is distinct from old.product_id or new.order_value_naira is distinct from old.order_value_naira
     or new.quantity is distinct from old.quantity or new.currency is distinct from old.currency
     or new.event_id is distinct from old.event_id or new.capi_sent is distinct from old.capi_sent
     or new.ad_set_id is distinct from old.ad_set_id or new.ad_account_id is distinct from old.ad_account_id
     or new.site_id is distinct from old.site_id or new.payment_narration_code is distinct from old.payment_narration_code then
    raise exception 'Only an owner or admin can change an order''s value, product or owner';
  end if;
  return new;
end $$;
create trigger orders_guard before update on public.orders for each row execute function public.orders_guard_columns();

-- 4
create or replace view company_settings_public with (security_invoker = false) as
  select company_id, business_name, updated_at from company_settings where company_id = current_company_id();

-- 5
alter policy meta_connections_company_scoped on meta_connections
  using (company_id = current_company_id() and (current_user_role() in ('owner','admin')
    or media_buyer_id = (select p.media_buyer_id from profiles p where p.id = auth.uid())))
  with check (company_id = current_company_id() and (current_user_role() in ('owner','admin')
    or media_buyer_id = (select p.media_buyer_id from profiles p where p.id = auth.uid())));

-- 6
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

-- 7
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and p.proconfig is null
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop execute format('alter function %s set search_path = public, extensions', r.sig); end loop;
end $$;
