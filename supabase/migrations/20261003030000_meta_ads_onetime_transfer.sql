-- Meta's bank-transfer top-up account number is NOT stable -- Ads Manager
-- generates a fresh one-time account number each time you click "Add
-- funds," valid for roughly 30 minutes before it expires. The earlier
-- design (verify once, save forever, reuse for every future transfer) was
-- built on the wrong assumption. This replaces it: there is no saved
-- "verified Meta account" anymore -- every transfer resolves and sends to
-- whatever one-time account number the buyer pastes in at that moment, in
-- the same request, so it's used well inside its validity window.

alter table fund_requests add column if not exists destination_account_number text;
alter table fund_requests add column if not exists destination_bank_code text;
alter table fund_requests add column if not exists destination_bank_name text;
alter table fund_requests add column if not exists destination_account_name text;

-- The old "save once" fields on media_buyers are no longer written to or
-- read by anything -- left in place rather than dropped, since dropping a
-- column is a one-way door and nothing depends on removing it right now.
comment on column media_buyers.meta_ads_verified is 'Deprecated -- Meta top-up accounts are one-time, not reusable. See fund_requests.destination_*.';
