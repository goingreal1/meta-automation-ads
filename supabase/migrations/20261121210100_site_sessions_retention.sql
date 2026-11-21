select cron.schedule('site-sessions-retention-60d','40 2 * * *', $$delete from public.site_sessions where started_at < now() - interval '60 days'$$);
