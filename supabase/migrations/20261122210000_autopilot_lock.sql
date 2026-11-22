alter table public.autopilot_runs add column if not exists lock_until timestamptz;
alter table public.ai_launches add column if not exists run_days int;
