-- ad_accounts.connected_via only allowed 'manual'/'oauth' -- the new
-- Business Manager partner-sharing flow (sync-partner-accounts) inserts
-- rows with connected_via = 'partner', which violated this check constraint
-- on every single import attempt (confirmed via function logs: every
-- "sync" call failed with 23514 ad_accounts_connected_via_check).

alter table ad_accounts drop constraint ad_accounts_connected_via_check;
alter table ad_accounts add constraint ad_accounts_connected_via_check
  check (connected_via = any (array['manual'::text, 'oauth'::text, 'partner'::text]));
