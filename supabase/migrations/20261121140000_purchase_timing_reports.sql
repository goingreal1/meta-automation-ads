-- What Revora learns about when purchases land, kept every run so the assistant can learn from it later.
create table if not exists public.purchase_timing_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  media_buyer_id uuid,
  period_days int not null,
  report jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists purchase_timing_reports_co on public.purchase_timing_reports (company_id, created_at desc);
alter table public.purchase_timing_reports enable row level security;
drop policy if exists purchase_timing_reports_read on public.purchase_timing_reports;
create policy purchase_timing_reports_read on public.purchase_timing_reports for select using (company_id = (select company_id from public.profiles where id = auth.uid()));
