create table if not exists public.launch_approvals (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  user_id uuid not null,
  company_id uuid not null,
  secret_hash text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.launch_approvals enable row level security;
create index if not exists launch_approvals_plan_idx on public.launch_approvals (plan_id);
