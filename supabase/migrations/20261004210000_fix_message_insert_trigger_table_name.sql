-- bv_on_message_insert() was updating a table that doesn't exist
-- (beoliv_conversations, a stale name from before this app was renamed from
-- "Beoliv" -- the real table is `conversations`). Every insert into
-- `messages` was silently failing at the trigger (Postgres errors on
-- updating a nonexistent relation), which would have blocked the WhatsApp
-- reply wiring below entirely. Fixed to point at the real table.
create or replace function public.bv_on_message_insert()
returns trigger
language plpgsql
as $function$
begin
  update conversations
  set last_message_at = new.created_at,
      unread_count = case when new.direction = 'inbound' then unread_count + 1 else unread_count end
  where id = new.conversation_id;
  return new;
end;
$function$;
