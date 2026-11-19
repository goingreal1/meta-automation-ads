-- Remembers how many purchases each ad had on Meta today, so a notification is sent for every new purchase (and only once).
create table if not exists public.meta_purchase_seen (
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  ad_id text not null,
  day date not null,
  purchases int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (ad_account_id, ad_id, day)
);
alter table public.meta_purchase_seen enable row level security;
