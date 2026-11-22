-- learn_notes: short plain-words notes about what was learned, one row per thing per day. Written daily by ai-team (action learn_notes).
-- Simple and stable on purpose: a knowledge base (RAG) ingests it later. See docs/LEARNING_NOTES.md.
create table if not exists public.learn_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  day date not null,                       -- the day the note is about (Lagos date)
  kind text not null check (kind in ('lesson','finding','autopilot_run','failure')),
  title text not null,
  body_md text not null,                   -- plain words, markdown
  source_refs jsonb not null default '{}'::jsonb,   -- ids it was made from, e.g. {"run_id":"..","lesson_ids":[..],"video_ids":[..]}
  created_at timestamptz not null default now()
);
-- one note per (company, day, kind, title): a re-run of the same day replaces the note instead of duplicating it
create unique index if not exists learn_notes_unique on public.learn_notes (company_id, day, kind, title);
create index if not exists learn_notes_company_day on public.learn_notes (company_id, day desc);
alter table public.learn_notes enable row level security;
drop policy if exists learn_notes_read on public.learn_notes;
create policy learn_notes_read on public.learn_notes for select using (
  company_id = current_company_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','admin'))
);
-- writes: service role only (no insert/update/delete policies)

select cron.unschedule(jobid) from cron.job where jobname = 'learn-notes-daily';
select cron.schedule('learn-notes-daily', '20 3 * * *', $$select net.http_post(url:='https://oicqtpjjwmgsiluvkmpu.supabase.co/functions/v1/ai-team', headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='ads_cron_secret')), body:='{"action":"learn_notes"}'::jsonb, timeout_milliseconds:=150000)$$);
