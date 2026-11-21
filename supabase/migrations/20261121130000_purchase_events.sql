-- A permanent timestamped log of purchases as Revora first sees them (within about 5 minutes of Meta reporting them), so we can study time of day.
create table if not exists public.meta_purchase_events (
  id bigserial primary key,
  ad_account_id uuid not null,
  company_id uuid,
  ad_id text not null,
  day date not null,
  added int not null,
  total_today int not null,
  spend_today numeric,
  seen_at timestamptz not null default now()
);
create index if not exists meta_purchase_events_acct_time on public.meta_purchase_events (ad_account_id, seen_at desc);
alter table public.meta_purchase_events enable row level security;
drop policy if exists meta_purchase_events_read on public.meta_purchase_events;
create policy meta_purchase_events_read on public.meta_purchase_events for select using (company_id = (select company_id from public.profiles where id = auth.uid()));
