-- Daily usage counter for the AI site builder (service role only: RLS on, no policies).
create table if not exists public.ai_builder_usage (
  company_id uuid not null,
  day date not null default current_date,
  n integer not null default 0,
  primary key (company_id, day)
);
alter table public.ai_builder_usage enable row level security;
