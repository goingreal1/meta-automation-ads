-- Media-buyer funding requests. A buyer's "wallet balance" is a computed
-- ledger number (confirmed payments total minus approved fund requests),
-- never actual banking access -- buyers and delivery agents can only ever
-- read/confirm, never send or move money. Admins/owners approve or decline;
-- approving is a bookkeeping action here (marks the request as money paid
-- out to the buyer outside the system), not a transfer triggered by us.

create table if not exists fund_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  media_buyer_id uuid not null references media_buyers(id),
  amount_naira numeric not null check (amount_naira > 0),
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  note text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references profiles(id)
);

create index if not exists idx_fund_requests_buyer on fund_requests(media_buyer_id);
create index if not exists idx_fund_requests_company on fund_requests(company_id);

alter table fund_requests enable row level security;

create policy fund_requests_admin_all on fund_requests for all
  using (company_id = current_company_id() and current_user_role() in ('owner','admin'))
  with check (company_id = current_company_id() and current_user_role() in ('owner','admin'));

create policy fund_requests_buyer_read on fund_requests for select
  using (
    company_id = current_company_id()
    and current_user_role() = 'buyer'
    and media_buyer_id = (select p.media_buyer_id from profiles p where p.id = auth.uid())
  );

create policy fund_requests_buyer_insert on fund_requests for insert
  with check (
    company_id = current_company_id()
    and current_user_role() = 'buyer'
    and media_buyer_id = (select p.media_buyer_id from profiles p where p.id = auth.uid())
    and status = 'pending'
  );
