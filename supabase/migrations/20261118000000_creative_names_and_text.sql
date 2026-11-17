-- Creatives: a name the person chooses, and the ad text (primary text, headline, description, button) visible through the library view,
-- so the dashboard and the AI apps (ChatGPT/Claude) can read and reuse it when planning campaigns.
alter table public.creative_assets add column if not exists display_name text;

create or replace view public.creative_library as
 WITH assets AS (
         SELECT c.company_id,
            c.public_url,
            (array_agg(c.id ORDER BY ((c.launch_batch_id IS NULL) AND (c.campaign_name IS NULL)) DESC, c.uploaded_at))[1] AS id,
            (array_agg(COALESCE(c.display_name, c.file_name) ORDER BY (c.display_name IS NULL), c.uploaded_at))[1] AS name,
            (array_agg(c.asset_type ORDER BY c.uploaded_at))[1] AS asset_type,
            (array_agg(c.product_id) FILTER (WHERE (c.product_id IS NOT NULL)))[1] AS product_id,
            count(*) FILTER (WHERE ((c.launch_batch_id IS NOT NULL) OR (c.campaign_name IS NOT NULL))) AS times_used,
            min(c.uploaded_at) AS first_uploaded,
            max(c.uploaded_at) AS last_uploaded,
            (array_agg(c.primary_text ORDER BY c.uploaded_at DESC) FILTER (WHERE (c.primary_text IS NOT NULL AND c.primary_text <> '')))[1] AS primary_text,
            (array_agg(c.headline ORDER BY c.uploaded_at DESC) FILTER (WHERE (c.headline IS NOT NULL AND c.headline <> '')))[1] AS headline,
            (array_agg(c.description ORDER BY c.uploaded_at DESC) FILTER (WHERE (c.description IS NOT NULL AND c.description <> '')))[1] AS description,
            (array_agg(c.cta_type ORDER BY c.uploaded_at DESC) FILTER (WHERE (c.cta_type IS NOT NULL)))[1] AS cta_type
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
    a.last_uploaded,
    a.primary_text,
    a.headline,
    a.description,
    a.cta_type
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
    p.created_at AS last_uploaded,
    NULL::text AS primary_text,
    NULL::text AS headline,
    NULL::text AS description,
    NULL::text AS cta_type
   FROM products p
  WHERE ((p.ad_image_url IS NOT NULL) AND (p.ad_image_url <> ''::text));
