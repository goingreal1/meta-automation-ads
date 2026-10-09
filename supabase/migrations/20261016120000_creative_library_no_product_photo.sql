-- A product's own photo (products.product_image_url) is for customers (order page, WhatsApp). It is NOT an ad creative.
-- Creatives = vault uploads (creative_assets, grouped by image) plus the Shop tab's explicit ad image (products.ad_image_url).
create or replace view public.creative_library with (security_invoker = true) as
 WITH assets AS (
         SELECT c.company_id, c.public_url,
            (array_agg(c.id ORDER BY (c.launch_batch_id IS NULL AND c.campaign_name IS NULL) DESC, c.uploaded_at))[1] AS id,
            (array_agg(c.file_name ORDER BY c.uploaded_at))[1] AS name,
            (array_agg(c.asset_type ORDER BY c.uploaded_at))[1] AS asset_type,
            (array_agg(c.product_id) FILTER (WHERE c.product_id IS NOT NULL))[1] AS product_id,
            count(*) FILTER (WHERE c.launch_batch_id IS NOT NULL OR c.campaign_name IS NOT NULL) AS times_used,
            min(c.uploaded_at) AS first_uploaded, max(c.uploaded_at) AS last_uploaded
           FROM creative_assets c WHERE c.public_url IS NOT NULL GROUP BY c.company_id, c.public_url
        )
 SELECT a.id::text AS library_id, 'vault'::text AS source, a.company_id, a.product_id, p.product_name,
    lower(TRIM(BOTH FROM regexp_replace(COALESCE(p.product_name, ''::text), '[^a-zA-Z0-9]+'::text, ' '::text, 'g'::text))) AS product_key,
    CASE WHEN a.asset_type = 'video'::text THEN 'video'::text ELSE 'image'::text END AS kind,
    a.public_url AS url, a.name, a.times_used, a.first_uploaded, a.last_uploaded
   FROM assets a LEFT JOIN products p ON p.id = a.product_id
UNION ALL
 SELECT ('product:'::text || p.id) || ':ad'::text, 'product_ad_image'::text, p.company_id, p.id, p.product_name,
    lower(TRIM(BOTH FROM regexp_replace(p.product_name, '[^a-zA-Z0-9]+'::text, ' '::text, 'g'::text))),
    'image'::text, p.ad_image_url, 'Shop ad image'::text, 0, p.created_at, p.created_at
   FROM products p WHERE p.ad_image_url IS NOT NULL AND p.ad_image_url <> ''::text;
