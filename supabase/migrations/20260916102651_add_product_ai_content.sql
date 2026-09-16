-- Lets the dashboard hold real product knowledge (description, safe benefit
-- framing, safety notes, NAFDAC reg no.) that the WhatsApp AI can reference for
-- any product, not just Beoliv (which has this hardcoded in product.ts).
-- Editable from the Products tab; the bot reads it live, so updating here
-- updates what the AI says without a code deploy.
alter table products add column if not exists description text;
alter table products add column if not exists benefits text;
alter table products add column if not exists safety_notes text;
alter table products add column if not exists nafdac_reg_no text;
