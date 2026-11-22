alter table public.profiles add column if not exists email_reports boolean not null default true;
alter table public.profiles add column if not exists login_alerts boolean not null default true;

create table if not exists public.login_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  device text,
  country text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  alerted_at timestamptz,
  unique (user_id, fingerprint)
);
alter table public.login_devices enable row level security;
-- no policies: only the service role (edge function) reads or writes this table
