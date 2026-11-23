create table if not exists public.saved_replies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null default auth.uid(),
  title text not null check (char_length(title) between 1 and 60),
  body text not null check (char_length(body) between 1 and 1500),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists saved_replies_user_idx on public.saved_replies (user_id, sort, created_at);
alter table public.saved_replies enable row level security;
-- Private to the person who saved them: not other media buyers, not other companies.
create policy "saved replies: own rows only" on public.saved_replies
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and company_id = (select p.company_id from public.profiles p where p.id = auth.uid()));
