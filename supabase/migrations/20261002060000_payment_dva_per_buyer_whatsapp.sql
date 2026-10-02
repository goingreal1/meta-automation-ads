-- Pivots Dedicated Virtual Accounts from per-customer to per-media-buyer
-- (one account, every one of that buyer's customers pays into it), and
-- adds the order-level narration code used to match a specific deposit to
-- a specific order for fulfillment. See paystack-create-account,
-- paystack-webhook and send-payment-whatsapp for the full flow.

alter table media_buyers add column if not exists paystack_customer_code text unique;
alter table media_buyers add column if not exists dedicated_account_number text;
alter table media_buyers add column if not exists dedicated_account_bank text;

alter table orders add column if not exists payment_narration_code text unique;
