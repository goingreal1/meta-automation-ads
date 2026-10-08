-- Business profile captured at onboarding. Used for billing (team size / buyers / spend),
-- the interface people see (personal vs company, niche, fulfilment) and how the AI writes and launches.
alter table companies
  add column if not exists account_type text not null default 'company' check (account_type in ('company','personal')),
  add column if not exists business_types text[] not null default '{}',
  add column if not exists sales_channels text[] not null default '{}',
  add column if not exists fulfilment text,
  add column if not exists description text,
  add column if not exists team_size text,
  add column if not exists buyers_count integer,
  add column if not exists monthly_ad_spend text,
  add column if not exists copy_language text not null default 'pidgin_mix',
  add column if not exists country text not null default 'NG',
  add column if not exists goals text[] not null default '{}',
  add column if not exists onboarding_completed_at timestamptz;
