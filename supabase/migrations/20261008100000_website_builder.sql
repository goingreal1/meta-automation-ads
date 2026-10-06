-- Website builder: sites, pages, tracking snippets (HFCM-style). Orders from site forms go through receive-order -> orders.
create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  status text not null default 'draft' check (status in ('draft','published')),
  product_id uuid references products(id) on delete set null,
  ad_account_id uuid references ad_accounts(id) on delete set null,
  purchase_event text not null default 'submit' check (purchase_event in ('submit','none')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists site_pages (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  company_id uuid not null default current_company_id(),
  slug text not null default '' check (slug ~ '^[a-z0-9-]{0,40}$'),
  title text not null default 'Untitled',
  kind text not null default 'page' check (kind in ('page','thanks')),
  project jsonb,
  html text not null default '',
  css text not null default '',
  seo jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, slug)
);

create table if not exists tracking_snippets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id(),
  name text not null,
  code text not null default '',
  location text not null default 'head' check (location in ('head','body_start','footer')),
  scope text not null default 'all' check (scope in ('all','sites','pages')),
  site_ids uuid[] not null default '{}',
  page_ids uuid[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table orders add column if not exists site_id uuid references sites(id) on delete set null;
alter table orders add column if not exists site_page_id uuid references site_pages(id) on delete set null;

alter table sites enable row level security;
alter table site_pages enable row level security;
alter table tracking_snippets enable row level security;
create policy sites_company on sites for all to authenticated
  using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy site_pages_company on site_pages for all to authenticated
  using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy tracking_snippets_company on tracking_snippets for all to authenticated
  using (company_id = current_company_id()) with check (company_id = current_company_id());

create index if not exists site_pages_site_idx on site_pages(site_id);
create index if not exists orders_site_idx on orders(site_id) where site_id is not null;

-- Public bucket for images uploaded in the builder (first path segment = company id).
insert into storage.buckets (id, name, public, file_size_limit) values ('site-media', 'site-media', true, 10485760)
  on conflict (id) do nothing;
create policy site_media_write on storage.objects for all to authenticated
  using (bucket_id = 'site-media' and (storage.foldername(name))[1] = current_company_id()::text)
  with check (bucket_id = 'site-media' and (storage.foldername(name))[1] = current_company_id()::text);
