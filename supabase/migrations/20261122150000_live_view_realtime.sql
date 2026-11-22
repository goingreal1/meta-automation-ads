-- Real-time live view. A viewer who opens a live visit says "I'm watching" (rv_live_watch); while someone watches, the visitor's recorder
-- sends small batches every second and the server also writes them to live_events, which Supabase Realtime pushes to the viewer.
create table if not exists public.live_watch (
  session_id uuid primary key references public.site_sessions(id) on delete cascade,
  until_at timestamptz not null
);
create table if not exists public.live_events (
  id bigserial primary key,
  session_id uuid not null references public.site_sessions(id) on delete cascade,
  seq int not null,
  events jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists live_events_session_id on public.live_events (session_id, id);
alter table public.live_watch enable row level security;
alter table public.live_events enable row level security;
drop policy if exists live_events_read on public.live_events;
create policy live_events_read on public.live_events for select to authenticated
  using (exists (select 1 from public.site_sessions s where s.id = live_events.session_id));
grant select on public.live_events to authenticated;

create or replace function public.rv_live_watch(p_session uuid) returns void
language sql security definer set search_path = public as $$
  insert into live_watch (session_id, until_at)
  select s.id, now() + interval '25 seconds' from site_sessions s
   where s.id = p_session and rv_session_visible(s.company_id, s.meta_ad_id)
  on conflict (session_id) do update set until_at = excluded.until_at;
$$;
revoke all on function public.rv_live_watch(uuid) from public, anon;
grant execute on function public.rv_live_watch(uuid) to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.live_events; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.site_sessions; exception when duplicate_object then null; end;
end $$;

select cron.schedule('live-events-cleanup', '*/10 * * * *', $$delete from public.live_events where created_at < now() - interval '15 minutes'; delete from public.live_watch where until_at < now() - interval '1 hour'$$);
