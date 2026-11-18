-- Phase 2 of the AI team: the creative agent makes the images the meeting decided on; a person approves them into the vault.
-- Also: verified businesses can use their approved product claims.

-- Claims. Until Revora verifies a business, the team makes no product claims beyond the plain product description.
-- After verification, the team may use ONLY the claims the owner listed for that product (in those words). Owners cannot verify themselves:
-- claims_verified_at is written by Revora staff / the service role only (the ai-team settings action never touches it).
alter table products add column if not exists ai_approved_claims text;
alter table ai_teams add column if not exists claims_verified_at timestamptz;
alter table ai_teams add column if not exists claims_verified_note text;

create table if not exists ai_team_images (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  meeting_id uuid references ai_meetings(id) on delete set null,
  brief jsonb not null default '{}'::jsonb,           -- product, angle, image_concept, headline_on_image, primary_text
  prompt text,
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed', 'approved', 'rejected')),
  image_url text,
  creative_id uuid,                                   -- the vault creative made when a person approves it
  runway_task text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_team_images_idx on ai_team_images (company_id, created_at desc);
alter table ai_team_images enable row level security;
drop policy if exists ai_team_images_select on ai_team_images;
create policy ai_team_images_select on ai_team_images for select to authenticated using (company_id = current_company_id());
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ai_team_images') then
    alter publication supabase_realtime add table ai_team_images;
  end if;
end $$;

-- The briefing now carries each product's approved claims and whether the business is verified.
create or replace function rv_team_briefing(p_company uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'generated_at', now(),
    'claims_verified', exists (select 1 from ai_teams where company_id = p_company and claims_verified_at is not null),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', product_name, 'price_naira', default_order_value_naira, 'active', is_active, 'stock', stock_on_hand,
                            'benefits', left(coalesce(benefits, ''), 300), 'approved_claims', left(coalesce(ai_approved_claims, ''), 600), 'nafdac_reg_no', nafdac_reg_no) order by product_name)
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
