alter table public.autopilot_runs add column if not exists log jsonb not null default '[]'::jsonb;
