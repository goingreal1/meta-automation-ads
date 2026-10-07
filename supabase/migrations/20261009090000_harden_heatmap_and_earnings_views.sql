-- Applied to production on 2026-10-06 (kept here so the repo matches the database).
alter view public.v_day_parting_heatmap set (security_invoker = on);
alter view public.v_geo_performance_heatmap set (security_invoker = on);
alter view public.v_my_personal_earnings set (security_invoker = on);
revoke all on public.v_day_parting_heatmap, public.v_geo_performance_heatmap, public.v_my_personal_earnings from anon;
revoke insert, update, delete, truncate, references, trigger on public.v_day_parting_heatmap, public.v_geo_performance_heatmap, public.v_my_personal_earnings from authenticated;
