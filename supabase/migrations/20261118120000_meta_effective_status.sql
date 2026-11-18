-- Show Meta's own delivery status (Active, In review, Preparing, Not approved, ...) instead of a locally guessed "active".
-- `status` stays Meta's on/off switch; `effective_status` is what Meta says is really happening. A row Meta has not been asked about yet has NULL.
alter table public.campaigns add column if not exists effective_status text, add column if not exists status_checked_at timestamptz;
alter table public.ad_sets add column if not exists effective_status text, add column if not exists status_checked_at timestamptz;
alter table public.ad_set_ads add column if not exists effective_status text, add column if not exists status_checked_at timestamptz, add column if not exists status text;
