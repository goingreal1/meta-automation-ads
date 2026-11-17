-- Captured from the live production database (project rrkhkhgdxhmogxxtbvyt) on 2026-11-17. Apply in file order on a NEW Supabase project.
-- Replace __SUPABASE_URL__ with the new project URL. A job still containing __SERVICE_ROLE_KEY__ must be changed to use the x-cron-secret header like the others.
select cron.schedule('dial-queued-calls-every-10min', '*/10 * * * *', '
  select net.http_post(
    url := ''__SUPABASE_URL__/functions/v1/place-order-call'',
    headers := jsonb_build_object(''Content-Type'', ''application/json''),
    body := jsonb_build_object(''process_due'', true, ''cron_secret'', ''089c16c81caec0af6224bfe6e473ca87e16dd89a366a7c16'')
  );
  ');
select cron.schedule('check-low-ad-balances-every-30min', '*/30 * * * *', 'select net.http_post(url:=''__SUPABASE_URL__/functions/v1/check-low-ad-balances'', headers:=jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from public.app_secrets where key=''ads_cron_secret'')), body:=''{}''::jsonb, timeout_milliseconds:=120000)');
select cron.schedule('auto-assign-delivery-every-5min', '*/5 * * * *', '
    SELECT net.http_post(
      url:=''__SUPABASE_URL__/functions/v1/auto-assign-delivery'',
      headers:=''{"Authorization": "Bearer __SERVICE_ROLE_KEY__"}''::jsonb,
      body:=''{}''::jsonb
    ) as request_id;
  ');
select cron.schedule('stuck-order-followup-every-30min', '*/30 * * * *', '
    SELECT net.http_post(
      url:=''__SUPABASE_URL__/functions/v1/stuck-order-followup'',
      headers:=''{"Authorization": "Bearer __SERVICE_ROLE_KEY__"}''::jsonb,
      body:=''{}''::jsonb
    ) as request_id;
  ');
select cron.schedule('ads-auto-kill-every-15min', '*/5 * * * *', '
  select net.http_post(
    url := ''__SUPABASE_URL__/functions/v1/ads-manager'',
    headers := jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from public.app_secrets where key=''ads_cron_secret'')),
    body := ''{"action":"auto_kill"}''::jsonb,
    timeout_milliseconds := 55000);
');
select cron.schedule('vault-launch-planner-every-15min', '*/15 * * * *', '
  select net.http_post(
    url := ''__SUPABASE_URL__/functions/v1/vault-launch-planner'',
    headers := jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from public.app_secrets where key=''ads_cron_secret'')),
    body := ''{}''::jsonb,
    timeout_milliseconds := 55000);
');
select cron.schedule('pull-meta-metrics-every-30min', '*/30 * * * *', 'select net.http_post(url:=''__SUPABASE_URL__/functions/v1/pull-meta-metrics'', headers:=jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from public.app_secrets where key=''ads_cron_secret'')), body:=''{}''::jsonb, timeout_milliseconds:=120000)');
select cron.schedule('managed-guard-every-10min', '*/5 * * * *', 'select net.http_post(url:=''__SUPABASE_URL__/functions/v1/managed-guard'', headers:=jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from public.app_secrets where key=''ads_cron_secret'')), body:=''{}''::jsonb, timeout_milliseconds:=120000)');
select cron.schedule('wallet-topup-sweep', '*/2 * * * *', 'select net.http_post(url:=''__SUPABASE_URL__/functions/v1/wallet-topup'', headers:=jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from public.app_secrets where key=''ads_cron_secret'')), body:=''{"action":"sweep"}''::jsonb, timeout_milliseconds:=60000)');
select cron.schedule('social-publisher-every-10min', '*/10 * * * *', 'select net.http_post(url:=''__SUPABASE_URL__/functions/v1/social-publisher'', headers:=jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from public.app_secrets where key=''ads_cron_secret'')), body:=''{}''::jsonb, timeout_milliseconds:=140000)');
select cron.schedule('shipbubble-retry-every-10min', '*/10 * * * *', '
  select net.http_post(
    url := ''__SUPABASE_URL__/functions/v1/create-shipbubble-delivery'',
    headers := jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from app_secrets where key=''ads_cron_secret'')),
    body := ''{}''::jsonb, timeout_milliseconds := 55000);
');
select cron.schedule('order-confirm-sweep-every-5min', '*/5 * * * *', 'select net.http_post(url := ''__SUPABASE_URL__/functions/v1/notify-customer'', headers := jsonb_build_object(''Content-Type'',''application/json'',''x-cron-secret'',(select value from public.app_secrets where key=''ads_cron_secret'')), body := jsonb_build_object(''action'',''sweep''), timeout_milliseconds := 30000)');
