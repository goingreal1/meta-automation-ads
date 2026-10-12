-- Messenger and Instagram message destinations, and "create paused" (draft) launches.
alter table creative_assets drop constraint if exists creative_assets_destination_type_check;
alter table creative_assets add constraint creative_assets_destination_type_check check (destination_type = any (array['website','whatsapp','messenger','instagram']));
alter table creative_assets add column if not exists launch_paused boolean not null default false;
