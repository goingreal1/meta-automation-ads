-- Per-profile kill rules (one row per result kind) + an audit log of every
-- pause/resume done from the dashboard or by auto-kill.
create table if not exists kill_rules (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  company_id uuid not null,
  kind text not null check (kind in ('messaging', 'purchase')),
  enabled boolean not null default true,          -- rule is used for suggestions
  auto_kill boolean not null default false,       -- also pause automatically
  max_cost_per_result numeric not null check (max_cost_per_result > 0),
  min_spend numeric not null default 0,           -- don't judge an ad before it spent this much (NGN)
  min_hours numeric not null default 0,           -- ...or before it has been live this long
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, kind)
);
alter table kill_rules enable row level security;
create policy kill_rules_own on kill_rules for all
  using (profile_id = auth.uid()
         or (company_id = current_company_id() and current_user_role() in ('owner', 'admin')))
  with check (profile_id = auth.uid()
         or (company_id = current_company_id() and current_user_role() in ('owner', 'admin')));

create table if not exists ad_kill_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  ad_account_id uuid not null,
  level text not null check (level in ('campaign', 'adset', 'ad')),
  meta_object_id text not null,
  object_name text,
  action text not null check (action in ('paused', 'resumed')),
  source text not null check (source in ('manual', 'auto')),
  actor_profile_id uuid,
  reason text,
  metrics jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ad_kill_log_account_idx on ad_kill_log (ad_account_id, created_at desc);
alter table ad_kill_log enable row level security;
create policy ad_kill_log_read on ad_kill_log for select
  using (company_id = current_company_id());

-- shared secret the scheduled auto-kill call presents to the ads-manager function
insert into app_secrets (key, value)
  select 'ads_cron_secret', encode(gen_random_bytes(24), 'hex')
  where not exists (select 1 from app_secrets where key = 'ads_cron_secret');
