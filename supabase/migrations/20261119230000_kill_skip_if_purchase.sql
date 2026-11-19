alter table public.kill_rules add column if not exists skip_if_purchase boolean not null default false;
