create table if not exists public.ad_library (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  media_buyer_id uuid references public.media_buyers(id) on delete set null,
  ad_account_id uuid references public.ad_accounts(id) on delete set null,
  meta_ad_id text not null,
  name text,
  primary_text text not null,
  headline text,
  description text,
  niche text,
  effective_status text,
  spend numeric,
  results numeric,
  cost_per_result numeric,
  ctr numeric,
  result_kind text,
  share_to_niche boolean not null default false,
  imported_at timestamptz not null default now(),
  unique (company_id, meta_ad_id)
);
create index if not exists ad_library_company_idx on public.ad_library (company_id, cost_per_result);
create index if not exists ad_library_niche_idx on public.ad_library (niche) where share_to_niche;
alter table public.ad_library enable row level security;
create policy ad_library_select on public.ad_library for select to authenticated
  using (company_id = (select company_id from public.profiles where id = auth.uid()));
