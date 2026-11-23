-- Comments on Facebook Pages and on ad posts, kept so the team can read and answer them from the Conversations tab.
create table if not exists public.page_comments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  page_id text not null,
  post_id text not null,
  comment_id text not null unique,
  parent_comment_id text,
  channel text not null default 'facebook' check (channel in ('facebook','instagram')),
  from_id text,
  from_name text,
  message text,
  created_time timestamptz not null,
  ad_id text,
  ad_name text,
  is_page_reply boolean not null default false,
  status text not null default 'new' check (status in ('new','replied','hidden','ignored')),
  reply_text text,
  reply_comment_id text,
  replied_by uuid,
  replied_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists page_comments_company_time on public.page_comments (company_id, created_time desc);
create index if not exists page_comments_open on public.page_comments (company_id, status) where status = 'new' and not is_page_reply;
create index if not exists page_comments_post on public.page_comments (post_id);
create table if not exists public.page_post_scan (
  post_id text primary key,
  page_id text not null,
  company_id uuid,
  ad_id text,
  ad_name text,
  last_scanned_at timestamptz,
  comment_count int not null default 0
);
alter table public.page_comments enable row level security;
alter table public.page_post_scan enable row level security;
drop policy if exists page_comments_select on public.page_comments;
create policy page_comments_select on public.page_comments for select using (
  company_id = current_company_id() and exists (
    select 1 from public.profiles p where p.id = auth.uid() and (
      p.role in ('owner','admin')
      or (p.role = 'buyer' and exists (select 1 from public.ad_accounts a where a.company_id = page_comments.company_id and a.media_buyer_id = p.media_buyer_id and regexp_replace(coalesce(a.fb_page_id,''), '\D', '', 'g') = page_comments.page_id))
    )
  )
);
do $$ begin
  begin alter publication supabase_realtime add table public.page_comments; exception when others then null; end;
end $$;
