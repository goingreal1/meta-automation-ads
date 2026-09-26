-- Meta OAuth: lets each media buyer connect their own Facebook Business
-- Manager (via "Login with Facebook", not by hand-typing an act_ID), so
-- pull-meta-metrics can read their ad accounts using their own token instead
-- of one shared global META_ACCESS_TOKEN.
--
-- meta_connections holds the OAuth token. It is deliberately NOT readable by
-- the dashboard at all -- RLS is enabled with zero policies for
-- "authenticated", so only the service role (used by the two oauth edge
-- functions and pull-meta-metrics) can ever read or write a token. The
-- dashboard reads meta_connections_public instead, a view that simply never
-- selects the token columns -- there is no "safe to show the token" mode.
create table if not exists meta_connections (
  id uuid primary key default gen_random_uuid(),
  media_buyer_id uuid references media_buyers(id) on delete set null,
  fb_user_id text not null,
  fb_user_name text,
  access_token text not null,
  token_expires_at timestamptz,
  scopes text,
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  -- Cached from /me/adaccounts right after connecting -- just {id, account_id,
  -- name, account_status}[], no token -- so the Settings tab can offer
  -- "which of these do you want to add" without another live Graph API call.
  discovered_ad_accounts jsonb,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_error text
);

alter table meta_connections enable row level security;
-- No policies at all for "authenticated" -> every row is invisible to the
-- dashboard's anon/authenticated session. Only service-role callers (which
-- bypass RLS entirely) can touch this table.

create or replace view meta_connections_public
with (security_invoker = false) as
select id, media_buyer_id, fb_user_id, fb_user_name, token_expires_at, scopes,
       status, discovered_ad_accounts, connected_at, last_synced_at, last_error
from meta_connections;

grant select on meta_connections_public to authenticated;

alter table ad_accounts add column if not exists meta_connection_id uuid references meta_connections(id) on delete set null;
alter table ad_accounts add column if not exists connected_via text not null default 'manual' check (connected_via in ('manual', 'oauth'));
create index if not exists ad_accounts_meta_connection_idx on ad_accounts(meta_connection_id);
