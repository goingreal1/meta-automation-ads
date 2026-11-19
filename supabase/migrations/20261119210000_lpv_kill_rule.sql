-- Landing page view cost limit: its own switch, spend threshold and auto-pause setting (on the person's "purchase" kill rule row).
alter table public.kill_rules add column if not exists lpv_enabled boolean not null default false;
alter table public.kill_rules add column if not exists lpv_auto_kill boolean not null default false;
alter table public.kill_rules add column if not exists lpv_min_spend numeric;
update public.kill_rules set lpv_enabled = enabled, lpv_auto_kill = auto_kill, lpv_min_spend = min_spend where max_cost_per_lpv > 0 and kind = 'purchase';
