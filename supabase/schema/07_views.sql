-- Captured from the live production database (project rrkhkhgdxhmogxxtbvyt) on 2026-11-17. Apply in file order on a NEW Supabase project.
create or replace view public.v_my_personal_earnings as  WITH current_month AS (
         SELECT (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))::date AS production_month
        ), monthly_orders AS (
         SELECT (date_trunc('month'::text, orders.ordered_at))::date AS production_month,
            count(orders.id) AS total_orders_submitted,
            count(orders.id) FILTER (WHERE (orders.order_status = 'delivered'::text)) AS delivered_orders_count,
            COALESCE((((count(orders.id) FILTER (WHERE (orders.order_status = 'delivered'::text)))::numeric / (NULLIF(count(orders.id), 0))::numeric) * (100)::numeric), (0)::numeric) AS live_delivery_rate_pct
           FROM orders
          GROUP BY ((date_trunc('month'::text, orders.ordered_at))::date)
        ), combined AS (
         SELECT cm.production_month,
            COALESCE(mo.total_orders_submitted, (0)::bigint) AS total_orders_submitted,
            COALESCE(mo.delivered_orders_count, (0)::bigint) AS delivered_orders_count,
            COALESCE(mo.live_delivery_rate_pct, (0)::numeric) AS live_delivery_rate_pct
           FROM (current_month cm
             LEFT JOIN monthly_orders mo ON ((mo.production_month = cm.production_month)))
        UNION
         SELECT mo.production_month,
            mo.total_orders_submitted,
            mo.delivered_orders_count,
            mo.live_delivery_rate_pct
           FROM monthly_orders mo
          WHERE (mo.production_month <> ( SELECT current_month.production_month
                   FROM current_month))
        )
 SELECT c.production_month,
    c.total_orders_submitted,
    c.delivered_orders_count,
    round(c.live_delivery_rate_pct, 2) AS current_delivery_rate_pct,
    cb.commission_per_order_naira AS my_payout_rate_per_order,
    ((c.delivered_orders_count)::numeric * cb.commission_per_order_naira) AS total_commissions_earned_naira,
    150000 AS my_base_salary_naira,
    ((150000)::numeric + ((c.delivered_orders_count)::numeric * cb.commission_per_order_naira)) AS total_personal_paycheck_naira
   FROM (combined c
     LEFT JOIN commission_brackets cb ON ((cb.min_delivery_rate_pct = ( SELECT max(commission_brackets.min_delivery_rate_pct) AS max
           FROM commission_brackets
          WHERE (commission_brackets.min_delivery_rate_pct <= c.live_delivery_rate_pct)))));
create or replace view public.v_day_parting_heatmap as  SELECT EXTRACT(hour FROM (ordered_at AT TIME ZONE 'Africa/Lagos'::text)) AS hour_of_day,
    count(id) AS total_orders,
    count(id) FILTER (WHERE (order_status = 'delivered'::text)) AS delivered_orders,
    round(COALESCE((((count(id) FILTER (WHERE (order_status = 'delivered'::text)))::numeric / (NULLIF(count(id), 0))::numeric) * (100)::numeric), (0)::numeric), 2) AS delivery_rate_pct
   FROM orders
  GROUP BY (EXTRACT(hour FROM (ordered_at AT TIME ZONE 'Africa/Lagos'::text)))
  ORDER BY (EXTRACT(hour FROM (ordered_at AT TIME ZONE 'Africa/Lagos'::text)));
create or replace view public.media_buyer_daily_roas as  WITH spend AS (
         SELECT a.media_buyer_id,
            m.metric_date AS day,
            sum(m.spend_naira) AS spend_naira
           FROM (daily_metrics m
             JOIN ad_sets a ON (((a.id = m.ad_set_id) AND (m.ad_set_ad_id IS NULL))))
          GROUP BY a.media_buyer_id, m.metric_date
        ), revenue AS (
         SELECT o.media_buyer_id,
            ((o.ordered_at AT TIME ZONE 'Africa/Lagos'::text))::date AS day,
            count(*) FILTER (WHERE (o.order_status <> ALL (ARRAY['cancelled'::text, 'returned'::text]))) AS orders,
            COALESCE(sum(o.order_value_naira) FILTER (WHERE (o.order_status <> ALL (ARRAY['cancelled'::text, 'returned'::text]))), (0)::numeric) AS revenue_naira,
            COALESCE(sum(o.order_value_naira) FILTER (WHERE (o.order_status = 'delivered'::text)), (0)::numeric) AS delivered_revenue_naira
           FROM orders o
          GROUP BY o.media_buyer_id, (((o.ordered_at AT TIME ZONE 'Africa/Lagos'::text))::date)
        )
 SELECT COALESCE(s.media_buyer_id, r.media_buyer_id) AS media_buyer_id,
    COALESCE(s.day, r.day) AS day,
    COALESCE(s.spend_naira, (0)::numeric) AS spend_naira,
    COALESCE(r.orders, (0)::bigint) AS orders,
    COALESCE(r.revenue_naira, (0)::numeric) AS revenue_naira,
    COALESCE(r.delivered_revenue_naira, (0)::numeric) AS delivered_revenue_naira
   FROM (spend s
     FULL JOIN revenue r ON (((NOT (r.media_buyer_id IS DISTINCT FROM s.media_buyer_id)) AND (r.day = s.day))));
