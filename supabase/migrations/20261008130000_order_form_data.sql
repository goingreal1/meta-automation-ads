-- Answers to custom fields built into site order forms (label -> value).
alter table orders add column if not exists form_data jsonb;
