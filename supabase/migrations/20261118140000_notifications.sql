-- Notifications: one in-app inbox for everything that happens in Revora, plus
-- Revora's own first-party visit tracking (so visitors / abandoned checkouts
-- do not depend on Meta or Clarity), plus an end-of-day digest.
--
--   notifications        the inbox (RLS: you only see what is yours)
--   rv_notify()          the one place that writes a notification AND sends the phone push
--   triggers             new order, delivered / cancelled, new lead, wallet top-up
--   site_visits          page views / checkout started / order placed, sent by published sites
--   rv_track()           the public beacon (anon can call it; it can only insert, never read)
--   rv_visit_stats()     visitors / abandoned numbers for the dashboard
--   rv_send_daily_digests() + pg_cron at 21:00 Lagos
--
-- Phone pushes go through the existing Web Push code in handle-whatsapp-reply
-- (push.ts), authenticated with app_secrets.ads_cron_secret like the other cron jobs.

-- ───────────────────────── inbox ─────────────────────────
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  -- Who it is for. user_id = one person. media_buyer_id = that buyer + the owners.
  -- Both null = the owners/admins of the company.
  user_id uuid references auth.users(id) on delete cascade,
  media_buyer_id uuid,
  category text not null default 'system',   -- orders | reports | ads | money | leads | messages | system
  kind text not null,                        -- order_new, order_delivered, daily_digest, ...
  title text not null,
  body text,
  url text,                                  -- where a tap goes, e.g. /dashboard_new.html?open=tab:orders
  severity text not null default 'info' check (severity in ('info', 'success', 'warn')),
  data jsonb not null default '{}'::jsonb,   -- numbers for rich cards (the digest)
  dedupe_key text,
  read_by uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now()
);
create unique index if not exists notifications_dedupe_idx on notifications (company_id, dedupe_key) where dedupe_key is not null;
create index if not exists notifications_company_created_idx on notifications (company_id, created_at desc);

alter table notifications enable row level security;
drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications
  for select to authenticated
  using (
    company_id = current_company_id()
    and (
      user_id = auth.uid()
      or (
        user_id is null
        and (
          (media_buyer_id is null
            and coalesce((select role from profiles where id = auth.uid()), '') in ('owner', 'admin'))
          or (media_buyer_id is not null
            and (media_buyer_id = (select media_buyer_id from profiles where id = auth.uid())
              or coalesce((select role from profiles where id = auth.uid()), '') in ('owner', 'admin')))
        )
      )
    )
  );
-- No insert/update/delete policies: rows are written by rv_notify() and read-marked by rv_mark_notifications_read().

-- Live updates in the app (the bell and the toast).
do $$ begin
  alter publication supabase_realtime add table notifications;
exception when duplicate_object then null; when undefined_object then null;
end $$;

-- Mark some (or all) of my notifications read.
create or replace function rv_mark_notifications_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update notifications x
     set read_by = array_append(x.read_by, auth.uid())
   where not (auth.uid() = any (x.read_by))
     and (p_ids is null or x.id = any (p_ids))
     and x.id in (select id from notifications);   -- RLS: only rows I can see
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function rv_mark_notifications_read(uuid[]) from public, anon;
grant execute on function rv_mark_notifications_read(uuid[]) to authenticated;

