alter table public.wa_templates
  add column if not exists waba_id text,
  add column if not exists number_id uuid,
  add column if not exists resend_conversation_id uuid,
  add column if not exists resend_status text check (resend_status in ('waiting','sent','failed')),
  add column if not exists notified_status text;
-- The edge function (service role) tells the person when Meta decides, using the existing notification writer.
grant execute on function public.rv_notify(uuid, text, text, text, text, text, text, jsonb, text, uuid, uuid, boolean) to service_role;
select cron.schedule('wa-templates-poll-5min', '*/5 * * * *', $$select net.http_post(url:='https://oicqtpjjwmgsiluvkmpu.supabase.co/functions/v1/send-whatsapp-template', headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='ads_cron_secret')), body:='{"action":"poll"}'::jsonb, timeout_milliseconds:=60000)$$);
