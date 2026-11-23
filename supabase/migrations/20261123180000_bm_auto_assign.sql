create table if not exists public.bm_auto_assign (
  id uuid primary key default gen_random_uuid(),
  meta_user_id text not null unique,
  kind text not null check (kind in ('business_user','system_user')),
  label text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.bm_assign_log (
  asset_id text not null,
  asset_kind text not null check (asset_kind in ('page','ad_account','pixel')),
  meta_user_id text not null,
  status text not null check (status in ('ok','failed')),
  error text,
  attempted_at timestamptz not null default now(),
  primary key (asset_id, meta_user_id)
);
-- Platform-only tables: the edge function (service role) reads and writes them; nobody signed in can.
alter table public.bm_auto_assign enable row level security;
alter table public.bm_assign_log enable row level security;
