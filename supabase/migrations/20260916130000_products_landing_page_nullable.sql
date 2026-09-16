-- The Products form treats landing page URL as optional (no asterisk, JS sends
-- null when blank) -- needed for WhatsApp-only products with no website at all --
-- but the column was still NOT NULL, so leaving it blank threw a raw Postgres
-- constraint error instead of saving.
alter table products alter column landing_page_url drop not null;
