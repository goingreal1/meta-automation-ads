-- Automatic replies to Facebook/Instagram comments and Page messages: a keyword or any message triggers the seller's own text, or AI.
create table if not exists public.page_automations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ad_account_id uuid references public.ad_accounts(id) on delete cascade,
  page_id text not null,
  channel text not null default 'facebook' check (channel in ('facebook','instagram')),
  trigger text not null check (trigger in ('comment','message')),
  creative_id uuid references public.creative_assets(id) on delete cascade,   -- comment rules on one creative's posts; null = the whole Page
  keywords text[] not null default '{}',                                       -- empty = any comment / any message
  reply_mode text not null default 'text' check (reply_mode in ('text','ai')),
  public_enabled boolean not null default false,
  public_text text,
  dm_enabled boolean not null default false,
  dm_text text,
  message_text text,                                                           -- the reply for message rules
  when_mode text not null default 'always' check (when_mode in ('first','always')),
  ai_handover boolean not null default true,
  enabled boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists page_automations_page on public.page_automations (page_id, trigger) where enabled;
create index if not exists page_automations_creative on public.page_automations (creative_id) where creative_id is not null;
create table if not exists public.automation_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  automation_id uuid references public.page_automations(id) on delete set null,
  kind text not null check (kind in ('comment_reply','private_reply','message_reply')),
  ext_id text not null,                                                        -- the comment or message that triggered it
  status text not null check (status in ('sent','failed','skipped')),
  detail text,
  created_at timestamptz not null default now(),
  unique (kind, ext_id)
);
-- The Page posts Revora made from a creative, so a rule on the creative knows which posts it covers.
create table if not exists public.creative_posts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  creative_id uuid not null references public.creative_assets(id) on delete cascade,
  page_id text not null,
  post_id text not null unique,
  created_at timestamptz not null default now()
);
alter table public.page_automations enable row level security;
alter table public.automation_log enable row level security;
alter table public.creative_posts enable row level security;
create policy page_automations_all on public.page_automations for all using (
  company_id = current_company_id() and exists (
    select 1 from public.profiles p where p.id = auth.uid() and (
      p.role in ('owner','admin')
      or (p.role = 'buyer' and (ad_account_id is null or exists (select 1 from public.ad_accounts a where a.id = page_automations.ad_account_id and a.media_buyer_id = p.media_buyer_id)))
    )
  )
) with check (
  company_id = current_company_id() and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','admin','buyer')
  )
);
create policy automation_log_select on public.automation_log for select using (company_id = current_company_id());
create policy creative_posts_select on public.creative_posts for select using (company_id = current_company_id());