-- ───────────────────────── write + push ─────────────────────────
create or replace function rv_notify(
  p_company uuid, p_category text, p_kind text, p_title text, p_body text default null,
  p_url text default null, p_severity text default 'info', p_data jsonb default '{}'::jsonb,
  p_dedupe text default null, p_buyer uuid default null, p_user uuid default null, p_push boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_secret text; v_audience jsonb;
begin
  if p_company is null then return null; end if;
  insert into notifications (company_id, user_id, media_buyer_id, category, kind, title, body, url, severity, data, dedupe_key)
  values (p_company, p_user, p_buyer, coalesce(p_category, 'system'), p_kind, left(p_title, 120), left(p_body, 400),
          p_url, coalesce(p_severity, 'info'), coalesce(p_data, '{}'::jsonb), p_dedupe)
  on conflict (company_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  if v_id is null then return null; end if;

  if p_push then
    begin
      select value into v_secret from app_secrets where key = 'ads_cron_secret';
      v_audience := case
        when p_user is not null then jsonb_build_object('company_id', p_company, 'user_ids', jsonb_build_array(p_user))
        when p_buyer is not null then jsonb_build_object('company_id', p_company, 'roles', jsonb_build_array('owner', 'admin'), 'media_buyer_id', p_buyer)
        else jsonb_build_object('company_id', p_company, 'roles', jsonb_build_array('owner', 'admin'))
      end;
      perform net.http_post(
        url := 'https://oicqtpjjwmgsiluvkmpu.supabase.co/functions/v1/handle-whatsapp-reply',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
        body := jsonb_build_object(
          'audience', v_audience,
          'category', p_category,
          'notification', jsonb_build_object('title', p_title, 'body', coalesce(p_body, ''), 'url', coalesce(p_url, '/dashboard_new.html?open=notifications'), 'tag', coalesce(p_dedupe, p_kind))
        ),
        timeout_milliseconds := 15000
      );
    exception when others then null;  -- a push problem must never block the thing that happened
    end;
  end if;
  return v_id;
end $$;
revoke all on function rv_notify(uuid, text, text, text, text, text, text, jsonb, text, uuid, uuid, boolean) from public, anon, authenticated;

-- ───────────────────────── triggers ─────────────────────────
create or replace function rv_money(p_amount numeric, p_currency text default 'NGN') returns text
language sql immutable as $$
  select case when coalesce(p_currency, 'NGN') = 'NGN' then '₦' else coalesce(p_currency, '') || ' ' end
         || to_char(round(coalesce(p_amount, 0)), 'FM999,999,999,990')
$$;

-- A new order lands (any time of day).
create or replace function trg_notify_new_order() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform rv_notify(
    new.company_id, 'orders', 'order_new',
    '🛒 New order · ' || rv_money(new.order_value_naira, new.currency),
    concat_ws(' · ', nullif(trim(coalesce(new.product_name, '')), ''), nullif(trim(coalesce(new.customer_name, '')), ''), nullif(trim(coalesce(new.customer_city, '')), '')),
    '/dashboard_new.html?open=tab:orders', 'success',
    jsonb_build_object('order_id', new.id, 'value', new.order_value_naira),
    'order:' || new.id, new.media_buyer_id);
  return new;
exception when others then return new;
end $$;
drop trigger if exists notify_new_order on orders;
create trigger notify_new_order after insert on orders for each row execute function trg_notify_new_order();

-- Delivered / cancelled.
create or replace function trg_notify_order_status() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.order_status is distinct from old.order_status and new.order_status in ('delivered', 'cancelled') then
    perform rv_notify(
      new.company_id, 'orders', 'order_' || new.order_status,
      case new.order_status when 'delivered' then '✅ Delivered · ' else '⚠️ Cancelled · ' end || rv_money(new.order_value_naira, new.currency),
      concat_ws(' · ', nullif(trim(coalesce(new.customer_name, '')), ''), nullif(trim(coalesce(new.product_name, '')), '')),
      '/dashboard_new.html?open=tab:orders',
      case new.order_status when 'delivered' then 'success' else 'warn' end,
      jsonb_build_object('order_id', new.id),
      'order:' || new.id || ':' || new.order_status, new.media_buyer_id, null, new.order_status = 'cancelled');
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists notify_order_status on orders;
create trigger notify_order_status after update of order_status on orders for each row execute function trg_notify_order_status();

-- A website form lead or a Meta instant-form lead.
create or replace function trg_notify_website_lead() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform rv_notify(new.company_id, 'leads', 'lead_new', '📥 New lead · ' || coalesce(nullif(trim(new.name), ''), 'Someone'),
    concat_ws(' · ', new.product_name, nullif(trim(coalesce(new.city, '')), '')),
    '/dashboard_new.html?open=tab:orders', 'info', '{}'::jsonb, 'wlead:' || new.id);
  return new;
exception when others then return new;
end $$;
drop trigger if exists notify_website_lead on website_leads;
create trigger notify_website_lead after insert on website_leads for each row execute function trg_notify_website_lead();

create or replace function trg_notify_meta_lead() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform rv_notify(new.company_id, 'leads', 'lead_new', '📥 New lead · ' || coalesce(nullif(trim(new.full_name), ''), 'Someone'),
    concat_ws(' · ', new.campaign_name, nullif(trim(coalesce(new.city, '')), '')),
    '/dashboard_new.html?open=tab:orders', 'info', '{}'::jsonb, 'mlead:' || new.id);
  return new;
exception when others then return new;
end $$;
drop trigger if exists notify_meta_lead on leads;
create trigger notify_meta_lead after insert on leads for each row execute function trg_notify_meta_lead();

-- Money in.
create or replace function trg_notify_topup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    perform rv_notify(new.company_id, 'money', 'wallet_topup', '💰 Wallet topped up · ' || rv_money(new.amount_naira),
      'Your funding wallet is ready for ads.', '/dashboard_new.html?open=tab:wallet', 'success',
      jsonb_build_object('amount', new.amount_naira), 'topup:' || new.id, new.media_buyer_id);
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists notify_topup on wallet_topups;
create trigger notify_topup after insert or update of status on wallet_topups for each row execute function trg_notify_topup();

-- ───────────────────────── Revora's own visibility ─────────────────────────
create table if not exists site_visits (
  id bigint generated always as identity primary key,
  company_id uuid not null,
  site_id uuid not null,
  page_slug text,
  event text not null default 'view' check (event in ('view', 'form_start', 'order')),
  visitor_id text not null,
  referrer_host text,
  utm_source text,
  utm_campaign text,
  from_meta boolean not null default false,
  device text,
  created_at timestamptz not null default now()
);
create index if not exists site_visits_company_idx on site_visits (company_id, created_at desc);
create index if not exists site_visits_site_idx on site_visits (site_id, created_at desc);
create index if not exists site_visits_visitor_idx on site_visits (visitor_id, created_at desc);
alter table site_visits enable row level security;
drop policy if exists site_visits_select on site_visits;
create policy site_visits_select on site_visits for select to authenticated
  using (
    company_id = current_company_id()
    and (coalesce((select role from profiles where id = auth.uid()), '') in ('owner', 'admin')
      or exists (select 1 from sites s where s.id = site_visits.site_id
                 and s.media_buyer_id = (select media_buyer_id from profiles where id = auth.uid())))
  );

-- The beacon. Public on purpose (a customer's phone calls it), so it validates
-- hard: the site must exist and be published, and one visitor is capped per hour.
create or replace function rv_track(
  p_site uuid, p_event text, p_visitor text, p_page text default null, p_referrer text default null,
  p_utm_source text default null, p_utm_campaign text default null, p_fbclid boolean default false, p_device text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  if p_site is null or p_visitor is null or length(p_visitor) < 8 or length(p_visitor) > 64 then return; end if;
  if p_event not in ('view', 'form_start', 'order') then return; end if;
  select company_id into v_company from sites where id = p_site and status = 'published';
  if v_company is null then return; end if;
  if (select count(*) from site_visits where visitor_id = p_visitor and created_at > now() - interval '1 hour') >= 100 then return; end if;
  insert into site_visits (company_id, site_id, page_slug, event, visitor_id, referrer_host, utm_source, utm_campaign, from_meta, device)
  values (v_company, p_site, left(p_page, 80), p_event, p_visitor, left(p_referrer, 80), left(p_utm_source, 40), left(p_utm_campaign, 80),
          coalesce(p_fbclid, false), case when p_device in ('mobile', 'desktop', 'tablet') then p_device end);
end $$;
revoke all on function rv_track(uuid, text, text, text, text, text, text, boolean, text) from public;
grant execute on function rv_track(uuid, text, text, text, text, text, text, boolean, text) to anon, authenticated;

-- Numbers for one company between two moments. p_buyer limits to that buyer's sites.
create or replace function rv_visit_stats_for(p_company uuid, p_from timestamptz, p_to timestamptz, p_buyer uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with v as (
    select sv.* from site_visits sv
    left join sites s on s.id = sv.site_id
    where sv.company_id = p_company and sv.created_at >= p_from and sv.created_at < p_to
      and (p_buyer is null or s.media_buyer_id = p_buyer)
  ), starters as (select distinct visitor_id from v where event = 'form_start'),
  buyers as (select distinct visitor_id from v where event = 'order')
  select jsonb_build_object(
    'visitors', (select count(distinct visitor_id) from v where event = 'view'),
    'page_views', (select count(*) from v where event = 'view'),
    'checkout_started', (select count(*) from starters),
    'ordered', (select count(*) from buyers),
    'abandoned', (select count(*) from starters where visitor_id not in (select visitor_id from buyers)),
    'from_meta', (select count(distinct visitor_id) from v where event = 'view' and from_meta),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('source', src, 'visitors', n) order by n desc)
        from (select coalesce(nullif(utm_source, ''), nullif(referrer_host, ''), case when from_meta then 'facebook' else 'direct' end) src,
                     count(distinct visitor_id) n
              from v where event = 'view' group by 1 order by 2 desc limit 5) x), '[]'::jsonb)
  )
$$;
revoke all on function rv_visit_stats_for(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;

-- What the dashboard calls: my company, my sites (owners see all).
create or replace function rv_visit_stats(p_from timestamptz, p_to timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_role text; v_buyer uuid; v_company uuid;
begin
  select role, media_buyer_id, company_id into v_role, v_buyer, v_company from profiles where id = auth.uid();
  if v_company is null then return '{}'::jsonb; end if;
  return rv_visit_stats_for(v_company, p_from, p_to, case when v_role in ('owner', 'admin') then null else v_buyer end);
end $$;
revoke all on function rv_visit_stats(timestamptz, timestamptz) from public, anon;
grant execute on function rv_visit_stats(timestamptz, timestamptz) to authenticated;

-- ───────────────────────── end-of-day digest ─────────────────────────
create or replace function rv_send_daily_digests() returns integer language plpgsql security definer set search_path = public as $$
declare
  c record; d_start timestamptz; d_end timestamptz; d_date date; sent integer := 0;
  vs jsonb; ord integer; rev numeric; deliv integer; spend numeric; body text;
begin
  d_date := (now() at time zone 'Africa/Lagos')::date;
  d_start := d_date::timestamp at time zone 'Africa/Lagos';
  d_end := d_start + interval '1 day';
  for c in select id from companies loop
    vs := rv_visit_stats_for(c.id, d_start, d_end, null);
    select count(*) filter (where order_status <> 'cancelled'),
           coalesce(sum(order_value_naira) filter (where order_status <> 'cancelled'), 0),
           count(*) filter (where order_status = 'delivered')
      into ord, rev, deliv
      from orders where company_id = c.id and ordered_at >= d_start and ordered_at < d_end;
    select coalesce(sum(spend_naira), 0) into spend from daily_metrics where company_id = c.id and metric_date = d_date;
    continue when ord = 0 and (vs->>'visitors')::int = 0 and spend = 0;
    body := concat_ws(' · ',
      (vs->>'visitors') || ' visitors',
      case when (vs->>'abandoned')::int > 0 then (vs->>'abandoned') || ' left without ordering' end,
      case when spend > 0 then 'Ad spend ' || rv_money(spend) end);
    perform rv_notify(c.id, 'reports', 'daily_digest',
      '📊 Today: ' || ord || case when ord = 1 then ' order' else ' orders' end || ' · ' || rv_money(rev),
      body, '/dashboard_new.html?open=tab:overview', 'info',
      jsonb_build_object('date', d_date, 'orders', ord, 'revenue', rev, 'delivered', deliv, 'ad_spend', spend,
        'visitors', (vs->>'visitors')::int, 'page_views', (vs->>'page_views')::int,
        'checkout_started', (vs->>'checkout_started')::int, 'abandoned', (vs->>'abandoned')::int,
        'from_meta', (vs->>'from_meta')::int, 'sources', vs->'sources'),
      'digest:' || d_date);
    sent := sent + 1;
  end loop;
  delete from notifications where created_at < now() - interval '90 days';
  delete from site_visits where created_at < now() - interval '120 days';
  return sent;
end $$;
revoke all on function rv_send_daily_digests() from public, anon, authenticated;

-- 21:00 Lagos = 20:00 UTC.
select cron.unschedule(jobid) from cron.job where jobname = 'rv-daily-digest';
select cron.schedule('rv-daily-digest', '0 20 * * *', $cmd$select public.rv_send_daily_digests()$cmd$);
