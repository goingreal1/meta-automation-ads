-- When each phone last messaged the global WhatsApp number: inside 24h we can send free-form messages.
create table if not exists public.wa_last_inbound (
  phone text primary key,
  at timestamptz not null default now()
);
alter table public.wa_last_inbound enable row level security;
insert into public.wa_last_inbound(phone, at) values ('2348104611794', '2026-11-19 11:55:10+00') on conflict (phone) do update set at = excluded.at;
