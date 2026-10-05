-- Web Push (PWA) notifications.
--
-- push_subscriptions: one row per browser/phone that turned notifications on.
-- Users can only see and change their own rows (RLS); the send-push edge
-- function uses the service role to read everyone's.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid default current_company_id(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  -- per-category switches, e.g. {"messages": false}. A missing key means ON.
  prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);
create index if not exists push_subscriptions_company_idx on push_subscriptions (company_id);

alter table push_subscriptions enable row level security;
drop policy if exists push_subscriptions_own on push_subscriptions;
create policy push_subscriptions_own on push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Registering a device: the same phone may be handed to a different user (or
-- re-subscribe with the same endpoint), so upsert by endpoint and always point
-- the row at the caller. SECURITY DEFINER because RLS would otherwise stop one
-- user from taking over an endpoint row that still belongs to another.
create or replace function register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into push_subscriptions (user_id, company_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), current_company_id(), p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set user_id = auth.uid(), company_id = current_company_id(),
        p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, last_seen_at = now();
end $$;
revoke all on function register_push_subscription(text, text, text, text) from public, anon;
grant execute on function register_push_subscription(text, text, text, text) to authenticated;

-- Server-side secrets (the VAPID signing key pair for Web Push). RLS is on with
-- NO policies and all client roles are revoked, so only the service role --
-- i.e. edge functions -- can read it. The send-push function generates the key
-- pair itself on first use, so the private key never leaves the server.
create table if not exists app_secrets (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
alter table app_secrets enable row level security;
revoke all on app_secrets from anon, authenticated;
