-- Learner: first read of an account goes back as far as Meta allows; after that it only reads what is new.
alter table public.ad_accounts add column if not exists learn_backfill_done_at timestamptz;
alter table public.ad_accounts add column if not exists learn_cursor jsonb not null default '{}';
alter table public.ad_accounts add column if not exists learn_breakdowns_at timestamptz;

-- Daily results per campaign and ad set, for the whole history: this is where growth, scaling and decline show.
create table if not exists public.learn_daily (
  ad_account_id uuid not null, company_id uuid not null,
  level text not null, object_id text not null, day date not null,
  spend numeric default 0, impressions numeric default 0, reach numeric default 0, clicks numeric default 0, link_clicks numeric default 0,
  lpv numeric default 0, purchases numeric default 0, purchase_value numeric default 0, messages numeric default 0,
  extra jsonb default '{}', synced_at timestamptz not null default now(),
  primary key (ad_account_id, level, object_id, day)
);
create index if not exists learn_daily_company on public.learn_daily (company_id, day);

-- Meta's Activity History: every change a person (or tool) made: budget raised, paused, duplicated, edited... This is how scaling is seen.
create table if not exists public.learn_events (
  id bigserial primary key,
  ad_account_id uuid not null, company_id uuid not null,
  event_key text not null,
  event_time timestamptz not null,
  event_type text, translated text, object_id text, object_type text, object_name text, actor text,
  old_value jsonb, new_value jsonb, raw jsonb,
  unique (ad_account_id, event_key)
);
create index if not exists learn_events_acct_time on public.learn_events (ad_account_id, event_time desc);
alter table public.learn_daily enable row level security;
alter table public.learn_events enable row level security;
