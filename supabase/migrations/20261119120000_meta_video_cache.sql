-- A video belongs to one Meta ad account's library. Remember which Meta video id each Revora video has in each ad account,
-- so a video is sent to an account once (ahead of the launch) and reused, and never mixed up between accounts.
create table if not exists public.meta_video_cache (
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  public_url text not null,
  meta_video_id text not null,
  created_at timestamptz not null default now(),
  primary key (ad_account_id, public_url)
);
alter table public.meta_video_cache enable row level security;
