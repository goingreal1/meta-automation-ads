create table if not exists public.wa_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null,
  title text not null check (char_length(title) between 1 and 60),
  meta_name text not null unique,
  body text not null check (char_length(body) between 1 and 1024),
  category text not null default 'utility' check (category in ('utility','marketing')),
  language text not null default 'en',
  status text not null default 'pending',
  reject_reason text,
  meta_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wa_templates_user_idx on public.wa_templates (user_id, created_at);
alter table public.wa_templates enable row level security;
-- A person only ever sees their own WhatsApp templates. Writes happen in the edge function (service role) after it has checked the caller.
create policy "wa templates: own rows only" on public.wa_templates
  for select to authenticated using (user_id = auth.uid());
