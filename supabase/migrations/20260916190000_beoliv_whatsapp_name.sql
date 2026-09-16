-- WhatsApp's Cloud API sends the customer's real display name on every inbound
-- message (webhook value.contacts[0].profile.name) -- was never captured or
-- stored anywhere. Distinct from beoliv_customers.name, which only exists
-- after checkout (what they typed into the order form) -- this is available
-- immediately, on the very first message, before any order.
alter table beoliv_conversations add column if not exists whatsapp_name text;
