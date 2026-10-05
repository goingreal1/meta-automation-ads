-- The AI's inbox: things the AI noticed on its own (cron) and wants the person to
-- see in the AI chat tab -- kill suggestions to approve, ads it paused for them,
-- campaigns that just went live. Rows are written by edge functions (service
-- role); the recipient can read them and mark them read/done/dismissed.
create table if not exists ai_inbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  profile_id uuid not null references profiles(id) on delete cascade,
  ad_account_id uuid,
  kind text not null check (kind in ('kill_suggestion', 'auto_killed', 'campaign_live', 'info')),
  title text not null,
  body text,
  -- for kill_suggestion: the proposal card, same shape ai-chat returns
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'done', 'dismissed', 'failed')),
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists ai_inbox_dedupe_idx on ai_inbox (profile_id, dedupe_key) where dedupe_key is not null;
create index if not exists ai_inbox_profile_idx on ai_inbox (profile_id, created_at desc);

alter table ai_inbox enable row level security;
drop policy if exists ai_inbox_own_select on ai_inbox;
create policy ai_inbox_own_select on ai_inbox for select to authenticated using (profile_id = auth.uid());
drop policy if exists ai_inbox_own_update on ai_inbox;
create policy ai_inbox_own_update on ai_inbox for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
