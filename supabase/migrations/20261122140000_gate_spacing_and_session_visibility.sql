create table if not exists public.meta_gate_runs (job text primary key, last_ok timestamptz not null default now());
alter table public.meta_gate_runs enable row level security;

drop function if exists public.meta_bg_ok();
create or replace function public.meta_bg_ok(p_job text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean; guard boolean := p_job in ('auto-kill', 'balance-guard', 'managed-guard');
begin
  -- Jobs that protect money (auto-kill, balance guards) may run even while a screen is open if they have been held back for 20 minutes.
  update meta_gate set last_job_at = now()
   where id = 1
     and (coalesce(ui_until, '-infinity') < now()
          or (guard and coalesce((select last_ok from meta_gate_runs where job = p_job), '-infinity') < now() - interval '20 minutes'))
     and coalesce(rate_until, '-infinity') < now()
     and coalesce(last_job_at, '-infinity') < now() - interval '45 seconds'
  returning true into ok;
  if ok and p_job is not null then
    insert into meta_gate_runs (job, last_ok) values (p_job, now()) on conflict (job) do update set last_ok = now();
  end if;
  return coalesce(ok, false);
end $$;
revoke all on function public.meta_bg_ok(text) from public, anon, authenticated;
grant execute on function public.meta_bg_ok(text) to service_role;

do $$
declare m jsonb := '{"ads-auto-kill-every-15min":"auto-kill","ads-balance-guard-every-5min":"balance-guard","managed-guard-every-10min":"managed-guard","meta-purchase-alerts-every-5min":"purchase-alerts","meta-status-refresh-every-5min":"status-refresh","pull-meta-metrics-every-30min":"metrics","check-low-ad-balances-every-30min":"low-balance","learn-sync-hourly":"learn-sync"}'::jsonb; j record;
begin
  for j in select jobid, jobname, command from cron.job where jobname in (select jsonb_object_keys(m)) loop
    perform cron.alter_job(j.jobid, command := replace(j.command, 'public.meta_bg_ok()', format('public.meta_bg_ok(%L)', m->>j.jobname)));
  end loop;
end $$;

-- Every gated job gets its own minute, at least 2 minutes from any other, so the one-at-a-time gate never turns one away.
select cron.alter_job(jobid, schedule := '0,15,30,45 * * * *') from cron.job where jobname = 'ads-auto-kill-every-15min';
select cron.alter_job(jobid, schedule := '2,12,22,32,42,52 * * * *') from cron.job where jobname = 'ads-balance-guard-every-5min';
select cron.alter_job(jobid, schedule := '7,17,27,37,47,57 * * * *') from cron.job where jobname = 'managed-guard-every-10min';
select cron.alter_job(jobid, schedule := '9,24,39,54 * * * *') from cron.job where jobname = 'meta-purchase-alerts-every-5min';
select cron.alter_job(jobid, schedule := '20 * * * *') from cron.job where jobname = 'learn-sync-hourly';
select cron.alter_job(jobid, schedule := '34 * * * *') from cron.job where jobname = 'check-low-ad-balances-every-30min';
select cron.alter_job(jobid, schedule := '50 */3 * * *') from cron.job where jobname = 'meta-status-refresh-every-5min';
select cron.alter_job(jobid, schedule := '4 */3 * * *') from cron.job where jobname = 'pull-meta-metrics-every-30min';

-- A buyer sees an ad's visits once the ad is known to be theirs. Until a brand-new ad has been synced, nobody owns it yet, so
-- the company's buyers can see its visits (instead of the visits vanishing for a day).
create or replace function public.rv_session_visible(p_company uuid, p_ad text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles me where me.id = auth.uid() and me.company_id = p_company and (
    me.role in ('owner', 'admin')
    or p_ad is null
    or not exists (select 1 from learn_objects a where a.level = 'ad' and a.meta_id = p_ad)
    or exists (select 1 from learn_objects a join ad_accounts ac on ac.id = a.ad_account_id
               where a.level = 'ad' and a.meta_id = p_ad and ac.media_buyer_id = me.media_buyer_id)))
$$;
