-- LEARNING STORE: what Revora studies from connected ad accounts and the pages their ads send people to.
-- Service-role only (RLS on, no policies): nothing here is ever shown to users. A company can be excluded with learning_enabled = false.
alter table public.companies add column if not exists learning_enabled boolean not null default true;
alter table public.ad_accounts add column if not exists learn_synced_at timestamptz;

-- One row per campaign / ad set / ad, with every setting Meta exposes and a plain summary of the creative.
create table if not exists public.learn_objects (
  ad_account_id uuid not null,
  company_id uuid not null,
  level text not null check (level in ('campaign','adset','ad')),
  meta_id text not null,
  parent_id text,
  campaign_id text,
  name text,
  status text,
  effective_status text,
  created_time timestamptz,
  settings jsonb not null default '{}',
  creative jsonb,                 -- ads only: kind (image|video|carousel|post|feed), texts, cta, links, cards, flags
  landing_url text,
  synced_at timestamptz not null default now(),
  primary key (ad_account_id, level, meta_id)
);
create index if not exists learn_objects_company on public.learn_objects (company_id, level);

-- Results: totals (breakdown 'total') per ad, and campaign-level breakdowns by hour, age_gender, country, region, placement, device.
create table if not exists public.learn_insights (
  ad_account_id uuid not null,
  company_id uuid not null,
  level text not null,
  object_id text not null,
  breakdown text not null,
  bucket text not null,
  win text not null default '30d',
  spend numeric default 0, impressions numeric default 0, reach numeric default 0, clicks numeric default 0, link_clicks numeric default 0,
  lpv numeric default 0, purchases numeric default 0, purchase_value numeric default 0, messages numeric default 0,
  extra jsonb default '{}',
  synced_at timestamptz not null default now(),
  primary key (ad_account_id, level, object_id, breakdown, bucket, win)
);
create index if not exists learn_insights_company on public.learn_insights (company_id, breakdown);

-- The pages ads send people to: word for word, in order, header by header to the footer.
create table if not exists public.learn_pages (
  url_norm text primary key,
  company_ids uuid[] not null default '{}',
  first_seen timestamptz not null default now(),
  next_fetch_at timestamptz not null default now(),
  fetched_at timestamptz,
  attempts int not null default 0,
  status text not null default 'pending',   -- pending | ok | error | skipped
  http_status int,
  final_url text,
  title text,
  meta_description text,
  js_rendered boolean,
  word_count int,
  content_hash text,
  blocks jsonb,                   -- [{t:'h2', x:'text', f:0|1 (in footer)}] in page order
  text text,
  signals jsonb,                  -- prices, cod, guarantee, urgency, testimonials, form fields, ctas, media, pixel ...
  error text
);
create index if not exists learn_pages_due on public.learn_pages (next_fetch_at) where status in ('pending','ok','error');
alter table public.learn_objects enable row level security;
alter table public.learn_insights enable row level security;
alter table public.learn_pages enable row level security;
