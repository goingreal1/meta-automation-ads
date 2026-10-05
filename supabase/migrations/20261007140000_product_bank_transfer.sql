-- Bank-transfer details shown on the order form right after submit; services skip the delivery address.
alter table products
  add column if not exists is_service boolean not null default false,
  add column if not exists bank_name text,
  add column if not exists bank_account_number text,
  add column if not exists bank_account_name text,
  add column if not exists payment_note text;
