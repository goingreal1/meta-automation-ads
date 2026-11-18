-- When a launch started, so a launch that was cut off (platform time limit) can be taken over instead of staying "launching" forever.
alter table public.ai_plans add column if not exists launching_at timestamptz;
