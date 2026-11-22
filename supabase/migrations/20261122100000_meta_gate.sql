-- One gate for everything that calls Meta in the background.
--  * ui_until   : someone has the Campaigns screen (or another live Meta view) open, so background jobs stand aside
--  * rate_until : Meta said "too many calls"; every background job waits for the cool-down
--  * last_job_at: only one background Meta job may start per minute, so they never pile onto the same ad account
create table if not exists public.meta_gate (
  id int primary key default 1 check (id = 1),
  ui_until timestamptz,
  rate_until timestamptz,
  last_job_at timestamptz
);
insert into public.meta_gate (id) values (1) on conflict do nothing;
alter table public.meta_gate enable row level security;

create or replace function public.meta_bg_ok() returns boolean language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update meta_gate set last_job_at = now()
   where id = 1
     and coalesce(ui_until, '-infinity') < now()
     and coalesce(rate_until, '-infinity') < now()
     and coalesce(last_job_at, '-infinity') < now() - interval '60 seconds'
  returning true into ok;
  return coalesce(ok, false);
end $$;

create or replace function public.meta_ui_ping() returns void language sql security definer set search_path = public as $$
  update meta_gate set ui_until = now() + interval '3 minutes' where id = 1;
$$;
create or replace function public.meta_rate_hit() returns void language sql security definer set search_path = public as $$
  update meta_gate set rate_until = now() + interval '15 minutes' where id = 1;
$$;
revoke all on function public.meta_bg_ok(), public.meta_ui_ping(), public.meta_rate_hit() from public, anon, authenticated;
grant execute on function public.meta_bg_ok(), public.meta_ui_ping(), public.meta_rate_hit() to service_role;

-- Gate the background jobs that call Meta, spread them out, and slow down the ones that do not need to be fast.
do $$
declare j record;
begin
  for j in select jobid, jobname, command from cron.job where jobname in (
    'ads-auto-kill-every-15min','ads-balance-guard-every-5min','managed-guard-every-10min','meta-purchase-alerts-every-5min',
    'meta-status-refresh-every-5min','pull-meta-metrics-every-30min','check-low-ad-balances-every-30min','learn-sync-hourly')
  loop
    if j.command !~ 'meta_bg_ok' then
      perform cron.alter_job(j.jobid, command := regexp_replace(rtrim(j.command, E' \n\t;'), '$', ' where public.meta_bg_ok();'));
    end if;
  end loop;
end $$;
select cron.alter_job(jobid, schedule := '2,17,32,47 * * * *')  from cron.job where jobname = 'ads-auto-kill-every-15min';
select cron.alter_job(jobid, schedule := '6,16,26,36,46,56 * * * *') from cron.job where jobname = 'ads-balance-guard-every-5min';
select cron.alter_job(jobid, schedule := '4,14,24,34,44,54 * * * *') from cron.job where jobname = 'managed-guard-every-10min';
select cron.alter_job(jobid, schedule := '11,26,41,56 * * * *') from cron.job where jobname = 'meta-purchase-alerts-every-5min';
select cron.alter_job(jobid, schedule := '13 */3 * * *') from cron.job where jobname = 'meta-status-refresh-every-5min';
select cron.alter_job(jobid, schedule := '30 */3 * * *') from cron.job where jobname = 'pull-meta-metrics-every-30min';
select cron.alter_job(jobid, schedule := '40 * * * *') from cron.job where jobname = 'check-low-ad-balances-every-30min';
select cron.alter_job(jobid, schedule := '50 3 * * *') from cron.job where jobname = 'partner-sync-every-15min';
