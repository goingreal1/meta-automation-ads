-- Campaign plans the assistant builds in chat. Only the person's tap on Approve launches one.
create table if not exists public.ai_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  ad_account_id uuid references public.ad_accounts(id) on delete set null,
  plan jsonb not null,
  status text not null default 'draft' check (status in ('draft','launching','launched','cancelled')),
  result jsonb,
  created_at timestamptz not null default now(),
  launched_at timestamptz
);
create index if not exists ai_plans_company_idx on public.ai_plans (company_id, created_at desc);
alter table public.ai_plans enable row level security;
create policy ai_plans_select on public.ai_plans for select to authenticated
  using (company_id = (select company_id from public.profiles where id = auth.uid()));
