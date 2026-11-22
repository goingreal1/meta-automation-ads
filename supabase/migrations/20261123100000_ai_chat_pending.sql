-- Dashboard assistant: changes the AI asks for wait here until the signed-in person taps Confirm.
create table if not exists public.ai_chat_pending (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid not null,
  tool text not null,
  args jsonb not null default '{}'::jsonb,
  summary jsonb,
  status text not null default 'pending' check (status in ('pending','running','done','failed','cancelled','expired')),
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  done_at timestamptz
);
create index if not exists ai_chat_pending_user_idx on public.ai_chat_pending (user_id, created_at desc);
-- Only the edge function (service role) reads or writes this table.
alter table public.ai_chat_pending enable row level security;
