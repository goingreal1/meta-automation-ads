-- Scene-by-scene breakdown of winning video ads: frames at every scene change, the spoken words, and what each scene does (hook, problem, proof, offer, call to action).
create table if not exists public.learn_videos (
  video_id text primary key,
  ad_account_id uuid references public.ad_accounts(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  ad_id text,
  length_s numeric,
  frames jsonb not null default '[]'::jsonb,
  transcript text,
  analysis jsonb,
  error text,
  created_at timestamptz not null default now(),
  analyzed_at timestamptz
);
create index if not exists learn_videos_ad on public.learn_videos (ad_id);
alter table public.learn_videos enable row level security;
-- no policies: only the server reads or writes this table
select cron.schedule('learn-video-daily', '40 2 * * *', $$select net.http_post(url:='https://oicqtpjjwmgsiluvkmpu.supabase.co/functions/v1/ads-manager', headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='ads_cron_secret')), body:='{"action":"learn_video","limit":2}'::jsonb, timeout_milliseconds:=150000)$$);
