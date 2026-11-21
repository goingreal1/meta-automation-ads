-- What the creatives and landing pages actually LOOK like: pictures and video frames kept privately, plus an AI description of each.
insert into storage.buckets (id, name, public) values ('learn-media', 'learn-media', false) on conflict (id) do nothing;

create table if not exists public.learn_media (
  media_key text primary key,            -- image:<hash|sha1(url)> or video:<id>
  company_ids uuid[] not null default '{}',
  kind text not null,                    -- image | video
  source_url text,
  paths jsonb,                           -- [{path, t}] stored picture(s); video = frames in time order
  length_s numeric,
  description jsonb,                     -- what the AI saw: text on media, people, product, style, hook, emotion ...
  described_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create table if not exists public.learn_ad_media (
  ad_account_id uuid not null, ad_id text not null, media_key text not null, role text,
  primary key (ad_account_id, ad_id, media_key)
);
alter table public.learn_pages add column if not exists vision jsonb;
alter table public.learn_pages add column if not exists vision_at timestamptz;
alter table public.learn_media enable row level security;
alter table public.learn_ad_media enable row level security;

-- One row per ad: how it was launched, what it looks like, where it sends people, and what happened.
create or replace view public.learn_anatomy as
select a.ad_account_id, a.company_id, a.meta_id as ad_id, a.name as ad_name, a.status as ad_status, a.created_time as ad_created,
       a.creative, a.landing_url,
       c.meta_id as campaign_id, c.name as campaign_name, c.settings as campaign_settings,
       s.meta_id as adset_id, s.name as adset_name, s.settings as adset_settings,
       t.spend, t.impressions, t.link_clicks, t.lpv, t.purchases, t.purchase_value, t.messages,
       (select jsonb_agg(jsonb_build_object('key', m.media_key, 'kind', m.kind, 'seen', m.description)) from public.learn_ad_media am join public.learn_media m on m.media_key = am.media_key where am.ad_account_id = a.ad_account_id and am.ad_id = a.meta_id) as media,
       p.title as page_title, p.word_count as page_words, p.signals as page_signals, p.vision as page_vision, p.shots as page_shots,
       (select jsonb_agg(jsonb_build_object('at', e.event_time, 'type', e.event_type, 'old', e.old_value, 'new', e.new_value) order by e.event_time)
          from public.learn_events e where e.ad_account_id = a.ad_account_id and e.object_id in (a.meta_id, s.meta_id, c.meta_id)) as history
from public.learn_objects a
left join public.learn_objects s on s.ad_account_id = a.ad_account_id and s.level = 'adset' and s.meta_id = a.parent_id
left join public.learn_objects c on c.ad_account_id = a.ad_account_id and c.level = 'campaign' and c.meta_id = a.campaign_id
left join public.learn_insights t on t.ad_account_id = a.ad_account_id and t.level = 'ad' and t.object_id = a.meta_id and t.breakdown = 'total' and t.bucket = 'all' and t.win = (select case when exists (select 1 from public.learn_insights z where z.ad_account_id = a.ad_account_id and z.level='ad' and z.object_id = a.meta_id and z.win='all') then 'all' else '30d' end)
left join public.learn_pages p on p.url_norm = a.landing_url
where a.level = 'ad';
