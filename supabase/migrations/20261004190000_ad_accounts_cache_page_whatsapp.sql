-- Cache the Meta-confirmed Page name and its connected WhatsApp number on
-- the ad_accounts row itself, instead of calling Meta live every time the
-- campaign builder opens. Populated once by the Settings "Verify" flow
-- (verify-ad-account-connection), then just read straight from the DB
-- everywhere else -- faster, and doesn't break the builder if Meta's API
-- has a hiccup or the token temporarily can't reach a given endpoint.
alter table ad_accounts add column if not exists fb_page_name text;
alter table ad_accounts add column if not exists whatsapp_number text;
alter table ad_accounts add column if not exists pixel_name text;
alter table ad_accounts add column if not exists connection_verified_at timestamptz;
