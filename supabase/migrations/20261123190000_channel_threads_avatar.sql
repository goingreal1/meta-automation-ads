alter table public.channel_threads add column if not exists avatar_url text, add column if not exists avatar_at timestamptz;
