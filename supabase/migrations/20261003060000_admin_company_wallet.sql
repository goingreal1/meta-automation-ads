-- Corrects the wallet model: a buyer's DVA is a customer-payment
-- collection point only, never a spendable "wallet" of their own. The
-- real spendable pool belongs to the company/admin -- funded either by
-- customer payments (via any buyer's DVA, already flows into the shared
-- Paystack balance) or by the admin directly depositing their own money
-- into the company's own DVA (e.g. seeding ad budget before any sales
-- exist). Admins can also withdraw straight to their own real bank
-- account -- unrestricted, unlike a buyer's Meta-only transfer.

alter table companies add column if not exists paystack_customer_code text unique;
alter table companies add column if not exists dedicated_account_number text;
alter table companies add column if not exists dedicated_account_bank text;

alter table payments add column if not exists source text not null default 'customer_order';
alter table payments drop constraint if exists payments_source_check;
alter table payments add constraint payments_source_check check (source in ('customer_order','admin_topup'));

create table if not exists admin_withdrawals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  amount_naira numeric not null check (amount_naira > 0),
  destination_account_number text,
  destination_bank_code text,
  destination_bank_name text,
  destination_account_name text,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  paystack_transfer_code text,
  paystack_transfer_reference text,
  transfer_error text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists idx_admin_withdrawals_company on admin_withdrawals(company_id);

alter table admin_withdrawals enable row level security;

-- Admin-only in every direction -- buyers never see or touch this table.
create policy admin_withdrawals_admin_all on admin_withdrawals for all
  using (company_id = current_company_id() and current_user_role() in ('owner','admin'))
  with check (company_id = current_company_id() and current_user_role() in ('owner','admin'));
