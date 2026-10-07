-- Internal / trigger-only SECURITY DEFINER functions were callable by anyone through
-- /rest/v1/rpc (anon key). Trigger functions don't need EXECUTE to fire.
revoke execute on function public.cron_unschedule_first_delivery_watch() from public, anon, authenticated;
revoke execute on function public.cron_unschedule_lunessa_watch() from public, anon, authenticated;
revoke execute on function public.trg_ai_sales_reply() from public, anon, authenticated;
revoke execute on function public.trg_orders_audit_log() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.prevent_profile_privilege_escalation() from public, anon, authenticated;
-- Per-buyer ROAS aggregates: signed-in users only.
revoke execute on function public.media_buyer_daily_roas_agg(date, date) from public, anon;
revoke execute on function public.media_buyer_daily_roas_agg_v2(date, date) from public, anon;
revoke execute on function public.media_buyer_daily_roas_agg_v2(date, date, boolean) from public, anon;
