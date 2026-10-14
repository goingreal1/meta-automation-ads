-- Daily social posting pipeline for Revora's own Facebook Page and Instagram account.
-- Service-role only: RLS is on with no policies, so only edge functions (and the dashboard owner via SQL) can touch it.

create table if not exists public.social_settings (
  id int primary key default 1 check (id = 1),
  page_id text not null default '711739378700512',        -- Facebook Page "Revora"
  ig_user_id text not null default '17841480792674356',   -- Instagram @revora.ads
  auto_approve boolean not null default false,            -- false = a person approves each post first
  paused boolean not null default false,                  -- true = nothing posts
  post_hour_wat int not null default 18,                  -- usual posting hour, Lagos time
  jitter_minutes int not null default 25,                 -- +/- random minutes so it never posts on the dot
  days_ahead int not null default 3,                      -- how many days of drafts the writer keeps ready
  updated_at timestamptz not null default now()
);
insert into public.social_settings (id) values (1) on conflict (id) do nothing;

-- The picture and video bank the writer picks from (a person adds clean images here; the writer writes the captions).
create table if not exists public.social_assets (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  kind text not null default 'image' check (kind in ('image', 'video')),
  theme text,
  note text,                       -- what is in it, so the caption fits
  times_used int not null default 0,
  last_used_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Every post, planned and posted. This is where "what did we post" lives.
create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('image', 'carousel', 'video')),
  media_urls text[] not null,
  caption_ig text,
  caption_fb text,
  platforms text[] not null default '{facebook,instagram}',
  status text not null default 'draft' check (status in ('draft', 'approved', 'posted', 'failed', 'skipped')),
  scheduled_for timestamptz,
  theme text,
  source text not null default 'manual',
  attempts int not null default 0,
  error text,
  posted_at timestamptz,
  fb_post_id text,
  fb_link text,
  ig_media_id text,
  ig_link text,
  created_at timestamptz not null default now()
);
create index if not exists social_posts_due_idx on public.social_posts (status, scheduled_for);

alter table public.social_settings enable row level security;
alter table public.social_assets enable row level security;
alter table public.social_posts enable row level security;

-- Public bucket for the images and videos that get posted (Meta fetches them by link).
insert into storage.buckets (id, name, public, file_size_limit)
values ('social-media', 'social-media', true, 104857600)
on conflict (id) do nothing;
