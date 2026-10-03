-- Lets a buyer self-serve moving their OWN approved wallet balance into
-- their OWN Meta/Facebook ad account (to top up ad spend) -- never to an
-- arbitrary account. Two guardrails make that safe to hand to a non-admin:
--   1. The destination bank account is verified once via Paystack's
--      account-resolve API; we only accept it if the resolved account name
--      contains "facebook" or "meta" (paystack-verify-meta-account).
--   2. A transfer can only ever be for the exact amount of a specific
--      fund_requests row an admin already approved -- a buyer can request
--      any amount, but can only move money an admin signed off on.
-- Admin approval still happens first (fund_requests.status = 'approved');
-- this just adds what happens after approval instead of an admin manually
-- wiring the money -- the buyer executes the already-approved transfer.

alter table media_buyers add column if not exists meta_ads_bank_account_number text;
alter table media_buyers add column if not exists meta_ads_bank_code text;
alter table media_buyers add column if not exists meta_ads_bank_name text;
alter table media_buyers add column if not exists meta_ads_account_name text;
alter table media_buyers add column if not exists meta_ads_verified boolean not null default false;
alter table media_buyers add column if not exists meta_ads_recipient_code text;

alter table fund_requests drop constraint if exists fund_requests_status_check;
alter table fund_requests add constraint fund_requests_status_check
  check (status in ('pending','approved','declined','transferred'));

alter table fund_requests add column if not exists paystack_transfer_code text;
alter table fund_requests add column if not exists paystack_transfer_reference text;
alter table fund_requests add column if not exists transfer_error text;
alter table fund_requests add column if not exists transferred_at timestamptz;

-- Deliberately NO buyer-side update policy for the transfer fields. The
-- buyer triggers a transfer by calling the paystack-transfer-to-meta edge
-- function (which runs as service role and does the real Paystack call);
-- the client never gets to write status='transferred' itself, otherwise a
-- buyer could fake a transfer record without any money having moved.
