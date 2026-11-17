-- Captured from the live production database (project rrkhkhgdxhmogxxtbvyt) on 2026-11-17. Apply in file order on a NEW Supabase project.
-- (skipped: _ddl_probe and site_pixel_fix_backup_20261021, throw-away tables)
create table if not exists public.ad_accounts (
  id uuid default gen_random_uuid() not null,
  meta_ad_account_id text not null,
  nickname text,
  daily_budget_cap_naira numeric default 27259.99 not null,
  status text default 'active'::text not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  meta_pixel_id text,
  user_id uuid,
  fb_page_id text,
  name text,
  balance_naira numeric,
  balance_updated_at timestamp with time zone,
  ig_user_id text,
  meta_connection_id uuid,
  connected_via text default 'manual'::text not null,
  company_id uuid default current_company_id(),
  media_buyer_id uuid,
  low_balance_threshold_naira numeric default 5000 not null,
  last_low_balance_alert_at timestamp with time zone,
  fb_page_name text,
  whatsapp_number text,
  pixel_name text,
  connection_verified_at timestamp with time zone,
  billing_mode text default 'own'::text not null,
  markup_pct numeric default 0 not null,
  sellable_id uuid,
  currency text
);

create table if not exists public.ad_kill_log (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  ad_account_id uuid not null,
  level text not null,
  meta_object_id text not null,
  object_name text,
  action text not null,
  source text not null,
  actor_profile_id uuid,
  reason text,
  metrics jsonb,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.ad_library (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  media_buyer_id uuid,
  ad_account_id uuid,
  meta_ad_id text not null,
  name text,
  primary_text text not null,
  headline text,
  description text,
  niche text,
  effective_status text,
  spend numeric,
  results numeric,
  cost_per_result numeric,
  ctr numeric,
  result_kind text,
  share_to_niche boolean default false not null,
  imported_at timestamp with time zone default now() not null,
  source text default 'meta_import'::text not null,
  product_id uuid,
  product_name text
);

create table if not exists public.ad_review_watch (
  id uuid default gen_random_uuid() not null,
  meta_ad_id text not null,
  adset_name text,
  last_status text,
  resolved boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  company_id uuid default current_company_id()
);

create table if not exists public.ad_set_ads (
  id uuid default gen_random_uuid() not null,
  ad_set_id uuid,
  creative_id uuid,
  meta_ad_id text,
  created_at timestamp with time zone default now(),
  company_id uuid default current_company_id()
);

create table if not exists public.ad_set_configs (
  id uuid default gen_random_uuid() not null,
  creative_id uuid not null,
  label text not null,
  budget_naira numeric default 5000 not null,
  age_min integer default 25 not null,
  age_max integer default 65 not null,
  gender text default 'all'::text not null,
  geo_type text default 'nationwide'::text not null,
  states text[],
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  company_id uuid default current_company_id(),
  optimization_goal text,
  bid_strategy text,
  bid_amount_naira numeric,
  billing_event text,
  device_platforms text[],
  placement_preset text,
  advantage_audience boolean default true not null,
  display_name text,
  cities jsonb,
  interests jsonb,
  behaviors jsonb,
  audience_presets text[],
  placements text[],
  countries text[],
  country text
);

create table if not exists public.ad_sets (
  id uuid default gen_random_uuid() not null,
  meta_adset_id text,
  campaign_id uuid,
  creative_id uuid,
  adset_name text not null,
  targeting_type text,
  budget_naira numeric,
  status text default 'active'::text not null,
  created_at timestamp with time zone default now() not null,
  meta_launched_at timestamp with time zone,
  age_min integer,
  age_max integer,
  genders text[],
  states text[],
  countries text[],
  interests jsonb,
  optimization_goal text,
  bid_strategy text,
  meta_raw jsonb,
  parent_adset_id uuid,
  created_from text default 'manual'::text,
  ad_account_id uuid,
  media_buyer_id uuid,
  company_id uuid default current_company_id()
);

create table if not exists public.admin_withdrawals (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  amount_naira numeric not null,
  destination_account_number text,
  destination_bank_code text,
  destination_bank_name text,
  destination_account_name text,
  status text default 'pending'::text not null,
  paystack_transfer_code text,
  paystack_transfer_reference text,
  transfer_error text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  sent_at timestamp with time zone
);

create table if not exists public.ai_builder_usage (
  company_id uuid not null,
  day date default CURRENT_DATE not null,
  n integer default 0 not null
);

create table if not exists public.ai_inbox (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  profile_id uuid not null,
  ad_account_id uuid,
  kind text not null,
  title text not null,
  body text,
  payload jsonb default '{}'::jsonb not null,
  status text default 'open'::text not null,
  dedupe_key text,
  read_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  resolved_at timestamp with time zone
);

create table if not exists public.ai_plan_options (
  plan_id uuid not null,
  company_id uuid not null,
  start_time timestamp with time zone,
  end_time timestamp with time zone,
  placements text[],
  device_platforms text[],
  advantage_audience boolean,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.ai_plans (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  user_id uuid not null,
  ad_account_id uuid,
  plan jsonb not null,
  status text default 'draft'::text not null,
  result jsonb,
  created_at timestamp with time zone default now() not null,
  launched_at timestamp with time zone
);

create table if not exists public.ai_sales_agents (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  buyer_whatsapp_number_id uuid not null,
  mode text default 'off'::text not null,
  business_name text,
  agent_name text,
  business_type text,
  offer text,
  proof text,
  how_to_buy text,
  faqs text,
  rules text,
  opener text,
  updated_at timestamp with time zone default now() not null,
  updated_by uuid,
  system_prompt text
);

create table if not exists public.ai_settings (
  key text not null,
  value text not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.app_secrets (
  key text not null,
  value text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.applications (
  id uuid default gen_random_uuid() not null,
  ref text default ('APP-'::text || lpad((nextval('application_ref_seq'::regclass))::text, 5, '0'::text)) not null,
  company_id uuid not null,
  product_id uuid not null,
  property_id uuid not null,
  site_id uuid,
  site_page_id uuid,
  applicant_name text not null,
  applicant_email text,
  applicant_phone text,
  desired_move_in date,
  occupants integer,
  answers jsonb default '{}'::jsonb not null,
  payment_method text,
  fee_amount numeric(10,2) default 0 not null,
  currency text default 'USD'::text not null,
  fee_status text default 'unpaid'::text not null,
  review_status text default 'submitted'::text not null,
  payment_note text,
  paid_at timestamp with time zone,
  possible_duplicate boolean default false not null,
  duplicate_of uuid,
  event_id text,
  fbclid text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.assignment_offers (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  order_id uuid not null,
  delivery_agent_id uuid not null,
  outcome text default 'offered'::text not null,
  offered_at timestamp with time zone default now() not null,
  responded_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.beoliv_order_events (
  id uuid default gen_random_uuid() not null,
  order_id uuid,
  event text not null,
  metadata jsonb,
  created_at timestamp with time zone default now() not null,
  company_id uuid default current_company_id()
);

create table if not exists public.beoliv_orders (
  id uuid default gen_random_uuid() not null,
  conversation_id uuid,
  customer_id uuid,
  package_id text not null,
  quantity integer not null,
  amount numeric not null,
  phone text not null,
  name text not null,
  state text,
  city text,
  address text not null,
  status text default 'PENDING_CONFIRMATION'::text not null,
  ad_id text,
  reported_to_meta_automation boolean default false not null,
  created_at timestamp with time zone default now() not null,
  company_id uuid default current_company_id()
);

create table if not exists public.billing_payments (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  reference text not null,
  plan text not null,
  months integer not null,
  amount_naira numeric not null,
  status text default 'success'::text not null,
  paid_at timestamp with time zone default now() not null,
  raw_event jsonb
);

create table if not exists public.buyer_whatsapp_numbers (
  id uuid default gen_random_uuid() not null,
  company_id uuid default current_company_id() not null,
  media_buyer_id uuid not null,
  waba_id text not null,
  phone_number_id text not null,
  display_phone_number text,
  nickname text,
  access_token text,
  verified_at timestamp with time zone,
  status text default 'active'::text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.campaign_clone_runs (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  mode text not null,
  payload jsonb not null,
  company_id uuid
);

create table if not exists public.campaign_drafts (
  id uuid default gen_random_uuid() not null,
  company_id uuid default current_company_id() not null,
  profile_id uuid default auth.uid() not null,
  ad_account_id uuid,
  name text,
  state jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.campaigns (
  id uuid default gen_random_uuid() not null,
  meta_campaign_id text,
  campaign_name text not null,
  campaign_type text not null,
  objective text default 'conversions'::text,
  daily_budget_naira numeric,
  status text default 'active'::text not null,
  launched_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  ad_account_id uuid,
  objective_raw text,
  lifetime_budget_naira numeric,
  meta_raw jsonb,
  company_id uuid default current_company_id()
);

create table if not exists public.commission_brackets (
  id integer not null,
  min_delivery_rate_pct numeric not null,
  commission_per_order_naira numeric not null,
  company_id uuid default current_company_id()
);

create table if not exists public.companies (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  plan text default 'trial'::text not null,
  created_at timestamp with time zone default now() not null,
  paystack_customer_code text,
  dedicated_account_number text,
  dedicated_account_bank text,
  account_type text default 'company'::text not null,
  business_types text[] default '{}'::text[] not null,
  sales_channels text[] default '{}'::text[] not null,
  fulfilment text,
  description text,
  team_size text,
  buyers_count integer,
  monthly_ad_spend text,
  copy_language text default 'pidgin_mix'::text not null,
  country text default 'NG'::text not null,
  goals text[] default '{}'::text[] not null,
  onboarding_completed_at timestamp with time zone,
  team_roles text[] default '{}'::text[] not null,
  trial_ends_at timestamp with time zone default (now() + '7 days'::interval),
  plan_expires_at timestamp with time zone,
  customer_whatsapp_enabled boolean default false not null,
  pickup_name text,
  pickup_phone text,
  pickup_email text,
  pickup_address text,
  shipbubble_sender_address_code bigint
);

create table if not exists public.company_domains (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  domain text not null,
  is_primary boolean default false not null,
  verified_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.company_invites (
  id uuid default gen_random_uuid() not null,
  company_id uuid default current_company_id() not null,
  role text default 'buyer'::text not null,
  token text not null,
  email text,
  created_by uuid,
  expires_at timestamp with time zone default (now() + '14 days'::interval) not null,
  used_at timestamp with time zone,
  used_by uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.company_settings (
  company_id uuid not null,
  business_name text,
  whatsapp_phone_number_id text,
  whatsapp_access_token text,
  meta_pixel_id text,
  meta_access_token text,
  elevenlabs_agent_id text,
  elevenlabs_phone_number_id text,
  elevenlabs_webhook_secret text,
  elevenlabs_api_key text,
  updated_at timestamp with time zone default now() not null,
  meta_business_id text,
  meta_sync_connection_id uuid
);

create table if not exists public.conversation_customers (
  id uuid default gen_random_uuid() not null,
  phone text not null,
  name text,
  state text,
  city text,
  address text,
  created_at timestamp with time zone default now() not null,
  company_id uuid default current_company_id()
);

create table if not exists public.conversations (
  id uuid default gen_random_uuid() not null,
  phone text not null,
  customer_id uuid,
  current_state text default 'NEW'::text not null,
  data jsonb default '{}'::jsonb not null,
  source text default 'meta_click_to_whatsapp'::text,
  ad_id text,
  ctwa_clid text,
  started_at timestamp with time zone default now() not null,
  last_message_at timestamp with time zone default now() not null,
  human_handling boolean default false not null,
  whatsapp_name text,
  unread_count integer default 0 not null,
  company_id uuid default current_company_id(),
  buyer_whatsapp_number_id uuid,
  media_buyer_id uuid
);

create table if not exists public.countries (
  code text not null,
  name text not null,
  sort_order integer default 100 not null,
  is_active boolean default true not null
);

create table if not exists public.creative_assets (
  id uuid default gen_random_uuid() not null,
  file_name text not null,
  storage_path text not null,
  public_url text not null,
  asset_type text not null,
  mechanism text,
  format text,
  test_status text default 'untested'::text not null,
  linked_creative_id uuid,
  uploaded_at timestamp with time zone default now() not null,
  tested_at timestamp with time zone,
  primary_text text,
  headline text,
  description text,
  cta_type text default 'SHOP_NOW'::text,
  uploaded_by text,
  product_id uuid,
  ad_account_id uuid,
  meta_video_id text,
  meta_image_hash text,
  selected_preset_ids uuid[],
  scheduled_for timestamp with time zone,
  campaign_end_date timestamp with time zone,
  launch_at timestamp with time zone,
  budget_type text default 'abo'::text not null,
  campaign_name text,
  launch_batch_id uuid,
  company_id uuid default current_company_id(),
  campaign_objective text default 'OUTCOME_SALES'::text not null,
  destination_type text,
  whatsapp_number text,
  landing_page_url text,
  ad_name text,
  whatsapp_greeting text,
  whatsapp_prefill text,
  ad_set_sort_order integer,
  launch_paused boolean default false not null,
  lead_form_id text,
  storage_provider text default 'supabase'::text not null,
  special_ad_category text
);

create table if not exists public.creatives (
  id uuid default gen_random_uuid() not null,
  creative_name text not null,
  format text,
  mechanism text,
  awareness_stage text,
  hook text,
  video_url text,
  status text default 'testing'::text not null,
  post_id text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  primary_text text,
  headline text,
  description text,
  image_url text,
  video_id text,
  destination_link text,
  cta_type text,
  meta_ad_id text,
  meta_raw jsonb,
  company_id uuid default current_company_id(),
  launch_batch_id uuid
);

create table if not exists public.daily_metrics (
  id uuid default gen_random_uuid() not null,
  ad_set_id uuid,
  metric_date date not null,
  spend_naira numeric default 0 not null,
  impressions integer default 0 not null,
  reach integer default 0 not null,
  clicks integer default 0 not null,
  ctr numeric,
  cpc_naira numeric,
  cpm_naira numeric,
  frequency numeric,
  orders integer default 0 not null,
  cost_per_order_naira numeric,
  created_at timestamp with time zone default now() not null,
  cost_per_delivered_order_naira numeric,
  ad_account_id uuid,
  landing_page_views integer default 0,
  company_id uuid default current_company_id(),
  ad_set_ad_id uuid,
  conversations integer default 0 not null,
  purchases integer default 0 not null,
  link_clicks integer default 0 not null,
  raw_spend_naira numeric
);

create table if not exists public.delivery_agents (
  id uuid default gen_random_uuid() not null,
  name text not null,
  phone text,
  zone text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  company_id uuid default current_company_id(),
  state text,
  city text
);

create table if not exists public.edit_links (
  id uuid default gen_random_uuid() not null,
  secret_hash text not null,
  company_id uuid not null,
  user_id uuid not null,
  site_id uuid not null,
  page_slug text default ''::text not null,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.event_logs (
  id uuid default uuid_generate_v4() not null,
  event_name text not null,
  event_id text not null,
  event_source text default 'server'::text,
  user_data jsonb,
  custom_data jsonb,
  source_url text,
  user_agent text,
  client_ip text,
  fbc text,
  fbp text,
  sent_to_meta boolean default false,
  meta_response jsonb,
  meta_event_id text,
  created_at timestamp with time zone default now(),
  company_id uuid
);

create table if not exists public.first_delivery_watch (
  id uuid default gen_random_uuid() not null,
  meta_adset_id text not null,
  adset_name text,
  resolved boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  company_id uuid default current_company_id()
);

create table if not exists public.fund_requests (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  media_buyer_id uuid not null,
  amount_naira numeric not null,
  status text default 'pending'::text not null,
  note text,
  requested_at timestamp with time zone default now() not null,
  decided_at timestamp with time zone,
  decided_by uuid,
  paystack_transfer_code text,
  paystack_transfer_reference text,
  transfer_error text,
  transferred_at timestamp with time zone,
  destination_account_number text,
  destination_bank_code text,
  destination_bank_name text,
  destination_account_name text,
  req_account_number text,
  req_bank_code text,
  req_bank_name text,
  req_account_name text,
  req_verified_at timestamp with time zone,
  last_verify_error text,
  last_verify_at timestamp with time zone,
  send_attempts integer default 0 not null
);

create table if not exists public.housing_events (
  id bigint default nextval('housing_events_id_seq'::regclass) not null,
  company_id uuid not null,
  product_id uuid,
  property_id uuid,
  application_id uuid,
  site_id uuid,
  event text not null,
  state text,
  meta jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.kill_keep_decisions (
  id uuid default gen_random_uuid() not null,
  ad_set_id uuid,
  decision_time timestamp with time zone default now() not null,
  hours_since_launch numeric,
  ctr_at_decision numeric,
  cost_per_order_at_decision numeric,
  decision text not null,
  reason text,
  created_at timestamp with time zone default now() not null,
  spend_at_decision numeric,
  orders_at_decision integer,
  company_id uuid default current_company_id()
);

create table if not exists public.kill_rules (
  id uuid default gen_random_uuid() not null,
  profile_id uuid not null,
  company_id uuid not null,
  kind text not null,
  enabled boolean default true not null,
  auto_kill boolean default false not null,
  max_cost_per_result numeric not null,
  min_spend numeric default 0 not null,
  min_hours numeric default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.launch_approvals (
  id uuid default gen_random_uuid() not null,
  plan_id uuid not null,
  user_id uuid not null,
  company_id uuid not null,
  secret_hash text,
  expires_at timestamp with time zone not null,
  used_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  wa_secret_hash text,
  wa_status text
);

create table if not exists public.leads (
  id uuid default uuid_generate_v4() not null,
  lead_id text not null,
  full_name text,
  first_name text,
  last_name text,
  email text,
  phone text,
  form_id text,
  form_name text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  raw_fields jsonb default '{}'::jsonb not null,
  status text default 'new'::text not null,
  crm_order_id text,
  order_value numeric(12,2),
  order_currency text default 'NGN'::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  state text,
  city text,
  address text,
  company_id uuid,
  customer_id uuid
);

create table if not exists public.mcp_audit (
  id bigint not null,
  company_id uuid,
  user_id uuid,
  tool text not null,
  args jsonb,
  ok boolean,
  client text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.media_buyers (
  id uuid default gen_random_uuid() not null,
  code text not null,
  name text not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  company_id uuid default current_company_id(),
  meta_partner_business_id text,
  paystack_customer_code text,
  dedicated_account_number text,
  dedicated_account_bank text,
  meta_ads_bank_account_number text,
  meta_ads_bank_code text,
  meta_ads_bank_name text,
  meta_ads_account_name text,
  meta_ads_verified boolean default false not null,
  meta_ads_recipient_code text,
  auto_send_enabled boolean default false not null,
  auto_send_max_naira numeric,
  auto_send_daily_max_naira numeric,
  auto_send_set_by uuid,
  auto_send_set_at timestamp with time zone,
  pin_send_enabled boolean default false not null,
  pin_send_max_naira numeric,
  pin_send_daily_max_naira numeric,
  pin_send_set_by uuid,
  pin_send_set_at timestamp with time zone
);

create table if not exists public.media_upload_requests (
  id uuid default gen_random_uuid() not null,
  secret_hash text not null,
  company_id uuid not null,
  user_id uuid not null,
  product_name text,
  kind text default 'any'::text not null,
  note text,
  status text default 'pending'::text not null,
  files jsonb default '[]'::jsonb not null,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.messages (
  id uuid default gen_random_uuid() not null,
  conversation_id uuid,
  direction text not null,
  message_type text not null,
  content text,
  created_at timestamp with time zone default now() not null,
  metadata jsonb,
  wa_message_id text,
  status text,
  failure_reason text,
  company_id uuid default current_company_id()
);

create table if not exists public.meta_connections (
  id uuid default gen_random_uuid() not null,
  media_buyer_id uuid,
  fb_user_id text not null,
  fb_user_name text,
  access_token text not null,
  token_expires_at timestamp with time zone,
  scopes text,
  status text default 'active'::text not null,
  discovered_ad_accounts jsonb,
  connected_at timestamp with time zone default now() not null,
  last_synced_at timestamp with time zone,
  last_error text,
  company_id uuid default current_company_id()
);

create table if not exists public.monthly_summary (
  id uuid default gen_random_uuid() not null,
  month date not null,
  total_orders integer default 0,
  valid_orders integer default 0,
  delivered_orders integer default 0,
  delivery_rate_pct numeric,
  total_spend_naira numeric default 0,
  avg_cpa_naira numeric,
  valid_order_commission_naira numeric default 0,
  delivered_order_commission_naira numeric default 0,
  base_salary_naira numeric default 150000,
  total_earnings_naira numeric default 0,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  cost_per_delivered_order_naira numeric,
  company_id uuid default current_company_id()
);

create table if not exists public.narrow_targeting_presets (
  id uuid not null,
  preset_name text,
  product_category text,
  rule_v1_id uuid,
  rule_v2_id uuid,
  rule_v3_id uuid,
  notes text,
  created_at timestamp without time zone,
  company_id uuid default current_company_id()
);

create table if not exists public.order_events (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  order_id uuid not null,
  changed_by uuid,
  field_name text not null,
  old_value text,
  new_value text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.order_items (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  company_id uuid default current_company_id(),
  product_id uuid,
  product_name text not null,
  quantity integer default 1 not null,
  unit_price_naira numeric default 0 not null,
  line_total_naira numeric default 0 not null,
  tier_id uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.order_notifications (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  order_id uuid not null,
  event text not null,
  status text default 'sent'::text not null,
  wa_message_id text,
  error text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.orders (
  id uuid default gen_random_uuid() not null,
  ad_set_id uuid,
  creative_id uuid,
  customer_name text,
  customer_phone text,
  customer_address text,
  product_name text,
  quantity integer default 1,
  order_status text default 'pending'::text not null,
  valid_order_commission_naira numeric,
  delivered_order_commission_naira numeric,
  ordered_at timestamp with time zone default now() not null,
  delivered_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null,
  event_id text,
  customer_email text,
  order_value_naira numeric default 19000,
  capi_sent boolean default false,
  customer_city text,
  customer_state text,
  customer_country text default 'NG'::text,
  audience_synced boolean default false,
  audience_synced_at timestamp with time zone,
  ad_account_id uuid,
  currency text default 'NGN'::text,
  payment_method text,
  media_buyer_id uuid,
  fbclid text,
  meta_ad_id text,
  company_id uuid default current_company_id(),
  delivery_agent_id uuid,
  assigned_at timestamp with time zone,
  payment_narration_code text,
  assignment_status text,
  assignment_offered_at timestamp with time zone,
  customer_id uuid,
  possible_duplicate boolean default false not null,
  duplicate_of_order_id uuid,
  followup_attempts integer default 0 not null,
  last_followup_at timestamp with time zone,
  product_id uuid,
  site_id uuid,
  site_page_id uuid,
  form_data jsonb,
  delivery_stage text,
  capi_paid_sent_at timestamp with time zone,
  care_agent_id uuid,
  care_assigned_at timestamp with time zone,
  care_note text,
  care_attempts integer default 0 not null,
  last_care_attempt_at timestamp with time zone,
  shipbubble_order_id text,
  shipbubble_status text,
  shipbubble_courier text,
  shipbubble_tracking_code text,
  shipbubble_tracking_url text,
  shipping_fee_naira numeric,
  shipbubble_error text,
  shipbubble_attempts integer default 0 not null,
  shipbubble_last_attempt_at timestamp with time zone,
  shipbubble_created_at timestamp with time zone,
  shipbubble_mode text,
  cod_amount_naira numeric,
  cod_fee_naira numeric,
  cod_remitted_at timestamp with time zone,
  cod_remitted_amount_naira numeric,
  deposit_amount_naira numeric,
  deposit_status text,
  deposit_reference text,
  deposit_paid_at timestamp with time zone
);

create table if not exists public.payment_match_requests (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  payment_id uuid not null,
  order_id uuid not null,
  media_buyer_id uuid not null,
  status text default 'pending'::text not null,
  note text,
  requested_at timestamp with time zone default now() not null,
  decided_at timestamp with time zone,
  decided_by uuid
);

create table if not exists public.payments (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  order_id uuid,
  media_buyer_id uuid,
  paystack_reference text,
  amount_naira numeric not null,
  status text default 'pending'::text not null,
  channel text,
  paid_at timestamp with time zone,
  raw_event jsonb,
  created_at timestamp with time zone default now() not null,
  source text default 'customer_order'::text not null,
  held_for_buyer_id uuid,
  held_reason text,
  sender_name text,
  sender_bank text,
  sender_account text,
  narration text
);

create table if not exists public.paystack_customers (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  customer_phone text not null,
  paystack_customer_code text not null,
  dedicated_account_number text,
  dedicated_account_bank text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.pending_approvals (
  id uuid default gen_random_uuid() not null,
  approval_type text not null,
  ad_account_id uuid,
  creative_asset_id uuid,
  ad_set_id uuid,
  proposed_action jsonb not null,
  reason text,
  status text default 'pending'::text not null,
  whatsapp_message_id text,
  requested_at timestamp with time zone default now() not null,
  responded_at timestamp with time zone,
  expires_at timestamp with time zone default (now() + '00:30:00'::interval),
  company_id uuid default current_company_id()
);

create table if not exists public.personal_earnings (
  id uuid default gen_random_uuid() not null,
  earning_date date not null,
  source text not null,
  amount_naira numeric not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  company_id uuid default current_company_id()
);

create table if not exists public.plan_edit_links (
  id uuid default gen_random_uuid() not null,
  secret_hash text not null,
  company_id uuid not null,
  user_id uuid not null,
  plan_id uuid not null,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.platform_admins (
  user_id uuid not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.product_images (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  product_id uuid not null,
  media_buyer_id uuid,
  name text not null,
  url text not null,
  storage_path text not null,
  kind text default 'image'::text not null,
  purpose text default 'website'::text not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.product_tiers (
  id uuid default gen_random_uuid() not null,
  product_id uuid not null,
  company_id uuid not null,
  label text not null,
  quantity integer default 1 not null,
  price_naira numeric not null,
  badge text,
  sort_order integer default 0 not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  image_url text,
  features text,
  is_default boolean default false not null
);

create table if not exists public.products (
  id uuid default gen_random_uuid() not null,
  product_name text not null,
  landing_page_url text,
  default_order_value_naira numeric default 19000 not null,
  is_active boolean default true not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  currency text default 'NGN'::text,
  ad_account_id uuid,
  auto_post_enabled boolean default false not null,
  destination_type text default 'website'::text not null,
  whatsapp_number text,
  description text,
  benefits text,
  safety_notes text,
  nafdac_reg_no text,
  product_image_url text,
  warmup_message text,
  order_form_url text,
  company_id uuid default current_company_id(),
  stock_on_hand integer,
  low_stock_threshold integer default 10 not null,
  ad_image_url text,
  ad_primary_text text,
  ad_headline text,
  ad_description text,
  ad_cta_type text default 'SHOP_NOW'::text not null,
  ad_link_target text default 'product'::text not null,
  whatsapp_welcome_message text,
  is_service boolean default false not null,
  bank_name text,
  bank_account_number text,
  bank_account_name text,
  payment_note text,
  created_by uuid default auth.uid(),
  media_buyer_id uuid,
  special_ad_category text default 'NONE'::text not null,
  payment_button_label text,
  payment_details text,
  payment_link_url text,
  product_type text default 'physical'::text not null,
  housing_settings jsonb default '{}'::jsonb not null
);

create table if not exists public.profiles (
  id uuid not null,
  company_id uuid,
  role text default 'buyer'::text not null,
  media_buyer_id uuid,
  display_name text,
  created_at timestamp with time zone default now() not null,
  delivery_agent_id uuid,
  whatsapp_number text
);

create table if not exists public.properties (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  product_id uuid not null,
  title text not null,
  slug text,
  description text,
  state text not null,
  city text,
  address text,
  postal_code text,
  property_type text,
  monthly_rent numeric(12,2) not null,
  currency text default 'USD'::text not null,
  bedrooms numeric(3,1),
  bathrooms numeric(3,1),
  sqft integer,
  images jsonb default '[]'::jsonb not null,
  availability text default 'available'::text not null,
  available_from date,
  application_fee numeric(10,2) default 0 not null,
  fee_disclosure text,
  application_url text,
  pet_policy text,
  parking text,
  amenities jsonb default '[]'::jsonb not null,
  deposit numeric(12,2),
  lease_term text,
  extra jsonb default '{}'::jsonb not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.push_subscriptions (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  company_id uuid default current_company_id(),
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  prefs jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  last_seen_at timestamp with time zone default now() not null
);

create table if not exists public.rule_performance (
  id uuid not null,
  rule_id uuid,
  ad_set_id uuid,
  test_count integer default 1,
  avg_cpa numeric,
  avg_ctr numeric,
  total_spend numeric,
  total_orders integer,
  win_rate numeric,
  last_tested_at timestamp without time zone,
  performance_score numeric,
  company_id uuid default current_company_id()
);

create table if not exists public.sellable_ad_accounts (
  id uuid default gen_random_uuid() not null,
  meta_ad_account_id text not null,
  label text,
  meta_name text,
  currency text,
  status text default 'available'::text not null,
  assigned_company_id uuid,
  assigned_ad_account_id uuid,
  assigned_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.shipbubble_events (
  id uuid default gen_random_uuid() not null,
  event_key text not null,
  event text,
  shipbubble_order_id text,
  order_id uuid,
  status text,
  payload jsonb not null,
  processed boolean default false not null,
  error text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.site_domains (
  id uuid default gen_random_uuid() not null,
  company_id uuid default current_company_id() not null,
  hostname text not null,
  site_id uuid,
  media_buyer_id uuid,
  status text default 'pending'::text not null,
  dns jsonb default '[]'::jsonb not null,
  last_error text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null,
  checked_at timestamp with time zone
);

create table if not exists public.site_file_versions (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  site_id uuid not null,
  path text not null,
  version integer not null,
  content text not null,
  action text default 'write'::text not null,
  saved_by uuid,
  saved_via text,
  saved_at timestamp with time zone default now() not null
);

create table if not exists public.site_files (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  site_id uuid not null,
  path text not null,
  content text default ''::text not null,
  version integer default 1 not null,
  updated_by uuid,
  updated_via text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.site_page_backups (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  site_id uuid not null,
  page_id uuid,
  slug text,
  kind text,
  title text,
  html text,
  css text,
  project jsonb,
  seo jsonb,
  published_at timestamp with time zone,
  reason text default 'convert_to_files'::text not null,
  backed_up_at timestamp with time zone default now() not null
);

create table if not exists public.site_pages (
  id uuid default gen_random_uuid() not null,
  site_id uuid not null,
  company_id uuid default current_company_id() not null,
  slug text default ''::text not null,
  title text default 'Untitled'::text not null,
  kind text default 'page'::text not null,
  project jsonb,
  html text default ''::text not null,
  css text default ''::text not null,
  seo jsonb default '{}'::jsonb not null,
  published_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.sites (
  id uuid default gen_random_uuid() not null,
  company_id uuid default current_company_id() not null,
  name text not null,
  slug text not null,
  status text default 'draft'::text not null,
  product_id uuid,
  ad_account_id uuid,
  purchase_event text default 'submit'::text not null,
  settings jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  media_buyer_id uuid default current_buyer_id()
);

create table if not exists public.social_assets (
  id uuid default gen_random_uuid() not null,
  url text not null,
  kind text default 'image'::text not null,
  theme text,
  note text,
  times_used integer default 0 not null,
  last_used_at timestamp with time zone,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.social_posts (
  id uuid default gen_random_uuid() not null,
  kind text not null,
  media_urls text[] not null,
  caption_ig text,
  caption_fb text,
  platforms text[] default '{facebook,instagram}'::text[] not null,
  status text default 'draft'::text not null,
  scheduled_for timestamp with time zone,
  theme text,
  source text default 'manual'::text not null,
  attempts integer default 0 not null,
  error text,
  posted_at timestamp with time zone,
  fb_post_id text,
  fb_link text,
  ig_media_id text,
  ig_link text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.social_settings (
  id integer default 1 not null,
  page_id text default '711739378700512'::text not null,
  ig_user_id text default '17841480792674356'::text not null,
  auto_approve boolean default false not null,
  paused boolean default false not null,
  post_hour_wat integer default 18 not null,
  jitter_minutes integer default 25 not null,
  days_ahead integer default 3 not null,
  updated_at timestamp with time zone default now() not null,
  wa_edit_post_id uuid,
  wa_edit_at timestamp with time zone
);

create table if not exists public.social_wa_batches (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  phone text not null,
  media_urls text[] default '{}'::text[] not null,
  media_kinds text[] default '{}'::text[] not null,
  audio_url text,
  caption text,
  caption_by text,
  want_reel boolean default false not null,
  status text default 'open'::text not null,
  asked_caption boolean default false not null,
  last_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  post_id uuid
);

create table if not exists public.support_messages (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  sender text not null,
  user_id uuid,
  sender_name text,
  body text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.support_threads (
  company_id uuid not null,
  last_message_at timestamp with time zone default now() not null,
  last_text text,
  unread_staff integer default 0 not null,
  unread_customer integer default 0 not null,
  customer_name text
);

create table if not exists public.support_tickets (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  user_id uuid,
  name text,
  subject text,
  message text not null,
  page text,
  status text default 'open'::text not null,
  reply text,
  replied_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.system_settings (
  id integer default 1 not null,
  company_target_cpa_naira numeric default 2500 not null,
  daily_ad_spend_budget_naira numeric default 200000 not null,
  test_budget_per_creative_naira numeric default 1500 not null,
  min_hours_before_kill numeric default 10 not null,
  monthly_order_target integer default 20000 not null,
  updated_at timestamp with time zone default now() not null,
  company_id uuid default current_company_id()
);

create table if not exists public.targeting_presets (
  id uuid default gen_random_uuid() not null,
  slot_number integer not null,
  preset_name text not null,
  targeting_type text not null,
  countries text[] default ARRAY['NG'::text],
  states text[],
  age_min integer default 18,
  age_max integer default 65,
  genders text[] default ARRAY['all'::text],
  interests text[],
  custom_audience_id text,
  is_active boolean default true not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  ad_account_id uuid,
  publisher_platforms text[],
  facebook_positions text[],
  instagram_positions text[],
  resolved_region_keys jsonb,
  company_id uuid default current_company_id()
);

create table if not exists public.targeting_rules (
  id uuid default gen_random_uuid() not null,
  rule_name text,
  targeting_type text,
  states text[] not null,
  genders integer[] not null,
  age_min integer default 25,
  age_max integer default 60,
  interests jsonb,
  optimization_goal text,
  bid_strategy text,
  budget_naira integer,
  is_active boolean default true,
  created_at timestamp without time zone,
  notes text,
  company_id uuid default current_company_id()
);

create table if not exists public.telnyx_webhook_events (
  id uuid default gen_random_uuid() not null,
  event_type text,
  payload jsonb not null,
  received_at timestamp with time zone default now() not null
);

create table if not exists public.tracking_snippets (
  id uuid default gen_random_uuid() not null,
  company_id uuid default current_company_id() not null,
  name text not null,
  code text default ''::text not null,
  location text default 'head'::text not null,
  scope text default 'all'::text not null,
  site_ids uuid[] default '{}'::uuid[] not null,
  page_ids uuid[] default '{}'::uuid[] not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.transfer_allowed_names (
  id uuid default gen_random_uuid() not null,
  company_id uuid default current_company_id() not null,
  account_name text not null,
  name_key text generated always as (lower(regexp_replace(TRIM(BOTH FROM account_name), '\s+'::text, ' '::text, 'g'::text))) stored,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null
);

create table if not exists public.transfer_approvals (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  company_id uuid not null,
  kind text not null,
  amount_naira numeric not null,
  account_number text not null,
  bank_code text not null,
  bank_name text,
  account_name text,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone default (now() + '00:10:00'::interval) not null,
  approved_at timestamp with time zone,
  used_at timestamp with time zone,
  secret_hash text,
  fund_request_id uuid
);

create table if not exists public.transfer_pins (
  user_id uuid not null,
  pin_hash text not null,
  salt text not null,
  failed_attempts integer default 0 not null,
  locked_until timestamp with time zone,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.transfer_receipts (
  id uuid default gen_random_uuid() not null,
  receipt_no bigint not null,
  company_id uuid not null,
  user_id uuid,
  kind text default 'transfer'::text not null,
  source text default 'dashboard'::text not null,
  amount_naira numeric not null,
  account_name text,
  account_number text,
  bank_name text,
  status text default 'processing'::text not null,
  paystack_transfer_code text,
  paystack_reference text,
  failure_reason text,
  approved_with text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.upload_links (
  id uuid default gen_random_uuid() not null,
  secret_hash text not null,
  company_id uuid not null,
  user_id uuid not null,
  product_id uuid not null,
  purpose text not null,
  max_files integer default 10 not null,
  files_added integer default 0 not null,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.voice_calls (
  id uuid default gen_random_uuid() not null,
  order_id uuid,
  to_number text not null,
  channel text default 'phone'::text not null,
  status text default 'queued'::text not null,
  scheduled_for timestamp with time zone default now() not null,
  elevenlabs_conversation_id text,
  provider_call_sid text,
  error text,
  summary text,
  transcript jsonb,
  duration_secs integer,
  red_flags text[] default '{}'::text[] not null,
  needs_human boolean default false not null,
  human_resolved_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  ended_at timestamp with time zone,
  company_id uuid,
  assigned_to uuid
);

create table if not exists public.wallet_adjustments (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  amount_naira numeric not null,
  reason text not null,
  ref text,
  created_at timestamp with time zone default now() not null,
  media_buyer_id uuid
);

create table if not exists public.wallet_requests (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  media_buyer_id uuid not null,
  amount_naira numeric not null,
  note text,
  status text default 'pending'::text not null,
  requested_at timestamp with time zone default now() not null,
  decided_at timestamp with time zone,
  decided_by uuid
);

create table if not exists public.wallet_topups (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  media_buyer_id uuid,
  amount_naira numeric not null,
  reference text not null,
  status text default 'pending'::text not null,
  channel text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  confirmed_at timestamp with time zone
);

create table if not exists public.webhook_debug_log (
  id uuid default gen_random_uuid() not null,
  payload jsonb,
  content_type text,
  created_at timestamp with time zone default now(),
  company_id uuid
);

create table if not exists public.website_leads (
  id uuid default gen_random_uuid() not null,
  product_name text not null,
  name text not null,
  phone text not null,
  address text not null,
  city text not null,
  state text not null,
  package text not null,
  source_url text,
  status text default 'new'::text not null,
  created_at timestamp with time zone default now() not null,
  company_id uuid default current_company_id(),
  customer_id uuid
);

create table if not exists public.weekly_reports (
  id uuid default gen_random_uuid() not null,
  week_start date not null,
  week_end date not null,
  total_spend_naira numeric default 0,
  total_orders integer default 0,
  valid_orders integer default 0,
  delivered_orders integer default 0,
  delivery_rate_pct numeric,
  avg_cpa_naira numeric,
  avg_cost_per_delivered_order_naira numeric,
  best_creative_id uuid,
  best_creative_note text,
  worst_creative_id uuid,
  worst_creative_note text,
  what_changed text,
  result_summary text,
  created_at timestamp with time zone default now() not null,
  company_id uuid default current_company_id()
);

create table if not exists public.whatsapp_number_requests (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  media_buyer_id uuid,
  requested_by uuid,
  note text,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now() not null
);
