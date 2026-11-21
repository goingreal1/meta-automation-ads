-- Live phone-sized pictures of the landing pages (so the learner can see layout, colours and hooks, not only words).
alter table public.learn_pages add column if not exists shots jsonb;       -- [{path,y,h}] top to bottom, in storage bucket learn-shots
alter table public.learn_pages add column if not exists shot_at timestamptz;
alter table public.learn_pages add column if not exists shot_hash text;
alter table public.learn_pages add column if not exists page_height int;
insert into storage.buckets (id, name, public) values ('learn-shots', 'learn-shots', false) on conflict (id) do nothing;
