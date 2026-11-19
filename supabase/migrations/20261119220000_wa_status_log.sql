-- Every delivery receipt Meta sends for our WhatsApp messages (sent / delivered / read / failed, with the failure reason), so a message that never arrives can be explained.
create table if not exists public.wa_status_log (
  id bigserial primary key,
  wa_message_id text,
  recipient text,
  status text,
  error jsonb,
  created_at timestamptz not null default now()
);
create index if not exists wa_status_log_recent on public.wa_status_log (created_at desc);
alter table public.wa_status_log enable row level security;
