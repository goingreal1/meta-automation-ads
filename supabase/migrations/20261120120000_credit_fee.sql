-- Lower deposit minimum, and a separate (smaller) fee for money an admin credits to a buyer (admin credits and approved requests): it never touches Paystack.
alter table public.platform_fees drop constraint if exists platform_fees_kind_check;
alter table public.platform_fees add constraint platform_fees_kind_check check (kind in ('deposit', 'transfer', 'wallet', 'credit'));
alter table public.fee_ledger drop constraint if exists fee_ledger_kind_check;
alter table public.fee_ledger add constraint fee_ledger_kind_check check (kind in ('deposit', 'transfer', 'wallet', 'credit'));
update public.platform_fees set min_naira = 50, updated_at = now() where kind = 'deposit';
insert into public.platform_fees (kind, pct, flat_naira, min_naira, cap_naira) values ('credit', 0.5, 0, 20, 500) on conflict (kind) do nothing;
