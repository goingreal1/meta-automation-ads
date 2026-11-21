-- LESSONS: what the pattern finder concludes from winners and losers. Scope 'company' = only that business's own ads (private to them);
-- scope 'global' = general patterns seen across businesses, stored with no names, links or figures that identify anyone.
create table if not exists public.learn_lessons (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global','company')),
  company_id uuid,
  feature text not null,
  value text not null,
  direction text not null check (direction in ('positive','negative')),
  n int not null, winners int not null,
  rate numeric not null, baseline numeric not null, lift numeric not null, z numeric not null,
  companies int not null default 1,
  confidence text not null,                  -- low | medium | high
  status text not null default 'active',     -- active | weak | retired
  claim text not null,
  how_to text,
  evidence jsonb not null default '{}',
  first_seen timestamptz not null default now(),
  last_checked timestamptz not null default now(),
  confirmed int not null default 0,
  failed int not null default 0
);
create unique index if not exists learn_lessons_key on public.learn_lessons (scope, coalesce(company_id::text, ''), feature, value);
alter table public.learn_lessons enable row level security;
-- A business may read its own lessons and the global ones.
drop policy if exists learn_lessons_read on public.learn_lessons;
create policy learn_lessons_read on public.learn_lessons for select using (scope = 'global' or company_id = (select company_id from public.profiles where id = auth.uid()));
