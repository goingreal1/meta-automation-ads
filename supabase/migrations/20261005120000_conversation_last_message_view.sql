-- Latest message per conversation, for the WhatsApp-style chat list (preview
-- text + delivery ticks). security_invoker makes it obey the same row-level
-- security as `messages` (company / role / media-buyer scoping).
create index if not exists messages_conv_created_idx on messages (conversation_id, created_at desc);

create or replace view conversation_last_message with (security_invoker = true) as
select distinct on (conversation_id)
  conversation_id,
  id as message_id,
  direction,
  message_type,
  coalesce(metadata->>'media_type', message_type) as media_type,
  left(coalesce(content, ''), 200) as content,
  status,
  created_at
from messages
order by conversation_id, created_at desc;

grant select on conversation_last_message to authenticated;
