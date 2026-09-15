-- Captures what the bot actually sent (buttons shown, image used, flow CTA, list
-- rows) so the dashboard can render it, not just a text summary. And a flag for
-- when a human agent has taken over a conversation, so the bot stops auto-replying.
alter table beoliv_messages add column if not exists metadata jsonb;
alter table beoliv_conversations add column if not exists human_handling boolean not null default false;
