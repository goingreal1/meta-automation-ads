-- Data integrity: daily_metrics grain (ad-set rows vs ad rows), conversations/purchases/link_clicks,
-- and a 30-min sync-only cron. Mirrors changes applied live. Re-runnable.
alter table public.daily_metrics add column if not exists conversations integer default 0;
alter table public.daily_metrics add column if not exists purchases integer default 0;
alter table public.daily_metrics add column if not exists link_clicks integer default 0;

alter table public.daily_metrics drop constraint if exists daily_metrics_ad_set_id_metric_date_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'daily_metrics_grain_key') then
    alter table public.daily_metrics add constraint daily_metrics_grain_key
      unique nulls not distinct (ad_set_id, ad_set_ad_id, metric_date);
  end if;
end $$;

-- Readers must filter ad_set_ad_id is null for ad-set totals (ad rows also carry ad_set_id).
-- (media_buyer_daily_roas views/RPCs and the creative_library view were patched live; see git history of this file's PR.)

select cron.schedule('pull-meta-metrics-every-30min', '*/30 * * * *', $$select net.http_post(
  url := 'https://rrkhkhgdxhmogxxtbvyt.supabase.co/functions/v1/pull-meta-metrics',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='ads_cron_secret')),
  body := '{}'::jsonb, timeout_milliseconds := 120000)$$);
