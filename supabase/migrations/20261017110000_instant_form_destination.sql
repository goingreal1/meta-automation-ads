-- Instant (lead) forms: a "form" destination and the form id on the staged ad.
alter table creative_assets drop constraint if exists creative_assets_destination_type_check;
alter table creative_assets add constraint creative_assets_destination_type_check check (destination_type = any (array['website','whatsapp','messenger','instagram','form']));
alter table creative_assets add column if not exists lead_form_id text;
