-- AI Team: a team lead, a creative agent, a media buyer and customer service meet every day (live) and decide what to make and launch.
--   ai_teams             one row per business: on/off, whether the media buyer may launch without approval, daily spend cap
--   ai_meetings          one row per meeting; `decision` is the written outcome the creative agent and media buyer work from
--   ai_meeting_messages  the live transcript (agents write into it word by word; the page watches it with Realtime)
--   rv_team_briefing()   the real numbers the team reads before it talks (sales, delivery, spend, products)

create table if not exists ai_teams (
  company_id uuid primary key references companies(id) on delete cascade,
  enabled boolean not null default true,
  auto_launch boolean not null default false,          -- false: the media buyer waits for a person's approval before anything goes live
  daily_budget_cap_naira numeric not null default 0,   -- 0 = the media buyer may not spend anything yet
  meeting_hour_lagos int not null default 22 check (meeting_hour_lagos between 0 and 23),
  launch_hour_lagos int not null default 0 check (launch_hour_lagos between 0 and 23),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists ai_meetings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  topic text,
  trigger text not null default 'manual',              -- manual | daily
  started_by uuid references auth.users(id) on delete set null,
  error text,
  decision jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists ai_meetings_company_idx on ai_meetings (company_id, started_at desc);

create table if not exists ai_meeting_messages (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references ai_meetings(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  seq int not null,
  speaker text not null,                                -- team_lead | creative | media_buyer | customer_service | you
  content text not null default '',
  done boolean not null default false,                  -- false while the agent is still talking
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, seq)
);
create index if not exists ai_meeting_messages_idx on ai_meeting_messages (meeting_id, seq);

alter table ai_teams enable row level security;
alter table ai_meetings enable row level security;
alter table ai_meeting_messages enable row level security;
drop policy if exists ai_teams_select on ai_teams;
create policy ai_teams_select on ai_teams for select to authenticated using (company_id = current_company_id());
drop policy if exists ai_meetings_select on ai_meetings;
create policy ai_meetings_select on ai_meetings for select to authenticated using (company_id = current_company_id());
drop policy if exists ai_meeting_messages_select on ai_meeting_messages;
create policy ai_meeting_messages_select on ai_meeting_messages for select to authenticated using (company_id = current_company_id());
-- Writes happen only through the ai-team function (service role); nobody can edit a meeting from the browser.

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ai_meeting_messages') then
    alter publication supabase_realtime add table ai_meeting_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ai_meetings') then
    alter publication supabase_realtime add table ai_meetings;
  end if;
end $$;

-- The numbers the team reads. Last 14 days, per product, plus the daily trend and the last 7 days of ad spend.
create or replace function rv_team_briefing(p_company uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'generated_at', now(),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', product_name, 'price_naira', default_order_value_naira, 'active', is_active, 'stock', stock_on_hand, 'benefits', left(coalesce(benefits, ''), 300)) order by product_name)
                          from products where company_id = p_company and coalesce(is_active, true)), '[]'::jsonb),
    'orders_last_14d_by_product', coalesce((select jsonb_agg(x) from (
        select coalesce(product_name, 'unknown') as product, count(*) as orders,
               count(*) filter (where order_status ilike 'deliver%') as delivered,
               count(*) filter (where order_status ilike 'cancel%' or order_status ilike 'fail%' or order_status ilike 'reject%') as cancelled,
               coalesce(sum(order_value_naira), 0) as value_naira
        from orders where company_id = p_company and ordered_at > now() - interval '14 days' group by 1 order by orders desc limit 12) x), '[]'::jsonb),
    'orders_per_day_last_14d', coalesce((select jsonb_agg(x order by d) from (
        select (ordered_at at time zone 'Africa/Lagos')::date as d, count(*) as orders from orders
        where company_id = p_company and ordered_at > now() - interval '14 days' group by 1) x), '[]'::jsonb),
    'ads_last_7d', (select jsonb_build_object('spend_naira', coalesce(sum(spend_naira), 0), 'orders', coalesce(sum(orders), 0), 'clicks', coalesce(sum(clicks), 0), 'landing_page_views', coalesce(sum(landing_page_views), 0), 'impressions', coalesce(sum(impressions), 0))
                    from daily_metrics where company_id = p_company and metric_date > current_date - 7),
    'creatives_ready', (select count(*) from creatives where company_id = p_company and status ilike 'ready%'),
    'recent_hooks', coalesce((select jsonb_agg(x) from (select creative_name, hook, mechanism, format from creatives where company_id = p_company order by created_at desc limit 8) x), '[]'::jsonb)
  );
$$;
revoke all on function rv_team_briefing(uuid) from public, anon, authenticated;
grant execute on function rv_team_briefing(uuid) to service_role;
