-- The media buyer's ad set design for a proposed launch (ages, interests, one broad set) so the owner can review it before approving.
alter table public.ai_launches add column if not exists ad_sets jsonb;
