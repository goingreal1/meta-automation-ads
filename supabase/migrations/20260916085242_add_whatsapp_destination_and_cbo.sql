-- Per-product destination: 'website' (default, current behavior) or 'whatsapp'
-- (click-to-WhatsApp sales campaign, routing into the Beoliv AI salesperson bot).
alter table products add column if not exists destination_type text not null default 'website';
alter table products add column if not exists whatsapp_number text;

-- Per-launch budget strategy: 'abo' (default, matches every real historical
-- campaign -- budget lives on each ad set) or 'cbo' (budget lives on the
-- campaign, Meta's algorithm splits it across ad sets).
alter table creative_assets add column if not exists budget_type text not null default 'abo';
