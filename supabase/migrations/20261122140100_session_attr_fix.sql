create or replace function public.rv_session_attr_fix() returns trigger language plpgsql as $$
begin
  if coalesce(new.meta_ad_id, '') = '' and new.utm_content ~ '^[0-9]{10,}$' and lower(coalesce(new.utm_source, '')) in ('fb', 'facebook', 'ig', 'instagram', 'meta') then
    new.meta_ad_id := new.utm_content;
    if coalesce(new.meta_campaign_id, '') = '' and new.utm_campaign ~ '^[0-9]{10,}$' then new.meta_campaign_id := new.utm_campaign; end if;
    if coalesce(new.meta_adset_id, '') = '' and new.utm_term ~ '^[0-9]{10,}$' then new.meta_adset_id := new.utm_term; end if;
  end if;
  return new;
end $$;
drop trigger if exists rv_session_attr_fix on public.site_sessions;
create trigger rv_session_attr_fix before insert or update on public.site_sessions for each row execute function public.rv_session_attr_fix();
update public.site_sessions set utm_content = utm_content where coalesce(meta_ad_id, '') = '' and utm_content ~ '^[0-9]{10,}$' and lower(coalesce(utm_source, '')) in ('fb', 'facebook', 'ig', 'instagram', 'meta');
-- A visit from an ad we have not synced yet moves that company's ad accounts to the front of the learning sync.
create or replace function public.rv_session_attr_fix() returns trigger language plpgsql as $$
begin
  if coalesce(new.meta_ad_id, '') = '' and new.utm_content ~ '^[0-9]{10,}$' and lower(coalesce(new.utm_source, '')) in ('fb', 'facebook', 'ig', 'instagram', 'meta') then
    new.meta_ad_id := new.utm_content;
    if coalesce(new.meta_campaign_id, '') = '' and new.utm_campaign ~ '^[0-9]{10,}$' then new.meta_campaign_id := new.utm_campaign; end if;
    if coalesce(new.meta_adset_id, '') = '' and new.utm_term ~ '^[0-9]{10,}$' then new.meta_adset_id := new.utm_term; end if;
  end if;
  if coalesce(new.meta_ad_id, '') <> '' and tg_op = 'INSERT'
     and not exists (select 1 from learn_objects a where a.level = 'ad' and a.meta_id = new.meta_ad_id) then
    update ad_accounts set learn_synced_at = null
     where company_id = new.company_id and learn_synced_at is not null and learn_synced_at < now() - interval '30 minutes';
  end if;
  return new;
end $$;
