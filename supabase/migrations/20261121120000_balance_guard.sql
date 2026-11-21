-- Low-balance guard: when a prepaid ad account's balance falls below a floor, switch off every ACTIVE campaign (with its ad sets and ads);
-- when it is topped up above a higher line, switch back on exactly what was switched off, and nothing else.
alter table public.ad_accounts add column if not exists auto_pause_low_balance boolean not null default false;
alter table public.ad_accounts add column if not exists guard_pause_below_naira numeric not null default 50;
alter table public.ad_accounts add column if not exists guard_resume_at_naira numeric not null default 1000;

create table if not exists public.balance_guard_pauses (
  id uuid primary key default gen_random_uuid(),
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  company_id uuid not null,
  balance_at_pause numeric,
  items jsonb not null default '[]',      -- [{level,id,name,p:paused?,r:restored?,e:error?}]
  created_at timestamptz not null default now(),
  restored_at timestamptz
);
create index if not exists balance_guard_open on public.balance_guard_pauses (ad_account_id) where restored_at is null;
alter table public.balance_guard_pauses enable row level security;
drop policy if exists balance_guard_read on public.balance_guard_pauses;
create policy balance_guard_read on public.balance_guard_pauses for select using (company_id = (select company_id from public.profiles where id = auth.uid()));
