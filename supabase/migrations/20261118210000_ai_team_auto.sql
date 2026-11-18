-- Phase 4 of the AI team: a daily meeting that starts by itself, and an optional fully automatic mode.
--   daily_meeting      hold a meeting every day at meeting_hour_lagos (off by default: it costs AI credit)
--   auto_launch        fully automatic: approve the images, prepare and schedule the launches without a person (off by default)
--   auto_launch_by     the owner/admin who switched it on; launches run under that person's account and permissions
--   ai_meetings.auto_stage  where an automatic meeting is in its after-meeting steps (images -> launch -> done)
alter table ai_teams add column if not exists daily_meeting boolean not null default false;
alter table ai_teams add column if not exists auto_launch_by uuid references auth.users(id) on delete set null;
alter table ai_meetings add column if not exists auto_stage text;
alter table ai_meetings add column if not exists auto_note text;

-- A launch is claimed (status launching) before it is created on Meta, so two overlapping runs can never create it twice.
alter table ai_launches drop constraint if exists ai_launches_status_check;
alter table ai_launches add constraint ai_launches_status_check check (status in ('proposed', 'launching', 'scheduled', 'failed', 'cancelled', 'skipped'));

-- Every 5 minutes: start a due daily meeting, and move automatic meetings through their next step.
select cron.unschedule(jobid) from cron.job where jobname = 'ai-team-tick-every-5min';
select cron.schedule('ai-team-tick-every-5min', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://oicqtpjjwmgsiluvkmpu.supabase.co/functions/v1/ai-team',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='ads_cron_secret')),
    body := '{"action":"cron_tick"}'::jsonb, timeout_milliseconds := 55000);
$$);
