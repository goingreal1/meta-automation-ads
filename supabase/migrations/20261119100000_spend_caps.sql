-- Spend limits: switch a campaign (all its ad sets and ads together) or an ad set off once it has spent this much.
create table if not exists public.spend_caps (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null,
  level text not null check (level in ('campaign','adset')),
  enabled boolean not null default true,
  max_spend_naira numeric not null check (max_spend_naira > 0),
  updated_at timestamptz not null default now(),
  unique (profile_id, level)
);
alter table public.spend_caps enable row level security;
create policy spend_caps_own on public.spend_caps for all
  using (profile_id = auth.uid() or (company_id = current_company_id() and current_user_role() = any (array['owner','admin'])))
  with check (profile_id = auth.uid() or (company_id = current_company_id() and current_user_role() = any (array['owner','admin'])));
