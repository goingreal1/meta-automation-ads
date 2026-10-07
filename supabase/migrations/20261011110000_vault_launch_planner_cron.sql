-- Every 15 minutes: propose (never launch) fresh vault creatives for products whose AI switch is on and that are ready.
select cron.schedule('vault-launch-planner-every-15min', '*/15 * * * *', $cmd$
  select net.http_post(
    url := 'https://rrkhkhgdxhmogxxtbvyt.supabase.co/functions/v1/vault-launch-planner',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='ads_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000);
$cmd$);
