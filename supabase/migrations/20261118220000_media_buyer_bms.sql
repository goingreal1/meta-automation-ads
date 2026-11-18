-- Business Managers linked to a media buyer. A buyer can link several; each is proven (the owner names one ad account it shared with Revora)
-- and one Business ID can belong to only one workspace. Ad accounts are imported from what each BM has shared with Revora's Business.
create table if not exists media_buyer_bms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  media_buyer_id uuid not null references media_buyers(id) on delete cascade,
  business_id text not null,
  label text,
  status text not null default 'linked' check (status in ('linked', 'waiting')),
  accounts_found int not null default 0,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists media_buyer_bms_business_uidx on media_buyer_bms (business_id);
create index if not exists media_buyer_bms_buyer_idx on media_buyer_bms (media_buyer_id);
alter table media_buyer_bms enable row level security;
drop policy if exists media_buyer_bms_select on media_buyer_bms;
create policy media_buyer_bms_select on media_buyer_bms for select to authenticated using (company_id = current_company_id());

-- The Business IDs that were already saved on a buyer (one each) carry over.
insert into media_buyer_bms (company_id, media_buyer_id, business_id, status)
select company_id, id, meta_partner_business_id, 'linked' from media_buyers
where meta_partner_business_id is not null and meta_partner_business_id ~ '^[0-9]+$' and company_id is not null
on conflict (business_id) do nothing;

-- Pull everything newly shared, every 15 minutes (before this, an account shared later was only picked up when someone pressed Sync).
select cron.unschedule(jobid) from cron.job where jobname = 'partner-sync-every-15min';
select cron.schedule('partner-sync-every-15min', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://oicqtpjjwmgsiluvkmpu.supabase.co/functions/v1/sync-partner-accounts',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='ads_cron_secret')),
    body := '{"mode":"sync_all"}'::jsonb, timeout_milliseconds := 55000);
$$);
