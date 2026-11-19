-- Last seen Meta balance per ad account, so a sudden jump (money sent from Opay/card/anywhere) is logged as funds received.
create table if not exists public.ad_balance_track (
  ad_account_id uuid primary key references public.ad_accounts(id) on delete cascade,
  day date not null,
  balance numeric not null,
  spend_today numeric not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.ad_balance_track enable row level security;
alter table public.fund_logs add column if not exists source text not null default 'manual';
