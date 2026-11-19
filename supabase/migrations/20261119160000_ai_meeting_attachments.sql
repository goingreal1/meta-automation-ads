-- A message in a live meeting can carry something the team made: a picture, or a campaign plan.
alter table public.ai_meeting_messages add column if not exists attachment jsonb;
