-- Step 2: session recordings (stored as small compressed files in R2) and tracking projects for websites Revora does not host.
create table if not exists public.rec_projects (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('rp_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14)),
  company_id uuid not null,
  name text not null,
  domains text[] not null default '{}',     -- hosts allowed to send data (www. is ignored). Empty = accept any host (only while setting up).
  enabled boolean not null default true,
  record boolean not null default true,     -- also record replays (not only count visits)
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.rec_projects enable row level security;
drop policy if exists rec_projects_all on public.rec_projects;
create policy rec_projects_all on public.rec_projects for all
  using (company_id = (select company_id from public.profiles where id = auth.uid()) and (select role from public.profiles where id = auth.uid()) in ('owner', 'admin', 'buyer'))
  with check (company_id = (select company_id from public.profiles where id = auth.uid()) and (select role from public.profiles where id = auth.uid()) in ('owner', 'admin', 'buyer'));

-- Sessions can now belong to a Revora site OR to a project (external website).
alter table public.site_sessions alter column site_id drop not null;
alter table public.site_sessions add column if not exists project_id uuid;
alter table public.site_sessions add column if not exists host text;
alter table public.site_sessions add column if not exists has_recording boolean not null default false;
alter table public.site_sessions add column if not exists rec_chunks int not null default 0;
alter table public.site_sessions add column if not exists rec_bytes bigint not null default 0;
alter table public.site_sessions drop constraint if exists site_sessions_site_id_session_key_key;
create unique index if not exists site_sessions_scope_key on public.site_sessions ((coalesce(site_id, project_id)), session_key);
create index if not exists site_sessions_company_time on public.site_sessions (company_id, started_at desc);

create or replace function public.rv_session(p jsonb) returns void language plpgsql security definer set search_path to 'public' as $$
declare v_site uuid := nullif(p->>'site', '')::uuid; v_proj uuid; v_key text := left(p->>'key', 64); v_company uuid; v_ad text := left(p->>'ad', 40);
        v_host text := lower(regexp_replace(coalesce(p->>'host', ''), '^www\.', ''));
begin
  if v_key is null or length(v_key) < 8 then return; end if;
  if v_site is not null then
    select company_id into v_company from sites where id = v_site and status = 'published';
  elsif coalesce(p->>'project', '') <> '' then
    select id, company_id into v_proj, v_company from rec_projects
      where public_id = p->>'project' and enabled and (cardinality(domains) = 0 or v_host = any (select lower(regexp_replace(d, '^www\.', '')) from unnest(domains) d));
  end if;
  if v_company is null then return; end if;
  if (select count(*) from site_sessions where visitor_id = left(p->>'vid', 64) and started_at > now() - interval '1 hour') >= 60 then return; end if;
  insert into site_sessions (company_id, site_id, project_id, host, page_slug, session_key, visitor_id, fbclid, fbc, fbp, meta_ad_id, meta_adset_id, meta_campaign_id, placement,
                             utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer_host, landing_path, device, viewport)
  values (v_company, v_site, v_proj, left(v_host, 120), left(p->>'page', 80), v_key, left(p->>'vid', 64), left(p->>'fbclid', 200), left(p->>'fbc', 200), left(p->>'fbp', 200), nullif(v_ad, ''),
          left(p->>'adset', 40), left(p->>'camp', 40), left(p->>'pl', 40), left(p->>'us', 60), left(p->>'um', 60), left(p->>'uc', 120), left(p->>'ut', 120), left(p->>'uterm', 120),
          left(p->>'ref', 80), left(p->>'path', 160), case when p->>'dev' in ('mobile','desktop','tablet') then p->>'dev' end, left(p->>'vp', 20))
  on conflict ((coalesce(site_id, project_id)), session_key) do update set
    last_seen_at = now(),
    duration_s = greatest(site_sessions.duration_s, coalesce((p->>'dur')::int, 0)),
    max_scroll = greatest(site_sessions.max_scroll, least(coalesce((p->>'scroll')::int, 0), 100)),
    clicks = greatest(site_sessions.clicks, coalesce((p->>'clicks')::int, 0)),
    cta_clicks = greatest(site_sessions.cta_clicks, coalesce((p->>'cta')::int, 0)),
    form_started = site_sessions.form_started or coalesce((p->>'form')::boolean, false),
    pings = site_sessions.pings + 1;
end $$;
grant execute on function public.rv_session(jsonb) to anon, authenticated;
