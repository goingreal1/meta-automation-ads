-- A person opts in to receiving their 12pm / 4pm / 8pm report on WhatsApp (their whatsapp_number on the profile).
alter table public.profiles add column if not exists whatsapp_reports boolean not null default false;
