-- Delivery/read ticks in the Conversations tab. The status webhook looks
-- messages up by wa_message_id and the dashboard listens for UPDATEs.
alter table messages add column if not exists wa_message_id text;
alter table messages add column if not exists status text;
create index if not exists messages_wa_message_id_idx on messages(wa_message_id) where wa_message_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;
