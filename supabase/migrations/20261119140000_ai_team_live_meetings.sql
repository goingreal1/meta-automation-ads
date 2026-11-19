-- Live (human-paced) AI Team meetings: they stay open until the person ends them or the time is up, and the team answers each message.
alter table public.ai_meetings add column if not exists mode text not null default 'auto';
alter table public.ai_meetings add column if not exists ends_at timestamptz;
alter table public.ai_meetings add column if not exists duration_minutes int;
alter table public.ai_meetings add column if not exists briefing text;
alter table public.ai_meetings add column if not exists images jsonb;
alter table public.ai_meetings add column if not exists last_activity_at timestamptz;
alter table public.ai_meetings add column if not exists responding_since timestamptz;

-- the briefing also tells the team which countries each product sells in
CREATE OR REPLACE FUNCTION public.rv_team_briefing(p_company uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'generated_at', now(),
    'claims_verified', exists (select 1 from ai_teams where company_id = p_company and claims_verified_at is not null),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', product_name, 'price_naira', default_order_value_naira, 'active', is_active, 'stock', stock_on_hand,
                            'benefits', left(coalesce(benefits, ''), 300), 'approved_claims', left(coalesce(ai_approved_claims, ''), 600), 'nafdac_reg_no', nafdac_reg_no, 'target_countries', target_countries) order by product_name)
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
$function$;
