-- The Leaderboard tab is meant to show every media buyer in the company,
-- ranked against each other -- that's the entire point of a leaderboard.
-- But media_buyer_daily_roas_agg_v2 (shared with the Ad Spend & ROAS tab,
-- where a buyer correctly only sees their own numbers) restricts a
-- buyer-role caller to their own media_buyer_id in every CTE, so a buyer
-- opening Leaderboard only ever saw themselves ranked, with every other
-- buyer missing entirely -- not just hidden stats, the row itself never
-- existed for them to rank against.
--
-- Adds an explicit company_wide flag (default false, so the existing
-- Ad Spend & ROAS call site is unaffected) that the dashboard now passes
-- true only from the Leaderboard tab.

create or replace function media_buyer_daily_roas_agg_v2(from_date date default null, to_date date default null, company_wide boolean default false)
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
      and (current_user_role() in ('owner','admin') or company_wide or a.media_buyer_id = (select id from my_buyer))
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
      and (current_user_role() in ('owner','admin','customer_care') or company_wide or o.media_buyer_id = (select id from my_buyer))
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
      and (current_user_role() in ('owner','admin') or company_wide or p.media_buyer_id = (select id from my_buyer))
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
