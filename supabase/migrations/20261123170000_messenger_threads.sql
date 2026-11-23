create table if not exists public.channel_threads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  channel text not null default 'messenger' check (channel in ('messenger','instagram')),
  page_id text not null,
  ext_id text not null,
  name text,
  fb_thread_id text,
  source text,
  last_message_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  unread_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (page_id, ext_id, channel)
);
create index if not exists channel_threads_company_time on public.channel_threads (company_id, last_message_at desc);
create table if not exists public.channel_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.channel_threads(id) on delete cascade,
  company_id uuid not null,
  direction text not null check (direction in ('inbound','outbound')),
  content text,
  ext_message_id text unique,
  created_at timestamptz not null default now(),
  status text,
  attachments jsonb
);
create index if not exists channel_messages_thread_time on public.channel_messages (thread_id, created_at);
alter table public.channel_threads enable row level security;
alter table public.channel_messages enable row level security;
-- Same rule as page_comments: owners and admins see their company's; a media buyer only sees chats on the Pages of their own ad accounts.
create policy channel_threads_select on public.channel_threads for select using (
  company_id = current_company_id() and exists (
    select 1 from public.profiles p where p.id = auth.uid() and (
      p.role in ('owner','admin')
      or (p.role = 'buyer' and exists (select 1 from public.ad_accounts a where a.company_id = channel_threads.company_id and a.media_buyer_id = p.media_buyer_id and regexp_replace(coalesce(a.fb_page_id,''), '\D', '', 'g') = channel_threads.page_id))
    )
  )
);
create policy channel_messages_select on public.channel_messages for select using (
  exists (select 1 from public.channel_threads t where t.id = channel_messages.thread_id)
);
alter table public.page_comments add column if not exists private_thread_id uuid references public.channel_threads(id) on delete set null;
do $$ begin
  begin alter publication supabase_realtime add table public.channel_threads; exception when others then null; end;
  begin alter publication supabase_realtime add table public.channel_messages; exception when others then null; end;
end $$;
select cron.schedule('messenger-sync-2min', '*/2 * * * *', $$select net.http_post(url:='https://oicqtpjjwmgsiluvkmpu.supabase.co/functions/v1/page-tools', headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='ads_cron_secret')), body:='{"action":"messenger_sync"}'::jsonb, timeout_milliseconds:=110000)$$);
