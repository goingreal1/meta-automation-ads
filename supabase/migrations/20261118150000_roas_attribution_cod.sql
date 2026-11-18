-- Real ROAS: every order belongs to the media buyer who ran the ads, cash on delivery counts from the moment the courier delivers it
-- ("awaiting payout"), delivery fees are tracked, a transfer that arrives after cash-on-delivery was booked raises an alert,
-- and kill rules can also judge the cost per landing page view.

alter table public.orders add column if not exists attribution_source text, add column if not exists cod_collected_at timestamptz;
alter table public.kill_rules add column if not exists max_cost_per_lpv numeric;

-- ── 1. Who ran the ads for this order? ──────────────────────────────────────────────────────────────
-- Order of trust: the exact ad -> its ad set -> the ad account's buyer -> the site's buyer -> the product's buyer -> the only buyer the company has.
create or replace function public.rv_resolve_order_buyer(o public.orders, out buyer uuid, out source text)
language plpgsql stable security definer set search_path = public as $$
begin
  if o.meta_ad_id is not null then
    select s.media_buyer_id into buyer from ad_set_ads x join ad_sets s on s.id = x.ad_set_id where x.meta_ad_id = o.meta_ad_id and s.media_buyer_id is not null limit 1;
    if buyer is not null then source := 'ad'; return; end if;
  end if;
  if o.ad_set_id is not null then
    select s.media_buyer_id into buyer from ad_sets s where s.id = o.ad_set_id;
    if buyer is not null then source := 'ad_set'; return; end if;
  end if;
  if o.ad_account_id is not null then
    select a.media_buyer_id into buyer from ad_accounts a where a.id = o.ad_account_id;
    if buyer is not null then source := 'ad_account'; return; end if;
  end if;
  if o.site_id is not null then
    select s.media_buyer_id into buyer from sites s where s.id = o.site_id;
    if buyer is not null then source := 'site'; return; end if;
  end if;
  if o.product_id is not null then
    select p.media_buyer_id into buyer from products p where p.id = o.product_id;
    if buyer is not null then source := 'product'; return; end if;
  end if;
  if o.company_id is not null and (select count(*) from media_buyers m where m.company_id = o.company_id) = 1 then
    select m.id into buyer from media_buyers m where m.company_id = o.company_id;
    source := 'only_buyer'; return;
  end if;
  buyer := null; source := null;
end $$;
revoke all on function public.rv_resolve_order_buyer(public.orders) from public, anon, authenticated;

create or replace function public.trg_order_attribute_buyer() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.media_buyer_id is null then
    select * into r from rv_resolve_order_buyer(new);
    if r.buyer is not null then new.media_buyer_id := r.buyer; new.attribution_source := r.source; end if;
  elsif new.attribution_source is null and tg_op = 'INSERT' then
    new.attribution_source := 'link';
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists order_attribute_buyer on public.orders;
create trigger order_attribute_buyer before insert or update of meta_ad_id, ad_set_id, ad_account_id, site_id, product_id on public.orders
  for each row execute function public.trg_order_attribute_buyer();

-- The money follows the order: a payment with no buyer takes its order's buyer.
create or replace function public.trg_payment_follow_order_buyer() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.media_buyer_id is null and new.order_id is not null then
    select media_buyer_id into new.media_buyer_id from orders where id = new.order_id;
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists payment_follow_order_buyer on public.payments;
create trigger payment_follow_order_buyer before insert on public.payments for each row execute function public.trg_payment_follow_order_buyer();

-- Backfill what already exists.
update public.orders o set media_buyer_id = r.buyer, attribution_source = r.source
  from (select x.id, (rv_resolve_order_buyer(x)).buyer buyer, (rv_resolve_order_buyer(x)).source source from public.orders x where x.media_buyer_id is null) r
 where o.id = r.id and r.buyer is not null;
update public.orders set attribution_source = 'link' where media_buyer_id is not null and attribution_source is null;
update public.payments p set media_buyer_id = o.media_buyer_id from public.orders o where p.order_id = o.id and p.media_buyer_id is null and o.media_buyer_id is not null;

-- ── 2. Cash on delivery: counts at delivery, shown as "awaiting payout" until Shipbubble pays ───────────
update public.orders set cod_collected_at = coalesce(delivered_at, updated_at)
 where cod_collected_at is null and order_status = 'delivered' and cod_amount_naira is not null;

create or replace function public.media_buyer_roas_extra(from_date date default null, to_date date default null, company_wide boolean default false)
returns table(media_buyer_id uuid, cod_awaiting_naira numeric, cod_awaiting_orders bigint, delivery_fees_naira numeric, cod_fees_naira numeric, unattributed_orders bigint)
language sql stable security definer set search_path = public as $$
  with me as (select p.media_buyer_id as id from profiles p where p.id = auth.uid()),
  o as (
    select x.* from orders x
    where x.company_id = current_company_id()
      and (current_user_role() in ('owner','admin') or company_wide or x.media_buyer_id = (select id from me))
      and (from_date is null or (x.ordered_at at time zone 'Africa/Lagos')::date >= from_date)
      and (to_date is null or (x.ordered_at at time zone 'Africa/Lagos')::date <= to_date)
  )
  select o.media_buyer_id,
    coalesce(sum(coalesce(o.cod_amount_naira, o.order_value_naira)) filter (where o.order_status = 'delivered' and o.cod_amount_naira is not null and o.cod_remitted_at is null
              and not exists (select 1 from payments p where p.order_id = o.id and p.status = 'confirmed')), 0),
    count(*) filter (where o.order_status = 'delivered' and o.cod_amount_naira is not null and o.cod_remitted_at is null
              and not exists (select 1 from payments p where p.order_id = o.id and p.status = 'confirmed')),
    coalesce(sum(o.shipping_fee_naira) filter (where o.order_status = 'delivered'), 0),
    coalesce(sum(o.cod_fee_naira) filter (where o.order_status = 'delivered'), 0),
    count(*) filter (where o.media_buyer_id is null and o.order_status not in ('cancelled','returned'))
  from o group by o.media_buyer_id
$$;
revoke all on function public.media_buyer_roas_extra(date, date, boolean) from public, anon;
grant execute on function public.media_buyer_roas_extra(date, date, boolean) to authenticated;

-- ── 3. A transfer arrives after cash-on-delivery was booked: warn at once ───────────────────────────────
create or replace function public.trg_notify_double_collection() returns trigger language plpgsql security definer set search_path = public as $$
declare o record;
begin
  if new.status = 'confirmed' and new.order_id is not null and coalesce(new.channel, '') <> 'shipbubble_cod'
     and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    select id, company_id, media_buyer_id, customer_name, shipbubble_order_id, cod_amount_naira, cod_remitted_at, order_status into o from orders where id = new.order_id;
    if o.id is not null and o.shipbubble_order_id is not null and coalesce(o.cod_amount_naira, 0) > 0 and o.cod_remitted_at is null and o.order_status in ('valid', 'pending') then
      perform rv_notify(o.company_id, 'money', 'double_collection_risk',
        '⚠️ ' || coalesce(nullif(trim(o.customer_name), ''), 'A customer') || ' already paid by transfer',
        'Shipbubble is still set to collect ' || rv_money(o.cod_amount_naira) || ' in cash. Tell the courier not to collect, or cancel the shipment.',
        '/dashboard_new.html?open=tab:riders', 'warn', jsonb_build_object('order_id', o.id), 'dblcollect:' || o.id, o.media_buyer_id);
    end if;
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists notify_double_collection on public.payments;
create trigger notify_double_collection after insert or update of status on public.payments for each row execute function public.trg_notify_double_collection();
