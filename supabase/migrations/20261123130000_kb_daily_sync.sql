-- Daily refresh of the knowledge base: MCP tools + playbook + learned knowledge (lessons, video anatomy, page summaries, insights, winning copy).
-- Same pattern as the other cron jobs: ads-manager with x-cron-secret read from app_secrets. Unchanged documents are skipped by hash,
-- chunks stored without a vector (embedding was unavailable) are embedded now, deleted sources are pruned.
do $$ begin
  perform cron.unschedule('kb-sync-daily');
exception when others then null;
end $$;
select cron.schedule('kb-sync-daily', '30 3 * * *', $job$
  select net.http_post(
    url := 'https://oicqtpjjwmgsiluvkmpu.supabase.co/functions/v1/ads-manager',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.app_secrets where key = 'ads_cron_secret')),
    body := '{"action":"kb_ingest","builtin":["mcp","learned"]}'::jsonb,
    timeout_milliseconds := 140000
  );
$job$);
