create table if not exists public.login_challenges (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, session_id)
);
alter table public.login_challenges enable row level security;
-- no policies: only the service role (edge function) reads or writes this table
create or replace function public.login_challenges_cleanup() returns void language sql security definer set search_path = public as $$
  delete from login_challenges where created_at < now() - interval '60 days';
$$;
revoke all on function public.login_challenges_cleanup() from public, anon, authenticated;
