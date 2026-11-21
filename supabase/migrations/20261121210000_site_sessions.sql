-- Visit journeys: one row per visit to a Revora-built page, with the Meta ad it came from, how long it stayed, what it did, and whether it ordered.
-- The same row powers the "live now" view (last_seen_at within the last minute). Recordings (step 2) hang off session_key.
create table if not exists public.site_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  site_id uuid not null,
  page_slug text,
  session_key text not null,
  visitor_id text,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  duration_s int not null default 0,
  -- where it came from
  fbclid text, fbc text, fbp text,
  meta_ad_id text, meta_adset_id text, meta_campaign_id text, placement text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  referrer_host text, landing_path text, device text, country text, viewport text,
  -- what it did
  max_scroll int not null default 0, clicks int not null default 0, cta_clicks int not null default 0,
  form_started boolean not null default false, ordered boolean not null default false, order_id uuid,
  pings int not null default 0,
  unique (site_id, session_key)
);
create index if not exists site_sessions_site_time on public.site_sessions (site_id, started_at desc);
create index if not exists site_sessions_ad on public.site_sessions (meta_ad_id) where meta_ad_id is not null;
create index if not exists site_sessions_live on public.site_sessions (last_seen_at desc);
alter table public.site_sessions enable row level security;
-- A business reads its own sessions; media buyers only those of ads on their own ad accounts, owners/admins all of the company.
create or replace function public.rv_session_visible(p_company uuid, p_ad text) returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from profiles me where me.id = auth.uid() and me.company_id = p_company and (
    me.role in ('owner', 'admin')
    or p_ad is null
    or exists (select 1 from learn_objects a join ad_accounts ac on ac.id = a.ad_account_id
               where a.level = 'ad' and a.meta_id = p_ad and ac.media_buyer_id = me.media_buyer_id)))
$$;
drop policy if exists site_sessions_read on public.site_sessions;
create policy site_sessions_read on public.site_sessions for select using (public.rv_session_visible(company_id, meta_ad_id));

-- What an order remembers about its ad and visit.
alter table public.orders add column if not exists meta_adset_id text;
alter table public.orders add column if not exists meta_campaign_id text;
alter table public.orders add column if not exists session_key text;
alter table public.orders add column if not exists placement text;

-- Public, insert/update-only entry point used by the page script. Validates the site, caps abuse, never trusts the browser for company ids.
create or replace function public.rv_session(p jsonb) returns void language plpgsql security definer set search_path to 'public' as $$
declare v_site uuid := nullif(p->>'site', '')::uuid; v_key text := left(p->>'key', 64); v_company uuid; v_ad text := left(p->>'ad', 40);
begin
  if v_site is null or v_key is null or length(v_key) < 8 then return; end if;
  select company_id into v_company from sites where id = v_site and status = 'published';
  if v_company is null then return; end if;
  if (select count(*) from site_sessions where visitor_id = left(p->>'vid', 64) and started_at > now() - interval '1 hour') >= 60 then return; end if;
  insert into site_sessions (company_id, site_id, page_slug, session_key, visitor_id, fbclid, fbc, fbp, meta_ad_id, meta_adset_id, meta_campaign_id, placement,
                             utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer_host, landing_path, device, viewport)
  values (v_company, v_site, left(p->>'page', 80), v_key, left(p->>'vid', 64), left(p->>'fbclid', 200), left(p->>'fbc', 200), left(p->>'fbp', 200), nullif(v_ad, ''),
          left(p->>'adset', 40), left(p->>'camp', 40), left(p->>'pl', 40), left(p->>'us', 60), left(p->>'um', 60), left(p->>'uc', 120), left(p->>'ut', 120), left(p->>'uterm', 120),
          left(p->>'ref', 80), left(p->>'path', 160), case when p->>'dev' in ('mobile','desktop','tablet') then p->>'dev' end, left(p->>'vp', 20))
  on conflict (site_id, session_key) do update set
    last_seen_at = now(),
    duration_s = greatest(site_sessions.duration_s, coalesce((p->>'dur')::int, 0)),
    max_scroll = greatest(site_sessions.max_scroll, least(coalesce((p->>'scroll')::int, 0), 100)),
    clicks = greatest(site_sessions.clicks, coalesce((p->>'clicks')::int, 0)),
    cta_clicks = greatest(site_sessions.cta_clicks, coalesce((p->>'cta')::int, 0)),
    form_started = site_sessions.form_started or coalesce((p->>'form')::boolean, false),
    pings = site_sessions.pings + 1;
end $$;
grant execute on function public.rv_session(jsonb) to anon, authenticated;
