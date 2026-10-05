-- The AI sales agent's system prompt lives in the database (editable in Settings), not in code.
create table if not exists ai_settings (key text primary key, value text not null, updated_at timestamptz not null default now());
alter table ai_settings enable row level security;
create policy ai_settings_read on ai_settings for select to authenticated using (true);
create policy ai_settings_write on ai_settings for all to authenticated
  using ((select role from profiles where id = auth.uid()) in ('owner','admin'))
  with check ((select role from profiles where id = auth.uid()) in ('owner','admin'));
alter table ai_sales_agents add column if not exists system_prompt text; -- per-number override; null = recommended prompt
-- default prompt row 'sales_system_prompt' was seeded directly in the database
