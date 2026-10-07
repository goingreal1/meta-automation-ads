-- Custom domains for published sites. A hostname maps to one company and (optionally) a default site
-- served at "/". Every other site of the same company is reachable on that hostname at /s/<slug>.
-- Writes go through the manage-domain edge function (it also registers the hostname with Vercel).
create table if not exists site_domains (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  hostname text not null unique check (hostname = lower(hostname) and hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'),
  site_id uuid references sites(id) on delete set null,
  media_buyer_id uuid references media_buyers(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','active','error')),
  dns jsonb not null default '[]'::jsonb,
  last_error text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  checked_at timestamptz
);
create index if not exists site_domains_company_idx on site_domains(company_id);
alter table site_domains enable row level security;
create policy site_domains_read on site_domains for select to authenticated
  using (company_id = current_company_id() and (current_user_role() = any (array['owner','admin','customer_care']) or media_buyer_id = current_buyer_id()));
revoke insert, update, delete on site_domains from authenticated, anon;
revoke all on site_domains from anon;
