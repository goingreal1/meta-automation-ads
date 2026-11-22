-- Email for notifications: each person can switch each type on or off (Settings > Email). Missing key = default (messages off, the rest on).
alter table public.profiles add column if not exists email_prefs jsonb not null default '{}'::jsonb;

create or replace function public.rv_notify(
  p_company uuid, p_category text, p_kind text, p_title text, p_body text default null,
  p_url text default null, p_severity text default 'info', p_data jsonb default '{}'::jsonb,
  p_dedupe text default null, p_buyer uuid default null, p_user uuid default null, p_push boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_secret text; v_audience jsonb;
begin
  if p_company is null then return null; end if;
  insert into notifications (company_id, user_id, media_buyer_id, category, kind, title, body, url, severity, data, dedupe_key)
  values (p_company, p_user, p_buyer, coalesce(p_category, 'system'), p_kind, left(p_title, 120), left(p_body, 400),
          p_url, coalesce(p_severity, 'info'), coalesce(p_data, '{}'::jsonb), p_dedupe)
  on conflict (company_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  if v_id is null then return null; end if;

  if p_push then
    select value into v_secret from app_secrets where key = 'ads_cron_secret';
    begin
      v_audience := case
        when p_user is not null then jsonb_build_object('company_id', p_company, 'user_ids', jsonb_build_array(p_user))
        when p_buyer is not null then jsonb_build_object('company_id', p_company, 'roles', jsonb_build_array('owner', 'admin'), 'media_buyer_id', p_buyer)
        else jsonb_build_object('company_id', p_company, 'roles', jsonb_build_array('owner', 'admin'))
      end;
      perform net.http_post(
        url := 'https://oicqtpjjwmgsiluvkmpu.supabase.co/functions/v1/handle-whatsapp-reply',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
        body := jsonb_build_object(
          'audience', v_audience,
          'category', p_category,
          'notification', jsonb_build_object('title', p_title, 'body', coalesce(p_body, ''), 'url', coalesce(p_url, '/dashboard_new.html?open=notifications'), 'tag', coalesce(p_dedupe, p_kind))
        ),
        timeout_milliseconds := 15000
      );
    exception when others then null;  -- a push problem must never block the thing that happened
    end;
    -- Email copy (reports have their own email path).
    if coalesce(p_category, 'system') <> 'reports' and p_kind <> 'test_push' then
      begin
        perform net.http_post(
          url := 'https://oicqtpjjwmgsiluvkmpu.supabase.co/functions/v1/send-internal-email',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          body := jsonb_build_object('type', 'notify_email', 'company_id', p_company, 'buyer', p_buyer, 'user', p_user,
                                     'category', coalesce(p_category, 'system'), 'title', p_title, 'body', coalesce(p_body, ''), 'url', coalesce(p_url, '')),
          timeout_milliseconds := 15000
        );
      exception when others then null;
      end;
    end if;
  end if;
  return v_id;
end $$;
revoke all on function public.rv_notify(uuid, text, text, text, text, text, text, jsonb, text, uuid, uuid, boolean) from public, anon, authenticated;
