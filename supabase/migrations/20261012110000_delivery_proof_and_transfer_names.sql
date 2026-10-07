-- Delivery proof + approved Meta payment account names. Already applied to the live project.
-- An order becomes "delivered" only via a matched Paystack payment (the webhook uses the service role, which bypasses
-- this guard) or by the delivery agent. Buyers and customer care can't; "returned" is agent/customer care only; a
-- delivered order can only be changed by an admin.
create or replace function orders_guard_columns() returns trigger language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if auth.uid() is null then return new; end if;
  r := current_user_role();
  if r in ('owner','admin') then return new; end if;
  if new.company_id is distinct from old.company_id or new.media_buyer_id is distinct from old.media_buyer_id
     or new.product_id is distinct from old.product_id or new.order_value_naira is distinct from old.order_value_naira
     or new.quantity is distinct from old.quantity or new.currency is distinct from old.currency
     or new.event_id is distinct from old.event_id or new.capi_sent is distinct from old.capi_sent
     or new.ad_set_id is distinct from old.ad_set_id or new.ad_account_id is distinct from old.ad_account_id
     or new.site_id is distinct from old.site_id or new.payment_narration_code is distinct from old.payment_narration_code
     or new.delivered_order_commission_naira is distinct from old.delivered_order_commission_naira then
    raise exception 'Only an owner or admin can change an order''s value, product or owner';
  end if;
  if new.order_status is distinct from old.order_status then
    if old.order_status = 'delivered' then raise exception 'A delivered order can only be changed by an admin'; end if;
    if new.order_status = 'delivered' and r <> 'delivery_agent' then
      raise exception 'Only the delivery agent, or a confirmed payment, can mark an order delivered';
    end if;
    if new.order_status = 'returned' and r not in ('delivery_agent','customer_care') then
      raise exception 'Only the delivery agent or customer care can mark an order returned';
    end if;
  end if;
  if new.delivered_at is distinct from old.delivered_at and r <> 'delivery_agent' then
    raise exception 'Only the delivery agent can set the delivery time';
  end if;
  return new;
end $$;

create table if not exists public.transfer_allowed_names (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  account_name text not null,
  name_key text generated always as (lower(regexp_replace(trim(account_name), '\s+', ' ', 'g'))) stored,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, name_key)
);
alter table public.transfer_allowed_names enable row level security;
create policy transfer_names_admin_all on public.transfer_allowed_names for all to authenticated
  using (company_id = current_company_id() and current_user_role() in ('owner','admin'))
  with check (company_id = current_company_id() and current_user_role() in ('owner','admin'));
revoke all on public.transfer_allowed_names from anon;
grant select, insert, delete on public.transfer_allowed_names to authenticated;
grant all on public.transfer_allowed_names to service_role;
