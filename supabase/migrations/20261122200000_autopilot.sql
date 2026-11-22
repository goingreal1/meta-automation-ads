-- Autopilot media buyer: one run takes a product from research to a launch the owner approves. Also: a business has a country and a currency.
alter table public.companies add column if not exists currency text;
update public.companies set currency = coalesce(currency, case country when 'KE' then 'KES' when 'GH' then 'GHS' when 'ZA' then 'ZAR' when 'US' then 'USD' when 'GB' then 'GBP' when 'UG' then 'UGX' when 'TZ' then 'TZS' else 'NGN' end);

alter table public.ai_launches add column if not exists end_at timestamptz;
alter table public.ai_launches add column if not exists currency text;

create table if not exists public.autopilot_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null,
  ad_account_id uuid,
  created_by uuid,
  market_countries text[] not null default '{}',
  billing_currency text,          -- what the ad account is billed in (Meta decides)
  market_currency text,           -- what the shoppers in the market pay in (display only)
  daily_budget numeric not null default 0,   -- in billing_currency
  total_budget numeric not null default 0,   -- hard stop, in billing_currency
  launch_mode text not null default 'ask' check (launch_mode in ('ask','alone')),
  status text not null default 'running' check (status in ('running','waiting','live','done','failed','cancelled')),
  step text,
  steps jsonb not null default '[]'::jsonb,   -- [{key,label,state:'wait'|'now'|'done'|'needs_you'|'failed',note,at}]
  research jsonb,
  page jsonb,
  meeting_id uuid,
  launch_id uuid,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists autopilot_runs_company on public.autopilot_runs (company_id, created_at desc);
create index if not exists autopilot_runs_active on public.autopilot_runs (status) where status in ('running','waiting');
alter table public.autopilot_runs enable row level security;
drop policy if exists autopilot_runs_select on public.autopilot_runs;
create policy autopilot_runs_select on public.autopilot_runs for select using (
  company_id = current_company_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','admin'))
);
