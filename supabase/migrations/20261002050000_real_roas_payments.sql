-- Real ROAS via Paystack Dedicated Virtual Accounts.
--
-- Until now, "ROAS" counted any non-cancelled order's value, and "Delivered
-- ROAS" counted orders someone manually marked delivered -- neither is
-- confirmed cash in hand, especially for a pay-on-delivery business where a
-- delivery agent could mark "delivered" without actually collecting payment.
--
-- Each order now gets its own Paystack Dedicated Virtual Account (one per
-- customer phone number, reused across their future orders -- see
-- paystack-create-account). A deposit into it triggers paystack-webhook's
-- charge.success handler, which matches it to that customer's oldest
-- pending order of the same amount and marks it confirmed -- no human ever
-- clicks "mark paid." Real ROAS is computed off confirmed payments only.

create table if not exists paystack_customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  customer_phone text not null,
  paystack_customer_code text not null unique,
  dedicated_account_number text,
  dedicated_account_bank text,
  created_at timestamptz not null default now(),
  unique (company_id, customer_phone)
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  order_id uuid references orders(id),
  media_buyer_id uuid references media_buyers(id),
  paystack_reference text unique,
  amount_naira numeric not null,
  status text not null default 'pending' check (status in ('pending','confirmed','unmatched')),
  channel text,
  paid_at timestamptz,
  raw_event jsonb,
  created_at timestamptz not null default now(),
  constraint payments_order_id_unique unique (order_id)
);

create index if not exists idx_payments_order on payments(order_id);
create index if not exists idx_payments_media_buyer on payments(media_buyer_id);
create index if not exists idx_payments_company on payments(company_id);

alter table paystack_customers enable row level security;
alter table payments enable row level security;

create policy payments_admin_all on payments for all
  using (company_id = current_company_id() and current_user_role() in ('owner','admin'))
  with check (company_id = current_company_id() and current_user_role() in ('owner','admin'));

-- Buyers/delivery agents get read-only access to their own rows -- they
-- never get insert/update/delete, matching "they confirm, never send money."
create policy payments_buyer_read on payments for select
  using (
    company_id = current_company_id()
    and (
      current_user_role() in ('owner','admin')
      or (current_user_role() = 'buyer' and media_buyer_id = (select p.media_buyer_id from profiles p where p.id = auth.uid()))
      or (current_user_role() = 'delivery_agent' and order_id in (
        select o.id from orders o
        join profiles p on p.delivery_agent_id = o.delivery_agent_id
        where p.id = auth.uid()
      ))
    )
  );

create policy paystack_customers_admin_all on paystack_customers for all
  using (company_id = current_company_id() and current_user_role() in ('owner','admin'))
  with check (company_id = current_company_id() and current_user_role() in ('owner','admin'));

-- Pre-existing gap found while wiring this up: profiles had no link to
-- delivery_agents at all, so a delivery-agent-role login couldn't be scoped
-- to their own deliveries in RLS -- the orders policy only covered
-- owner/admin/customer_care/buyer.
alter table profiles add column if not exists delivery_agent_id uuid references delivery_agents(id);

alter policy orders_company_scoped on orders
  using (
    company_id = current_company_id()
    and (
      current_user_role() in ('owner','admin','customer_care')
      or media_buyer_id = (select p.media_buyer_id from profiles p where p.id = auth.uid())
      or (current_user_role() = 'delivery_agent' and delivery_agent_id = (select p.delivery_agent_id from profiles p where p.id = auth.uid()))
    )
  );

-- New version (not a DROP+CREATE -- DROP FUNCTION hung repeatedly through
-- this session's SQL tooling for reasons never identified) adding
-- confirmed_revenue_naira, sourced from payments.status = 'confirmed'
-- rather than order/delivery status.
create or replace function media_buyer_daily_roas_agg_v2(from_date date default null, to_date date default null)
returns table(media_buyer_id uuid, day date, spend_naira numeric, orders bigint, revenue_naira numeric, delivered_revenue_naira numeric, confirmed_revenue_naira numeric)
language sql
security definer
set search_path to 'public'
as $$
  with my_buyer as (
    select p.media_buyer_id as id from profiles p where p.id = auth.uid()
  ),
  spend as (
    select a.media_buyer_id, m.metric_date as day, sum(m.spend_naira) as spend_naira
    from daily_metrics m
    join ad_sets a on a.id = m.ad_set_id
    where a.company_id = current_company_id()
      and (current_user_role() in ('owner','admin') or a.media_buyer_id = (select id from my_buyer))
      and (from_date is null or m.metric_date >= from_date)
      and (to_date is null or m.metric_date <= to_date)
    group by a.media_buyer_id, m.metric_date
  ),
  revenue as (
    select o.media_buyer_id,
      (o.ordered_at at time zone 'Africa/Lagos')::date as day,
      count(*) filter (where o.order_status not in ('cancelled','returned')) as orders,
      coalesce(sum(o.order_value_naira) filter (where o.order_status not in ('cancelled','returned')), 0) as revenue_naira,
      coalesce(sum(o.order_value_naira) filter (where o.order_status = 'delivered'), 0) as delivered_revenue_naira
    from orders o
    where o.company_id = current_company_id()
      and (current_user_role() in ('owner','admin','customer_care') or o.media_buyer_id = (select id from my_buyer))
      and (from_date is null or (o.ordered_at at time zone 'Africa/Lagos')::date >= from_date)
      and (to_date is null or (o.ordered_at at time zone 'Africa/Lagos')::date <= to_date)
    group by o.media_buyer_id, ((o.ordered_at at time zone 'Africa/Lagos')::date)
  ),
  confirmed as (
    select p.media_buyer_id,
      (p.paid_at at time zone 'Africa/Lagos')::date as day,
      coalesce(sum(p.amount_naira), 0) as confirmed_revenue_naira
    from payments p
    where p.status = 'confirmed'
      and p.company_id = current_company_id()
      and (current_user_role() in ('owner','admin') or p.media_buyer_id = (select id from my_buyer))
      and (from_date is null or (p.paid_at at time zone 'Africa/Lagos')::date >= from_date)
      and (to_date is null or (p.paid_at at time zone 'Africa/Lagos')::date <= to_date)
    group by p.media_buyer_id, ((p.paid_at at time zone 'Africa/Lagos')::date)
  )
  select
    coalesce(s.media_buyer_id, r.media_buyer_id, c.media_buyer_id),
    coalesce(s.day, r.day, c.day),
    coalesce(s.spend_naira, 0), coalesce(r.orders, 0),
    coalesce(r.revenue_naira, 0), coalesce(r.delivered_revenue_naira, 0),
    coalesce(c.confirmed_revenue_naira, 0)
  from spend s
  full join revenue r on r.media_buyer_id is not distinct from s.media_buyer_id and r.day = s.day
  full join confirmed c on c.media_buyer_id is not distinct from coalesce(s.media_buyer_id, r.media_buyer_id) and c.day = coalesce(s.day, r.day);
$$;