create or replace view public.meta_connections_public as  SELECT id,
    media_buyer_id,
    fb_user_id,
    fb_user_name,
    token_expires_at,
    scopes,
    status,
    discovered_ad_accounts,
    connected_at,
    last_synced_at,
    last_error
   FROM meta_connections;
create or replace view public.company_settings_public as  SELECT company_id,
    business_name,
    updated_at
   FROM company_settings
  WHERE (company_id = current_company_id());
create or replace view public.conversation_last_message as  SELECT DISTINCT ON (conversation_id) conversation_id,
    id AS message_id,
    direction,
    message_type,
    COALESCE((metadata ->> 'media_type'::text), message_type) AS media_type,
    "left"(COALESCE(content, ''::text), 200) AS content,
    status,
    created_at
   FROM messages
  ORDER BY conversation_id, created_at DESC;
create or replace view public.v_geo_performance_heatmap as  SELECT customer_address,
    count(id) AS total_orders,
    count(id) FILTER (WHERE (order_status = 'delivered'::text)) AS delivered_orders,
    round(COALESCE((((count(id) FILTER (WHERE (order_status = 'delivered'::text)))::numeric / (NULLIF(count(id), 0))::numeric) * (100)::numeric), (0)::numeric), 2) AS delivery_rate_pct
   FROM orders
  GROUP BY customer_address
  ORDER BY (count(id) FILTER (WHERE (order_status = 'delivered'::text))) DESC;
create or replace view public.creative_library as  WITH assets AS (
         SELECT c.company_id,
            c.public_url,
            (array_agg(c.id ORDER BY ((c.launch_batch_id IS NULL) AND (c.campaign_name IS NULL)) DESC, c.uploaded_at))[1] AS id,
            (array_agg(c.file_name ORDER BY c.uploaded_at))[1] AS name,
            (array_agg(c.asset_type ORDER BY c.uploaded_at))[1] AS asset_type,
            (array_agg(c.product_id) FILTER (WHERE (c.product_id IS NOT NULL)))[1] AS product_id,
            count(*) FILTER (WHERE ((c.launch_batch_id IS NOT NULL) OR (c.campaign_name IS NOT NULL))) AS times_used,
            min(c.uploaded_at) AS first_uploaded,
            max(c.uploaded_at) AS last_uploaded
           FROM creative_assets c
          WHERE (c.public_url IS NOT NULL)
          GROUP BY c.company_id, c.public_url
        )
 SELECT (a.id)::text AS library_id,
    'vault'::text AS source,
    a.company_id,
    a.product_id,
    p.product_name,
    lower(TRIM(BOTH FROM regexp_replace(COALESCE(p.product_name, ''::text), '[^a-zA-Z0-9]+'::text, ' '::text, 'g'::text))) AS product_key,
        CASE
            WHEN (a.asset_type = 'video'::text) THEN 'video'::text
            ELSE 'image'::text
        END AS kind,
    a.public_url AS url,
    a.name,
    a.times_used,
    a.first_uploaded,
    a.last_uploaded
   FROM (assets a
     LEFT JOIN products p ON ((p.id = a.product_id)))
UNION ALL
 SELECT (('product:'::text || p.id) || ':ad'::text) AS library_id,
    'product_ad_image'::text AS source,
    p.company_id,
    p.id AS product_id,
    p.product_name,
    lower(TRIM(BOTH FROM regexp_replace(p.product_name, '[^a-zA-Z0-9]+'::text, ' '::text, 'g'::text))) AS product_key,
    'image'::text AS kind,
    p.ad_image_url AS url,
    'Shop ad image'::text AS name,
    0 AS times_used,
    p.created_at AS first_uploaded,
    p.created_at AS last_uploaded
   FROM products p
  WHERE ((p.ad_image_url IS NOT NULL) AND (p.ad_image_url <> ''::text));
