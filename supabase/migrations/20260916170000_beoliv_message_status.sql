-- Delivery status tracking for the WhatsApp bot's Conversations view (sent/
-- delivered/read/failed ticks, matching real WhatsApp UI). wa_message_id is
-- Meta's own id for the message, the only key its status webhook callbacks
-- carry to correlate back to our row.
alter table beoliv_messages add column if not exists wa_message_id text;
alter table beoliv_messages add column if not exists status text;
create index if not exists beoliv_messages_wa_message_id_idx on beoliv_messages(wa_message_id) where wa_message_id is not null;
