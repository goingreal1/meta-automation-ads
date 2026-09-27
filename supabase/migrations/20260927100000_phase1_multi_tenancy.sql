-- ============================================================================
-- Phase 1: Multi-tenancy foundation
-- companies / profiles / company_invites / company_domains / company_settings,
-- company_id added to every business table, RLS rewritten around
-- current_company_id(). See CRM_FULL_ARCHITECTURE_PLAN.md Section 10.
--
-- Backfill assumption (true today, checked against the live project before
-- writing this): every existing row across every table belongs to one real
-- business -- so every table's backfill is simply "assign it to Company 1",
-- no per-row attribution logic needed. That won't be true anymore the moment
-- a second company signs up, which is exactly what this migration exists to
-- make possible.
-- ============================================================================

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  plan text not null default 'trial',
  created_at timestamptz not null default now()
);

create table if not exists company_domains (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  domain text not null unique,
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

-- One row per Supabase Auth user. A user with company_id = null has signed up
-- but not yet created or joined a company -- the dashboard sends them to a
-- "create your company" / "enter your invite code" screen until this is set.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,
  role text not null default 'buyer' check (role in ('owner', 'admin', 'buyer', 'delivery_agent')),
  media_buyer_id uuid references media_buyers(id) on delete set null,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  role text not null default 'buyer' check (role in ('admin', 'buyer', 'delivery_agent')),
  token text not null unique,
  email text,
  created_by uuid references auth.users(id),
  expires_at timestamptz not null default (now() + interval '14 days'),
  used_at timestamptz,
  used_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Per-company secrets (WhatsApp token, ElevenLabs agent, Meta pixel/token
-- overrides). Same pattern as meta_connections: zero RLS policies for
-- "authenticated" at all, so this is unreadable from the dashboard/client no
-- matter what is queried -- only service-role edge functions ever touch it.
-- company_settings_public exposes the handful of non-secret fields.
create table if not exists company_settings (
  company_id uuid primary key references companies(id) on delete cascade,
  business_name text,
  whatsapp_phone_number_id text,
  whatsapp_access_token text,
  meta_pixel_id text,
  meta_access_token text,
  elevenlabs_agent_id text,
  elevenlabs_phone_number_id text,
  elevenlabs_webhook_secret text,
  elevenlabs_api_key text,
  updated_at timestamptz not null default now()
);
alter table company_settings enable row level security;
create or replace view company_settings_public with (security_invoker = false) as
  select company_id, business_name, updated_at from company_settings;
grant select on company_settings_public to authenticated;

alter table companies enable row level security;
alter table company_domains enable row level security;
alter table profiles enable row level security;
alter table company_invites enable row level security;

-- RLS policies alone don't grant access -- Postgres requires the ordinary
-- table GRANT too, or every query hits "permission denied" before RLS is
-- even evaluated. These are brand-new tables, so unlike the existing ones
-- (which already carry a working grant from whenever they were first
-- created) they need it explicitly.
grant select, insert, update, delete on companies, company_domains, profiles, company_invites to authenticated;

-- current_company_id()/current_user_role() are SECURITY DEFINER so they read
-- profiles bypassing its own RLS -- required, or every policy that calls
-- current_company_id() (including profiles' own company-mate policy) would
-- recurse into the RLS it's trying to evaluate.
create or replace function current_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid()
$$;

create or replace function current_user_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function current_media_buyer_id() returns uuid
language sql stable security definer set search_path = public as $$
  select media_buyer_id from profiles where id = auth.uid()
$$;

create or replace function is_company_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select current_user_role() in ('owner', 'admin')
$$;

drop policy if exists "companies_member_select" on companies;
create policy "companies_member_select" on companies for select to authenticated
  using (id = current_company_id());
-- No client insert/update/delete policy at all: creating a company or
-- changing its plan happens only through the complete-signup edge function
-- (service role), never directly from the dashboard.

drop policy if exists "company_domains_member_select" on company_domains;
create policy "company_domains_member_select" on company_domains for select to authenticated
  using (company_id = current_company_id());
drop policy if exists "company_domains_admin_write" on company_domains;
create policy "company_domains_admin_write" on company_domains for all to authenticated
  using (company_id = current_company_id() and is_company_admin())
  with check (company_id = current_company_id() and is_company_admin());

-- profiles: read your own row always; read a company-mate's row once you're
-- in the same company. No client UPDATE policy -- role/company changes are
-- service-role-only (via complete-signup), so a buyer can never grant
-- themselves admin by editing their own row.
drop policy if exists "profiles_self_select" on profiles;
create policy "profiles_self_select" on profiles for select to authenticated
  using (id = auth.uid());
drop policy if exists "profiles_company_select" on profiles;
create policy "profiles_company_select" on profiles for select to authenticated
  using (company_id = current_company_id());

drop policy if exists "company_invites_admin_select" on company_invites;
create policy "company_invites_admin_select" on company_invites for select to authenticated
  using (company_id = current_company_id() and is_company_admin());
drop policy if exists "company_invites_admin_insert" on company_invites;
create policy "company_invites_admin_insert" on company_invites for insert to authenticated
  with check (company_id = current_company_id() and is_company_admin());
drop policy if exists "company_invites_admin_delete" on company_invites;
create policy "company_invites_admin_delete" on company_invites for delete to authenticated
  using (company_id = current_company_id() and is_company_admin());
-- No client UPDATE policy on invites either -- consuming one (setting
-- used_at/used_by) happens only via complete-signup (service role), so a
-- buyer can't mark someone else's invite used or tamper with its role/expiry.


-- ── ad_accounts ──────────────────────────────────────────────────────────────
alter table ad_accounts add column if not exists company_id uuid references companies(id);
create index if not exists ad_accounts_company_idx on ad_accounts(company_id);
drop policy if exists "Users can view their own ad accounts" on ad_accounts;
drop policy if exists "Users can insert their own ad accounts" on ad_accounts;
drop policy if exists "Users can update their own ad accounts" on ad_accounts;
drop policy if exists "Users can delete their own ad accounts" on ad_accounts;
drop policy if exists "ad_accounts_company_all" on ad_accounts;
create policy "ad_accounts_company_all" on ad_accounts for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── ad_set_configs ──────────────────────────────────────────────────────────────
alter table ad_set_configs add column if not exists company_id uuid references companies(id);
create index if not exists ad_set_configs_company_idx on ad_set_configs(company_id);
drop policy if exists "ad_set_configs_all" on ad_set_configs;
drop policy if exists "ad_set_configs_company_all" on ad_set_configs;
create policy "ad_set_configs_company_all" on ad_set_configs for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── ad_sets ──────────────────────────────────────────────────────────────
alter table ad_sets add column if not exists company_id uuid references companies(id);
create index if not exists ad_sets_company_idx on ad_sets(company_id);
drop policy if exists "Manage own account ad_sets" on ad_sets;
drop policy if exists "View own account ad_sets" on ad_sets;
drop policy if exists "ad_sets_company_all" on ad_sets;
create policy "ad_sets_company_all" on ad_sets for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── beoliv_conversations ──────────────────────────────────────────────────────────────
alter table beoliv_conversations add column if not exists company_id uuid references companies(id);
create index if not exists beoliv_conversations_company_idx on beoliv_conversations(company_id);
drop policy if exists "authenticated can read beoliv_conversations" on beoliv_conversations;
drop policy if exists "authenticated can update beoliv_conversations" on beoliv_conversations;
drop policy if exists "beoliv_conversations_company_all" on beoliv_conversations;
create policy "beoliv_conversations_company_all" on beoliv_conversations for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── beoliv_customers ──────────────────────────────────────────────────────────────
alter table beoliv_customers add column if not exists company_id uuid references companies(id);
create index if not exists beoliv_customers_company_idx on beoliv_customers(company_id);
drop policy if exists "authenticated can read beoliv_customers" on beoliv_customers;
drop policy if exists "beoliv_customers_company_all" on beoliv_customers;
create policy "beoliv_customers_company_all" on beoliv_customers for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── beoliv_messages ──────────────────────────────────────────────────────────────
alter table beoliv_messages add column if not exists company_id uuid references companies(id);
create index if not exists beoliv_messages_company_idx on beoliv_messages(company_id);
drop policy if exists "authenticated can read beoliv_messages" on beoliv_messages;
drop policy if exists "beoliv_messages_company_all" on beoliv_messages;
create policy "beoliv_messages_company_all" on beoliv_messages for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── creative_assets ──────────────────────────────────────────────────────────────
alter table creative_assets add column if not exists company_id uuid references companies(id);
create index if not exists creative_assets_company_idx on creative_assets(company_id);
drop policy if exists "Manage own account creative_assets" on creative_assets;
drop policy if exists "View own account creative_assets" on creative_assets;
drop policy if exists "creative_assets_company_all" on creative_assets;
create policy "creative_assets_company_all" on creative_assets for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── daily_metrics ──────────────────────────────────────────────────────────────
alter table daily_metrics add column if not exists company_id uuid references companies(id);
create index if not exists daily_metrics_company_idx on daily_metrics(company_id);
drop policy if exists "Manage own account daily_metrics" on daily_metrics;
drop policy if exists "View own account daily_metrics" on daily_metrics;
drop policy if exists "daily_metrics_company_all" on daily_metrics;
create policy "daily_metrics_company_all" on daily_metrics for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── orders ──────────────────────────────────────────────────────────────
alter table orders add column if not exists company_id uuid references companies(id);
create index if not exists orders_company_idx on orders(company_id);
drop policy if exists "Manage own account orders" on orders;
drop policy if exists "View own account orders" on orders;
drop policy if exists "orders_company_all" on orders;
create policy "orders_company_all" on orders for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── products ──────────────────────────────────────────────────────────────
alter table products add column if not exists company_id uuid references companies(id);
create index if not exists products_company_idx on products(company_id);
drop policy if exists "Manage own account products" on products;
drop policy if exists "View own account products" on products;
drop policy if exists "products_company_all" on products;
create policy "products_company_all" on products for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── targeting_presets ──────────────────────────────────────────────────────────────
alter table targeting_presets add column if not exists company_id uuid references companies(id);
create index if not exists targeting_presets_company_idx on targeting_presets(company_id);
drop policy if exists "Manage own account targeting presets" on targeting_presets;
drop policy if exists "View own account targeting presets" on targeting_presets;
drop policy if exists "targeting_presets_company_all" on targeting_presets;
create policy "targeting_presets_company_all" on targeting_presets for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── website_leads ──────────────────────────────────────────────────────────────
alter table website_leads add column if not exists company_id uuid references companies(id);
create index if not exists website_leads_company_idx on website_leads(company_id);
drop policy if exists "authenticated can read website_leads" on website_leads;
drop policy if exists "authenticated can update website_leads" on website_leads;
drop policy if exists "website_leads_company_all" on website_leads;
create policy "website_leads_company_all" on website_leads for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── media_buyers ──────────────────────────────────────────────────────────────
alter table media_buyers add column if not exists company_id uuid references companies(id);
create index if not exists media_buyers_company_idx on media_buyers(company_id);
drop policy if exists "media_buyers_all" on media_buyers;
drop policy if exists "media_buyers_company_all" on media_buyers;
create policy "media_buyers_company_all" on media_buyers for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── ad_set_ads ──────────────────────────────────────────────────────────────
alter table ad_set_ads add column if not exists company_id uuid references companies(id);
create index if not exists ad_set_ads_company_idx on ad_set_ads(company_id);
drop policy if exists "ad_set_ads_company_all" on ad_set_ads;
create policy "ad_set_ads_company_all" on ad_set_ads for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── campaigns ──────────────────────────────────────────────────────────────
alter table campaigns add column if not exists company_id uuid references companies(id);
create index if not exists campaigns_company_idx on campaigns(company_id);
drop policy if exists "campaigns_company_all" on campaigns;
create policy "campaigns_company_all" on campaigns for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── creatives ──────────────────────────────────────────────────────────────
alter table creatives add column if not exists company_id uuid references companies(id);
create index if not exists creatives_company_idx on creatives(company_id);
drop policy if exists "creatives_company_all" on creatives;
create policy "creatives_company_all" on creatives for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── rule_performance ──────────────────────────────────────────────────────────────
alter table rule_performance add column if not exists company_id uuid references companies(id);
create index if not exists rule_performance_company_idx on rule_performance(company_id);
drop policy if exists "rule_performance_company_all" on rule_performance;
create policy "rule_performance_company_all" on rule_performance for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── pending_approvals ──────────────────────────────────────────────────────────────
alter table pending_approvals add column if not exists company_id uuid references companies(id);
create index if not exists pending_approvals_company_idx on pending_approvals(company_id);
drop policy if exists "pending_approvals_company_all" on pending_approvals;
create policy "pending_approvals_company_all" on pending_approvals for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── personal_earnings ──────────────────────────────────────────────────────────────
alter table personal_earnings add column if not exists company_id uuid references companies(id);
create index if not exists personal_earnings_company_idx on personal_earnings(company_id);
drop policy if exists "personal_earnings_company_all" on personal_earnings;
create policy "personal_earnings_company_all" on personal_earnings for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── monthly_summary ──────────────────────────────────────────────────────────────
alter table monthly_summary add column if not exists company_id uuid references companies(id);
create index if not exists monthly_summary_company_idx on monthly_summary(company_id);
drop policy if exists "monthly_summary_company_all" on monthly_summary;
create policy "monthly_summary_company_all" on monthly_summary for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── weekly_reports ──────────────────────────────────────────────────────────────
alter table weekly_reports add column if not exists company_id uuid references companies(id);
create index if not exists weekly_reports_company_idx on weekly_reports(company_id);
drop policy if exists "weekly_reports_company_all" on weekly_reports;
create policy "weekly_reports_company_all" on weekly_reports for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── kill_keep_decisions ──────────────────────────────────────────────────────────────
alter table kill_keep_decisions add column if not exists company_id uuid references companies(id);
create index if not exists kill_keep_decisions_company_idx on kill_keep_decisions(company_id);
drop policy if exists "kill_keep_decisions_company_all" on kill_keep_decisions;
create policy "kill_keep_decisions_company_all" on kill_keep_decisions for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── ad_review_watch ──────────────────────────────────────────────────────────────
alter table ad_review_watch add column if not exists company_id uuid references companies(id);
create index if not exists ad_review_watch_company_idx on ad_review_watch(company_id);
drop policy if exists "ad_review_watch_company_all" on ad_review_watch;
create policy "ad_review_watch_company_all" on ad_review_watch for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── first_delivery_watch ──────────────────────────────────────────────────────────────
alter table first_delivery_watch add column if not exists company_id uuid references companies(id);
create index if not exists first_delivery_watch_company_idx on first_delivery_watch(company_id);
drop policy if exists "first_delivery_watch_company_all" on first_delivery_watch;
create policy "first_delivery_watch_company_all" on first_delivery_watch for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── commission_brackets ──────────────────────────────────────────────────────────────
alter table commission_brackets add column if not exists company_id uuid references companies(id);
create index if not exists commission_brackets_company_idx on commission_brackets(company_id);
drop policy if exists "commission_brackets_company_all" on commission_brackets;
create policy "commission_brackets_company_all" on commission_brackets for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── narrow_targeting_presets ──────────────────────────────────────────────────────────────
alter table narrow_targeting_presets add column if not exists company_id uuid references companies(id);
create index if not exists narrow_targeting_presets_company_idx on narrow_targeting_presets(company_id);
drop policy if exists "narrow_targeting_presets_company_all" on narrow_targeting_presets;
create policy "narrow_targeting_presets_company_all" on narrow_targeting_presets for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── targeting_rules ──────────────────────────────────────────────────────────────
alter table targeting_rules add column if not exists company_id uuid references companies(id);
create index if not exists targeting_rules_company_idx on targeting_rules(company_id);
drop policy if exists "targeting_rules_company_all" on targeting_rules;
create policy "targeting_rules_company_all" on targeting_rules for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── system_settings ──────────────────────────────────────────────────────────────
alter table system_settings add column if not exists company_id uuid references companies(id);
create index if not exists system_settings_company_idx on system_settings(company_id);
drop policy if exists "system_settings_company_all" on system_settings;
create policy "system_settings_company_all" on system_settings for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── beoliv_orders ──────────────────────────────────────────────────────────────
alter table beoliv_orders add column if not exists company_id uuid references companies(id);
create index if not exists beoliv_orders_company_idx on beoliv_orders(company_id);
drop policy if exists "beoliv_orders_company_all" on beoliv_orders;
create policy "beoliv_orders_company_all" on beoliv_orders for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── beoliv_order_events ──────────────────────────────────────────────────────────────
alter table beoliv_order_events add column if not exists company_id uuid references companies(id);
create index if not exists beoliv_order_events_company_idx on beoliv_order_events(company_id);
drop policy if exists "beoliv_order_events_company_all" on beoliv_order_events;
create policy "beoliv_order_events_company_all" on beoliv_order_events for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- ── event_logs (column only; stays service-role-locked as before) ──────────
alter table event_logs add column if not exists company_id uuid references companies(id);
create index if not exists event_logs_company_idx on event_logs(company_id);

-- ── leads (column only; stays service-role-locked as before) ──────────
alter table leads add column if not exists company_id uuid references companies(id);
create index if not exists leads_company_idx on leads(company_id);

-- ── webhook_debug_log (column only; stays service-role-locked as before) ──────────
alter table webhook_debug_log add column if not exists company_id uuid references companies(id);
create index if not exists webhook_debug_log_company_idx on webhook_debug_log(company_id);

-- ── campaign_clone_runs (column only; stays service-role-locked as before) ──────────
alter table campaign_clone_runs add column if not exists company_id uuid references companies(id);
create index if not exists campaign_clone_runs_company_idx on campaign_clone_runs(company_id);

-- ── voice_calls ───────────────────────────────────────────────────────────
-- Its existing policy ("voice_calls_via_order") already checks the parent
-- order is visible, and orders are now company-scoped -- so access is
-- already correct with zero policy changes. Just denormalize the column.
alter table voice_calls add column if not exists company_id uuid references companies(id);
create index if not exists voice_calls_company_idx on voice_calls(company_id);


-- ── meta_connections (stays service-role-locked; column only) ───────────
alter table meta_connections add column if not exists company_id uuid references companies(id);
create index if not exists meta_connections_company_idx on meta_connections(company_id);


-- ============================================================================
-- Backfill: fold every existing row into one real company so nothing that's
-- already running breaks. OWNER_USER_ID is the auth.users id that already
-- owns every ad_accounts row today (verified against the live project before
-- writing this) -- it becomes Company 1's owner.
-- ============================================================================
do $$
declare
  v_company_id uuid;
  v_owner_id uuid := '3d7e4211-1c48-454b-8abd-a5593849616a';
begin
  select id into v_company_id from companies where slug = 'company-one';
  if v_company_id is null then
    insert into companies (name, slug) values ('My Company', 'company-one')
      returning id into v_company_id;
  end if;

  insert into profiles (id, company_id, role)
    values (v_owner_id, v_company_id, 'owner')
  on conflict (id) do update set company_id = excluded.company_id, role = 'owner';

  update ad_accounts set company_id = v_company_id where company_id is null;
  update ad_set_configs set company_id = v_company_id where company_id is null;
  update ad_sets set company_id = v_company_id where company_id is null;
  update beoliv_conversations set company_id = v_company_id where company_id is null;
  update beoliv_customers set company_id = v_company_id where company_id is null;
  update beoliv_messages set company_id = v_company_id where company_id is null;
  update creative_assets set company_id = v_company_id where company_id is null;
  update daily_metrics set company_id = v_company_id where company_id is null;
  update orders set company_id = v_company_id where company_id is null;
  update products set company_id = v_company_id where company_id is null;
  update targeting_presets set company_id = v_company_id where company_id is null;
  update website_leads set company_id = v_company_id where company_id is null;
  update media_buyers set company_id = v_company_id where company_id is null;
  update ad_set_ads set company_id = v_company_id where company_id is null;
  update campaigns set company_id = v_company_id where company_id is null;
  update creatives set company_id = v_company_id where company_id is null;
  update rule_performance set company_id = v_company_id where company_id is null;
  update pending_approvals set company_id = v_company_id where company_id is null;
  update personal_earnings set company_id = v_company_id where company_id is null;
  update monthly_summary set company_id = v_company_id where company_id is null;
  update weekly_reports set company_id = v_company_id where company_id is null;
  update kill_keep_decisions set company_id = v_company_id where company_id is null;
  update ad_review_watch set company_id = v_company_id where company_id is null;
  update first_delivery_watch set company_id = v_company_id where company_id is null;
  update commission_brackets set company_id = v_company_id where company_id is null;
  update narrow_targeting_presets set company_id = v_company_id where company_id is null;
  update targeting_rules set company_id = v_company_id where company_id is null;
  update system_settings set company_id = v_company_id where company_id is null;
  update beoliv_orders set company_id = v_company_id where company_id is null;
  update beoliv_order_events set company_id = v_company_id where company_id is null;
  update event_logs set company_id = v_company_id where company_id is null;
  update leads set company_id = v_company_id where company_id is null;
  update webhook_debug_log set company_id = v_company_id where company_id is null;
  update campaign_clone_runs set company_id = v_company_id where company_id is null;
  update voice_calls set company_id = v_company_id where company_id is null;
  update meta_connections set company_id = v_company_id where company_id is null;

end $$;

-- Deliberately NOT setting company_id to NOT NULL anywhere in this
-- migration. Several tables above are still written by edge functions this
-- phase does not touch yet (ai-auto-launch-tests, auto-launch-tests,
-- sync-meta-structure, handle-whatsapp-reply, and others -- see
-- CRM_FULL_ARCHITECTURE_PLAN.md Phase 1f) that don't know about company_id
-- yet. A NOT NULL constraint would make every insert from those functions
-- start failing the moment this migration applies. Leaving it nullable
-- instead means an unconverted function's row just comes back with
-- company_id = null -- which every policy above already renders invisible
-- to any user, since `null = current_company_id()` is never true -- a safe
-- "hidden until its writer is converted" failure mode instead of a hard
-- crash. Tighten individual columns to NOT NULL once each table's writers
-- are all confirmed converted, not in one blanket pass.


-- ============================================================================
-- Any INSERT from the dashboard client (not an edge function) omits company_id
-- entirely today -- there'd be dozens of call sites across dashboard_new.html
-- to hunt down and none of them are RLS-checked on company_id at insert time,
-- so a missed one fails silently (row saved, invisible to everyone) rather than
-- erroring. A column default closes that off in one place: current_company_id()
-- only ever resolves to something for an authenticated user's own session (it's
-- null under the service role, since auth.uid() is null there), so this only
-- ever fires for client inserts -- an edge function that already passes its own
-- explicit company_id (receive-order, pull-meta-metrics, ...) is unaffected, an
-- explicit value always wins over a column default.
-- ============================================================================
alter table ad_accounts alter column company_id set default current_company_id();
alter table ad_set_configs alter column company_id set default current_company_id();
alter table ad_sets alter column company_id set default current_company_id();
alter table beoliv_conversations alter column company_id set default current_company_id();
alter table beoliv_customers alter column company_id set default current_company_id();
alter table beoliv_messages alter column company_id set default current_company_id();
alter table creative_assets alter column company_id set default current_company_id();
alter table daily_metrics alter column company_id set default current_company_id();
alter table orders alter column company_id set default current_company_id();
alter table products alter column company_id set default current_company_id();
alter table targeting_presets alter column company_id set default current_company_id();
alter table website_leads alter column company_id set default current_company_id();
alter table media_buyers alter column company_id set default current_company_id();
alter table ad_set_ads alter column company_id set default current_company_id();
alter table campaigns alter column company_id set default current_company_id();
alter table creatives alter column company_id set default current_company_id();
alter table rule_performance alter column company_id set default current_company_id();
alter table pending_approvals alter column company_id set default current_company_id();
alter table personal_earnings alter column company_id set default current_company_id();
alter table monthly_summary alter column company_id set default current_company_id();
alter table weekly_reports alter column company_id set default current_company_id();
alter table kill_keep_decisions alter column company_id set default current_company_id();
alter table ad_review_watch alter column company_id set default current_company_id();
alter table first_delivery_watch alter column company_id set default current_company_id();
alter table commission_brackets alter column company_id set default current_company_id();
alter table narrow_targeting_presets alter column company_id set default current_company_id();
alter table targeting_rules alter column company_id set default current_company_id();
alter table system_settings alter column company_id set default current_company_id();
alter table beoliv_orders alter column company_id set default current_company_id();
alter table beoliv_order_events alter column company_id set default current_company_id();
