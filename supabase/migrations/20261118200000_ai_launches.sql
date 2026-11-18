-- Phase 3 of the AI team: the media buyer turns the meeting's launch plan into real campaigns, scheduled on Meta to start at 12AM Lagos.
-- A person approves each one first (unless a later phase switches auto-launch on). Each launch uses the product's own ad account,
-- so it runs under whichever media buyer that account is assigned to, within the team's daily spend cap and the company's kill switches.
create table if not exists ai_launches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  meeting_id uuid references ai_meetings(id) on delete set null,
  product_id uuid,
  product_name text not null,
  ad_account_id uuid,
  account_name text,
  media_buyer_id uuid,
  buyer_name text,
  creative_ids uuid[] not null default '{}',
  daily_budget_naira numeric not null default 0,
  destination text,
  landing_url text,
  copies jsonb not null default '[]'::jsonb,
  kill_rule text,
  start_at timestamptz,
  status text not null default 'proposed' check (status in ('proposed', 'scheduled', 'failed', 'cancelled', 'skipped')),
  plan_id text,
  note text,                                  -- why it was skipped / what went wrong / the result in plain words
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_launches_idx on ai_launches (company_id, created_at desc);
alter table ai_launches enable row level security;
drop policy if exists ai_launches_select on ai_launches;
create policy ai_launches_select on ai_launches for select to authenticated using (company_id = current_company_id());
