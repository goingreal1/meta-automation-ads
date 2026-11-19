-- "Month so far" figures carried over from a report kept elsewhere (up to and including as_of); the live reports add the days after it.
create table if not exists public.report_baselines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  media_buyer_id uuid not null references public.media_buyers(id) on delete cascade,
  month text not null,
  as_of date not null,
  fund_received numeric not null default 0,
  ad_spend numeric not null default 0,
  order_count int not null default 0,
  balance numeric,
  note text,
  created_at timestamptz not null default now(),
  unique (media_buyer_id, month)
);
alter table public.report_baselines enable row level security;
create policy report_baselines_read on public.report_baselines for select using (company_id = current_company_id() and (current_user_role() = any (array['owner','admin']) or media_buyer_id = (select media_buyer_id from public.profiles where id = auth.uid())));
