-- Helper for the knowledge-base refresh: best buckets per company and breakdown (hour, placement, age/gender, region, device, country).
-- Service role only; the edge function (ads-manager kb_ingest builtin "learned") turns it into company documents.
create or replace function public.kb_insight_rollup()
returns table (company_id uuid, breakdown text, win text, buckets jsonb)
language sql stable security definer set search_path = public as $$
  select company_id, breakdown, win,
         jsonb_agg(jsonb_build_object('bucket', bucket, 'spend', round(spend), 'purchases', purchases, 'purchase_value', round(purchase_value), 'messages', messages, 'clicks', clicks, 'impressions', impressions) order by rn)
  from (
    select s.*, row_number() over (partition by company_id, breakdown, win order by purchases desc, messages desc, spend desc) rn
    from (
      select company_id, breakdown, win, bucket, sum(spend) spend, sum(purchases) purchases, sum(purchase_value) purchase_value,
             sum(messages) messages, sum(clicks) clicks, sum(impressions) impressions
      from public.learn_insights
      where level = 'campaign' and bucket <> 'all' and company_id is not null
      group by company_id, breakdown, win, bucket
    ) s
  ) r
  where rn <= 12
  group by company_id, breakdown, win;
$$;
revoke all on function public.kb_insight_rollup() from public, anon, authenticated;
grant execute on function public.kb_insight_rollup() to service_role;
