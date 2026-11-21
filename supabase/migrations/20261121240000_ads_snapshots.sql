-- The last good copy of what Meta said about an ad account (campaigns, ad sets, ads with their numbers), per date range and filter.
-- The Campaigns screen shows this instantly, then refreshes live from Meta; when Meta says "too many calls" this copy is shown instead of a blank page.
create table if not exists public.ads_snapshots (
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  range text not null,
  status text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (ad_account_id, range, status)
);
alter table public.ads_snapshots enable row level security;   -- no policies: only the server reads and writes it
-- The learner reads every account in the background; once an hour is enough and leaves Meta's call allowance for the people using the dashboard.
select cron.unschedule('learn-sync-every-20min') where exists (select 1 from cron.job where jobname = 'learn-sync-every-20min');
select cron.schedule('learn-sync-hourly','25 * * * *', $$select net.http_post(url:='https://oicqtpjjwmgsiluvkmpu.supabase.co/functions/v1/ads-manager', headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='ads_cron_secret')), body:='{"action":"learn_sync","max_accounts":2}'::jsonb, timeout_milliseconds:=150000)$$);
