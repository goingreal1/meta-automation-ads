-- Custom CRM layer: per-media-buyer ROAS attribution + AI voice-call log.
--
-- Attribution: a media buyer "owns" an ad set when the ad set (or its
-- campaign) name contains their code in square brackets, e.g.
-- "Lunessa Lagos F25-45 [TUNDE]". The code is resolved automatically on
-- insert/update of ad_sets, and every order inherits the buyer of the ad set
-- it came from (or an explicit ?buyer=CODE passed through checkout).

create table if not exists media_buyers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]+$'),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table media_buyers enable row level security;
drop policy if exists "media_buyers_all" on media_buyers;
create policy "media_buyers_all" on media_buyers for all to authenticated using (true) with check (true);
grant all on media_buyers to authenticated;

alter table ad_sets add column if not exists media_buyer_id uuid references media_buyers(id) on delete set null;
alter table orders  add column if not exists media_buyer_id uuid references media_buyers(id) on delete set null;
-- Raw click identifiers, kept so attribution can be re-derived later.
alter table orders  add column if not exists fbclid text;
alter table orders  add column if not exists meta_ad_id text;
create index if not exists ad_sets_media_buyer_idx on ad_sets(media_buyer_id);
create index if not exists orders_media_buyer_idx  on orders(media_buyer_id);

-- "[TUNDE]" anywhere in the given names -> that buyer's id.
create or replace function resolve_media_buyer(names text[])
returns uuid language sql stable as $$
  select mb.id
  from media_buyers mb, unnest(names) n
  where n is not null and upper(n) like '%[' || mb.code || ']%'
  order by length(mb.code) desc
  limit 1
$$;

create or replace function ad_sets_assign_media_buyer()
returns trigger language plpgsql as $$
begin
  if new.media_buyer_id is null then
    new.media_buyer_id := resolve_media_buyer(array[
      new.adset_name,
      (select c.campaign_name from campaigns c where c.id = new.campaign_id)
    ]);
  end if;
  return new;
end $$;

drop trigger if exists ad_sets_assign_media_buyer on ad_sets;
create trigger ad_sets_assign_media_buyer
  before insert or update of adset_name, campaign_id on ad_sets
  for each row execute function ad_sets_assign_media_buyer();

create or replace function orders_assign_media_buyer()
returns trigger language plpgsql as $$
begin
  if new.media_buyer_id is null and new.ad_set_id is not null then
    select a.media_buyer_id into new.media_buyer_id from ad_sets a where a.id = new.ad_set_id;
  end if;
  return new;
end $$;

drop trigger if exists orders_assign_media_buyer on orders;
create trigger orders_assign_media_buyer
  before insert or update of ad_set_id on orders
  for each row execute function orders_assign_media_buyer();

-- Re-run after adding a new buyer to backfill their existing ad sets/orders.
create or replace function backfill_media_buyers()
returns void language sql as $$
  update ad_sets a set media_buyer_id = resolve_media_buyer(array[
    a.adset_name, (select c.campaign_name from campaigns c where c.id = a.campaign_id)
  ]) where a.media_buyer_id is null;
  update orders o set media_buyer_id = a.media_buyer_id
  from ad_sets a where o.ad_set_id = a.id and o.media_buyer_id is null;
$$;

-- Daily ROAS per buyer. security_invoker so the existing per-ad-account RLS on
-- daily_metrics / orders still applies to whoever queries the view.
-- Revenue excludes cancelled/returned orders; "delivered" revenue is the
-- cash-in-hand figure for pay-on-delivery.
create or replace view media_buyer_daily_roas with (security_invoker = true) as
with spend as (
  select a.media_buyer_id, m.metric_date as day, sum(m.spend_naira) as spend_naira
  from daily_metrics m join ad_sets a on a.id = m.ad_set_id
  group by 1, 2
), revenue as (
  select o.media_buyer_id, (o.ordered_at at time zone 'Africa/Lagos')::date as day,
         count(*) filter (where o.order_status not in ('cancelled', 'returned')) as orders,
         coalesce(sum(o.order_value_naira) filter (where o.order_status not in ('cancelled', 'returned')), 0) as revenue_naira,
         coalesce(sum(o.order_value_naira) filter (where o.order_status = 'delivered'), 0) as delivered_revenue_naira
  from orders o
  group by 1, 2
)
select coalesce(s.media_buyer_id, r.media_buyer_id) as media_buyer_id,
       coalesce(s.day, r.day) as day,
       coalesce(s.spend_naira, 0) as spend_naira,
       coalesce(r.orders, 0) as orders,
       coalesce(r.revenue_naira, 0) as revenue_naira,
       coalesce(r.delivered_revenue_naira, 0) as delivered_revenue_naira
from spend s
full join revenue r on r.media_buyer_id is not distinct from s.media_buyer_id and r.day = s.day;

grant select on media_buyer_daily_roas to authenticated;

-- One row per AI voice call placed for an order. Transcript/summary are
-- filled in by the ElevenLabs post-call webhook.
create table if not exists voice_calls (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  to_number text not null,
  channel text not null default 'phone' check (channel in ('phone', 'whatsapp')),
  -- queued -> dialing -> initiated -> done | failed. Calls requested outside Lagos
  -- calling hours stay queued until scheduled_for; place-order-call's
  -- process_due mode (run from cron) picks them up.
  status text not null default 'queued',
  scheduled_for timestamptz not null default now(),
  elevenlabs_conversation_id text unique,
  provider_call_sid text,
  error text,
  summary text,
  transcript jsonb,
  duration_secs int,
  red_flags text[] not null default '{}',
  needs_human boolean not null default false,
  human_resolved_at timestamptz,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists voice_calls_order_idx on voice_calls(order_id);
create index if not exists voice_calls_due_idx on voice_calls(scheduled_for) where status = 'queued';
create index if not exists voice_calls_needs_human_idx on voice_calls(needs_human) where needs_human and human_resolved_at is null;

alter table voice_calls enable row level security;
-- Visible exactly when the parent order is visible (orders' own RLS applies
-- inside the subquery).
drop policy if exists "voice_calls_via_order" on voice_calls;
create policy "voice_calls_via_order" on voice_calls for all to authenticated
  using (exists (select 1 from orders o where o.id = voice_calls.order_id))
  with check (exists (select 1 from orders o where o.id = voice_calls.order_id));
grant select, update on voice_calls to authenticated;
