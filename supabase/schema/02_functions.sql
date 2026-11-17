-- Captured from the live production database (project rrkhkhgdxhmogxxtbvyt) on 2026-11-17. Apply in file order on a NEW Supabase project.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.account_billed_spend(p_account uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(spend_naira), 0) from public.daily_metrics where ad_account_id = p_account and ad_set_ad_id is null;
$function$
;

CREATE OR REPLACE FUNCTION public.account_wallet_balance(p_account uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when public.account_wallet_holder(p_account) is not null
              then public.buyer_wallet_balance(public.account_wallet_holder(p_account))
              else public.company_wallet_balance((select company_id from public.ad_accounts where id = p_account)) end;
$function$
;

CREATE OR REPLACE FUNCTION public.account_wallet_holder(p_account uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.media_buyer_id from public.ad_accounts a
  where a.id = p_account and a.billing_mode = 'managed' and a.media_buyer_id is not null
    and exists (select 1 from public.profiles p where p.media_buyer_id = a.media_buyer_id and p.role = 'buyer');
$function$
;

CREATE OR REPLACE FUNCTION public.ad_sets_assign_media_buyer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if new.media_buyer_id is null then
    new.media_buyer_id := resolve_media_buyer(array[
      new.adset_name,
      (select c.campaign_name from campaigns c where c.id = new.campaign_id)
    ]);
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.ai_app_remove(p_user uuid, p_name text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'auth', 'public'
AS $function$
declare n int := 0; k int;
begin
  delete from auth.sessions s using auth.oauth_clients c
    where s.user_id = p_user and s.oauth_client_id = c.id and (p_name is null or c.client_name = p_name);
  get diagnostics k = row_count; n := n + k;
  update auth.oauth_consents co set revoked_at = now() from auth.oauth_clients c
    where co.client_id = c.id and co.user_id = p_user and co.revoked_at is null and (p_name is null or c.client_name = p_name);
  get diagnostics k = row_count; n := n + k;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.ai_apps_list(p_user uuid)
 RETURNS TABLE(app_name text, logo_uri text, connected_at timestamp with time zone, last_active timestamp with time zone, active_sessions integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'auth', 'public'
AS $function$
  select c.client_name, max(c.logo_uri), min(co.granted_at),
         (select max(greatest(s.updated_at, s.refreshed_at::timestamptz)) from auth.sessions s join auth.oauth_clients c2 on c2.id = s.oauth_client_id where s.user_id = p_user and c2.client_name = c.client_name),
         (select count(*)::int from auth.sessions s join auth.oauth_clients c2 on c2.id = s.oauth_client_id where s.user_id = p_user and c2.client_name = c.client_name)
  from auth.oauth_consents co
  join auth.oauth_clients c on c.id = co.client_id and c.deleted_at is null
  where co.user_id = p_user and co.revoked_at is null
  group by c.client_name
  order by max(co.granted_at) desc;
$function$
;

CREATE OR REPLACE FUNCTION public.ai_connection_remove(p_user uuid, p_client uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'auth', 'public'
AS $function$
declare n int := 0; k int;
begin
  -- end the AI's login sessions first (its access stops), then withdraw the permission so it has to ask again.
  delete from auth.sessions where user_id = p_user and oauth_client_id is not null and (p_client is null or oauth_client_id = p_client);
  get diagnostics k = row_count; n := n + k;
  update auth.oauth_consents set revoked_at = now() where user_id = p_user and revoked_at is null and (p_client is null or client_id = p_client);
  get diagnostics k = row_count; n := n + k;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.ai_connections_list(p_user uuid)
 RETURNS TABLE(client_id uuid, client_name text, logo_uri text, connected_at timestamp with time zone, last_active timestamp with time zone, active_sessions integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'auth', 'public'
AS $function$
  select c.id, c.client_name, c.logo_uri,
         min(co.granted_at) as connected_at,
         (select max(greatest(s.updated_at, s.refreshed_at::timestamptz)) from auth.sessions s where s.user_id = p_user and s.oauth_client_id = c.id) as last_active,
         (select count(*)::int from auth.sessions s where s.user_id = p_user and s.oauth_client_id = c.id) as active_sessions
  from auth.oauth_consents co
  join auth.oauth_clients c on c.id = co.client_id and c.deleted_at is null
  where co.user_id = p_user and co.revoked_at is null
  group by c.id, c.client_name, c.logo_uri
  order by max(co.granted_at) desc;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_ai_plan_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o record;
begin
  if NEW.uploaded_by is distinct from 'ai_chat' or NEW.launch_batch_id is null or NEW.company_id is null then return NEW; end if;
  select po.* into o from ai_plan_options po
    join ai_plans ap on ap.id = po.plan_id
   where ap.company_id = NEW.company_id and ap.status = 'launching'
     and ap.plan->>'campaign_name' = NEW.campaign_name
   order by ap.created_at desc limit 1;
  if found then
    if o.start_time is not null then NEW.scheduled_for := o.start_time; end if;
    if o.end_time is not null then NEW.campaign_end_date := o.end_time; end if;
  end if;
  return NEW;
end $function$
;

CREATE OR REPLACE FUNCTION public.apply_subscription_payment(p_reference text, p_company uuid, p_plan text, p_months integer, p_amount numeric, p_raw jsonb)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_exp timestamptz; v_cur timestamptz;
begin
  if p_plan not in ('media_buyer','business') or p_months not in (1,3,6,12) then raise exception 'bad plan or months'; end if;
  insert into billing_payments(company_id, reference, plan, months, amount_naira, raw_event)
    values (p_company, p_reference, p_plan, p_months, p_amount, p_raw)
    on conflict (reference) do nothing;
  if not found then
    select plan_expires_at into v_exp from companies where id = p_company;
    return v_exp;
  end if;
  select plan_expires_at into v_cur from companies where id = p_company for update;
  v_exp := greatest(now(), coalesce(v_cur, now())) + make_interval(days => 30 * p_months);
  update companies set plan = p_plan, plan_expires_at = v_exp where id = p_company and plan <> 'comped';
  return v_exp;
end $function$
;

CREATE OR REPLACE FUNCTION public.backfill_media_buyers()
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
  update ad_sets a set media_buyer_id = resolve_media_buyer(array[
    a.adset_name, (select c.campaign_name from campaigns c where c.id = a.campaign_id)
  ]) where a.media_buyer_id is null;
  update orders o set media_buyer_id = a.media_buyer_id
  from ad_sets a where o.ad_set_id = a.id and o.media_buyer_id is null;
$function$
;

CREATE OR REPLACE FUNCTION public.buyer_billed_spend(p_buyer uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select sum(dm.spend_naira) from public.daily_metrics dm join public.ad_accounts a on a.id = dm.ad_account_id
                   where a.billing_mode = 'managed' and dm.ad_set_ad_id is null and public.account_wallet_holder(a.id) = p_buyer), 0)
       + coalesce((select sum(amount_naira) from public.wallet_adjustments where media_buyer_id = p_buyer), 0);
$function$
;

CREATE OR REPLACE FUNCTION public.buyer_wallet_balance(p_buyer uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select sum(amount_naira) from public.wallet_topups where media_buyer_id = p_buyer and status = 'confirmed'), 0)
       - public.buyer_billed_spend(p_buyer);
$function$
;

CREATE OR REPLACE FUNCTION public.bv_on_message_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  update conversations
  set last_message_at = new.created_at,
      unread_count = case when new.direction = 'inbound' then unread_count + 1 else unread_count end
  where id = new.conversation_id;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.company_wallet_balance(p_company uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select sum(amount_naira) from payments where company_id = p_company and status = 'confirmed' and media_buyer_id is null and source = 'admin_topup'), 0)
       - coalesce((select sum(amount_naira) from fund_requests where company_id = p_company and status in ('approved','transferred')), 0)
       - coalesce((select sum(amount_naira) from admin_withdrawals where company_id = p_company and status = 'sent'), 0)
       - public.managed_billed_spend(p_company);
$function$
;

CREATE OR REPLACE FUNCTION public.compress_site_image_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform net.http_post(
    url := '__SUPABASE_URL__/functions/v1/compress-site-image',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object('secret','Zq8Wn3Vx7Lp2Rt5Yh9Bc4Md6Kf1Ge0Ja','bucket',new.bucket_id,'name',new.name));
  return new;
exception when others then
  return new; -- never block an upload
end $function$
;

CREATE OR REPLACE FUNCTION public.cron_unschedule_first_delivery_watch()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select cron.unschedule(jobid) from cron.job where jobname = 'check-first-delivery-lunessa';
$function$
;

CREATE OR REPLACE FUNCTION public.cron_unschedule_lunessa_watch()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select cron.unschedule(jobid) from cron.job where jobname = 'check-lunessa-ad-review';
$function$
;

CREATE OR REPLACE FUNCTION public.current_buyer_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select media_buyer_id from profiles where id = auth.uid() $function$
;

CREATE OR REPLACE FUNCTION public.current_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select company_id from profiles where id = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION public.current_media_buyer_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select media_buyer_id from profiles where id = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from profiles where id = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION public.guard_ad_account_billing()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if coalesce(auth.role(), 'service_role') in ('authenticated','anon') then
    if tg_op = 'INSERT' then
      new.billing_mode := 'own'; new.markup_pct := 0; new.sellable_id := null;
    else
      new.billing_mode := old.billing_mode; new.markup_pct := old.markup_pct; new.sellable_id := old.sellable_id;
    end if;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.guard_auto_send_cols()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if coalesce(auth.role(), 'service_role') in ('authenticated','anon') then
    if tg_op = 'INSERT' then
      new.auto_send_enabled := false; new.auto_send_max_naira := null; new.auto_send_daily_max_naira := null; new.auto_send_set_by := null; new.auto_send_set_at := null;
    else
      new.auto_send_enabled := old.auto_send_enabled; new.auto_send_max_naira := old.auto_send_max_naira; new.auto_send_daily_max_naira := old.auto_send_daily_max_naira; new.auto_send_set_by := old.auto_send_set_by; new.auto_send_set_at := old.auto_send_set_at;
    end if;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.guard_fund_requests()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.req_account_number is null or new.req_bank_code is null then
      raise exception 'A funding request needs the Meta account number and bank from Ads Manager (Billing, Add funds). Use Request funds on the Wallet tab.';
    end if;
  elsif tg_op = 'UPDATE' then
    if old.status = 'pending' and new.status = 'approved' then
      raise exception 'Funding is approved with your transfer PIN: open the Wallet tab and tap Approve and send.';
    end if;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.is_company_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select current_user_role() in ('owner', 'admin')
$function$
;

CREATE OR REPLACE FUNCTION public.managed_billed_spend(p_company uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select sum(dm.spend_naira) from public.daily_metrics dm join public.ad_accounts a on a.id = dm.ad_account_id
                   where a.company_id = p_company and a.billing_mode = 'managed' and dm.ad_set_ad_id is null
                     and public.account_wallet_holder(a.id) is null), 0)
       + coalesce((select sum(amount_naira) from public.wallet_adjustments where company_id = p_company and media_buyer_id is null), 0);
$function$
;

CREATE OR REPLACE FUNCTION public.managed_earnings(p_days integer DEFAULT 30)
 RETURNS TABLE(day date, billed numeric, raw numeric, profit numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select dm.metric_date, sum(dm.spend_naira), sum(coalesce(dm.raw_spend_naira, dm.spend_naira)), sum(dm.spend_naira) - sum(coalesce(dm.raw_spend_naira, dm.spend_naira))
  from public.daily_metrics dm join public.ad_accounts a on a.id = dm.ad_account_id
  where a.billing_mode = 'managed' and dm.ad_set_ad_id is null and dm.metric_date >= current_date - p_days
  group by dm.metric_date order by dm.metric_date desc;
$function$
;

CREATE OR REPLACE FUNCTION public.match_held_payment(p_payment_id uuid, p_order_id uuid, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  pay record;
  ord record;
  ph record;
  who text;
  delivered boolean := false;
begin
  if current_user_role() not in ('owner','admin') then
    raise exception 'Only an owner or admin can match a deposit to an order.';
  end if;
  select * into pay from public.payments where id = p_payment_id and company_id = current_company_id() for update;
  if not found or pay.held_for_buyer_id is null or pay.status <> 'confirmed' or pay.order_id is not null then
    raise exception 'That is not an unmatched deposit held by the company.';
  end if;
  select * into ord from public.orders where id = p_order_id and company_id = current_company_id() for update;
  if not found then raise exception 'Order not found.'; end if;
  if ord.order_status in ('cancelled','returned') then raise exception 'That order is %, so it cannot take a payment.', ord.order_status; end if;
  if exists (select 1 from public.payments where order_id = ord.id and status = 'confirmed') then
    raise exception 'That order already has a confirmed payment.';
  end if;
  if abs(coalesce(ord.order_value_naira, 0) - pay.amount_naira) > 1 then
    raise exception 'The deposit is % but the order is %. They must be the same amount.', pay.amount_naira, ord.order_value_naira;
  end if;
  who := 'Matched to an order by ' || coalesce((select display_name from public.profiles where id = auth.uid()), 'an admin') || ' on ' || to_char(now(), 'YYYY-MM-DD');
  select * into ph from public.payments where order_id = ord.id and status <> 'confirmed' limit 1 for update;
  if found then
    -- the order already has its empty "waiting for payment" row: it becomes the real payment, and the held row stays as a record
    update public.payments set paystack_reference = pay.paystack_reference || '-moved', status = 'unmatched', held_for_buyer_id = null, held_reason = 'Moved to an order. ' || who where id = pay.id;
    update public.payments set status = 'confirmed', source = 'customer_order', media_buyer_id = ord.media_buyer_id, amount_naira = pay.amount_naira,
      paid_at = coalesce(pay.paid_at, now()), channel = pay.channel, paystack_reference = pay.paystack_reference, raw_event = pay.raw_event,
      sender_name = pay.sender_name, sender_bank = pay.sender_bank, sender_account = pay.sender_account, narration = pay.narration, held_reason = who
      where id = ph.id;
  else
    update public.payments set order_id = ord.id, media_buyer_id = ord.media_buyer_id, source = 'customer_order', held_for_buyer_id = null, held_reason = who where id = pay.id;
  end if;
  if ord.order_status in ('pending','valid') then
    update public.orders set order_status = 'delivered', delivered_at = now() where id = ord.id;
    delivered := true;
  end if;
  update public.payment_match_requests set status = case when id = p_request_id then 'approved' else 'declined' end, decided_at = now(), decided_by = auth.uid()
    where payment_id = pay.id and status = 'pending';
  return jsonb_build_object('ok', true, 'order_id', ord.id, 'delivered', delivered, 'amount', pay.amount_naira);
end $function$
;

CREATE OR REPLACE FUNCTION public.media_buyer_daily_roas_agg(from_date date DEFAULT NULL::date, to_date date DEFAULT NULL::date)
 RETURNS TABLE(media_buyer_id uuid, day date, spend_naira numeric, orders bigint, revenue_naira numeric, delivered_revenue_naira numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with my_buyer as (
    select p.media_buyer_id as id from profiles p where p.id = auth.uid()
  ),
  spend as (
    select a.media_buyer_id, m.metric_date as day, sum(m.spend_naira) as spend_naira
    from daily_metrics m
    join ad_sets a on a.id = m.ad_set_id and m.ad_set_ad_id is null
    where a.company_id = current_company_id()
      and (current_user_role() in ('owner','admin') or a.media_buyer_id = (select id from my_buyer))
      and (from_date is null or m.metric_date >= from_date)
      and (to_date is null or m.metric_date <= to_date)
    group by a.media_buyer_id, m.metric_date
  ),
  revenue as (
    select o.media_buyer_id,
      (o.ordered_at at time zone 'Africa/Lagos')::date as day,
      count(*) filter (where o.order_status not in ('cancelled','returned')) as orders,
      coalesce(sum(o.order_value_naira) filter (where o.order_status not in ('cancelled','returned')), 0) as revenue_naira,
      coalesce(sum(o.order_value_naira) filter (where o.order_status = 'delivered'), 0) as delivered_revenue_naira
    from orders o
    where o.company_id = current_company_id()
      and (current_user_role() in ('owner','admin','customer_care') or o.media_buyer_id = (select id from my_buyer))
      and (from_date is null or (o.ordered_at at time zone 'Africa/Lagos')::date >= from_date)
      and (to_date is null or (o.ordered_at at time zone 'Africa/Lagos')::date <= to_date)
    group by o.media_buyer_id, ((o.ordered_at at time zone 'Africa/Lagos')::date)
  )
  select coalesce(s.media_buyer_id, r.media_buyer_id), coalesce(s.day, r.day),
    coalesce(s.spend_naira, 0), coalesce(r.orders, 0),
    coalesce(r.revenue_naira, 0), coalesce(r.delivered_revenue_naira, 0)
  from spend s
  full join revenue r on r.media_buyer_id is not distinct from s.media_buyer_id and r.day = s.day;
$function$
;

CREATE OR REPLACE FUNCTION public.media_buyer_daily_roas_agg_v2(from_date date DEFAULT NULL::date, to_date date DEFAULT NULL::date)
 RETURNS TABLE(media_buyer_id uuid, day date, spend_naira numeric, orders bigint, revenue_naira numeric, delivered_revenue_naira numeric, confirmed_revenue_naira numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with my_buyer as (
    select p.media_buyer_id as id from profiles p where p.id = auth.uid()
  ),
  spend as (
    select a.media_buyer_id, m.metric_date as day, sum(m.spend_naira) as spend_naira
    from daily_metrics m
    join ad_sets a on a.id = m.ad_set_id and m.ad_set_ad_id is null
    where a.company_id = current_company_id()
      and (current_user_role() in ('owner','admin') or a.media_buyer_id = (select id from my_buyer))
      and (from_date is null or m.metric_date >= from_date)
      and (to_date is null or m.metric_date <= to_date)
    group by a.media_buyer_id, m.metric_date
  ),
  revenue as (
    select o.media_buyer_id,
      (o.ordered_at at time zone 'Africa/Lagos')::date as day,
      count(*) filter (where o.order_status not in ('cancelled','returned')) as orders,
      coalesce(sum(o.order_value_naira) filter (where o.order_status not in ('cancelled','returned')), 0) as revenue_naira,
      coalesce(sum(o.order_value_naira) filter (where o.order_status = 'delivered'), 0) as delivered_revenue_naira
    from orders o
    where o.company_id = current_company_id()
      and (current_user_role() in ('owner','admin','customer_care') or o.media_buyer_id = (select id from my_buyer))
      and (from_date is null or (o.ordered_at at time zone 'Africa/Lagos')::date >= from_date)
      and (to_date is null or (o.ordered_at at time zone 'Africa/Lagos')::date <= to_date)
    group by o.media_buyer_id, ((o.ordered_at at time zone 'Africa/Lagos')::date)
  ),
  confirmed as (
    select p.media_buyer_id,
      (p.paid_at at time zone 'Africa/Lagos')::date as day,
      coalesce(sum(p.amount_naira), 0) as confirmed_revenue_naira
    from payments p
    where p.status = 'confirmed'
      and p.company_id = current_company_id()
      and (current_user_role() in ('owner','admin') or p.media_buyer_id = (select id from my_buyer))
      and (from_date is null or (p.paid_at at time zone 'Africa/Lagos')::date >= from_date)
      and (to_date is null or (p.paid_at at time zone 'Africa/Lagos')::date <= to_date)
    group by p.media_buyer_id, ((p.paid_at at time zone 'Africa/Lagos')::date)
  )
  select
    coalesce(s.media_buyer_id, r.media_buyer_id, c.media_buyer_id),
    coalesce(s.day, r.day, c.day),
    coalesce(s.spend_naira, 0), coalesce(r.orders, 0),
    coalesce(r.revenue_naira, 0), coalesce(r.delivered_revenue_naira, 0),
    coalesce(c.confirmed_revenue_naira, 0)
  from spend s
  full join revenue r on r.media_buyer_id is not distinct from s.media_buyer_id and r.day = s.day
  full join confirmed c on c.media_buyer_id is not distinct from coalesce(s.media_buyer_id, r.media_buyer_id) and c.day = coalesce(s.day, r.day);
$function$
;

CREATE OR REPLACE FUNCTION public.media_buyer_daily_roas_agg_v2(from_date date DEFAULT NULL::date, to_date date DEFAULT NULL::date, company_wide boolean DEFAULT false)
 RETURNS TABLE(media_buyer_id uuid, day date, spend_naira numeric, orders bigint, revenue_naira numeric, delivered_revenue_naira numeric, confirmed_revenue_naira numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with my_buyer as (
    select p.media_buyer_id as id from profiles p where p.id = auth.uid()
  ),
  spend as (
    select a.media_buyer_id, m.metric_date as day, sum(m.spend_naira) as spend_naira
    from daily_metrics m
    join ad_sets a on a.id = m.ad_set_id and m.ad_set_ad_id is null
    where a.company_id = current_company_id()
      and (current_user_role() in ('owner','admin') or company_wide or a.media_buyer_id = (select id from my_buyer))
      and (from_date is null or m.metric_date >= from_date)
      and (to_date is null or m.metric_date <= to_date)
    group by a.media_buyer_id, m.metric_date
  ),
  revenue as (
    select o.media_buyer_id,
      (o.ordered_at at time zone 'Africa/Lagos')::date as day,
      count(*) filter (where o.order_status not in ('cancelled','returned')) as orders,
      coalesce(sum(o.order_value_naira) filter (where o.order_status not in ('cancelled','returned')), 0) as revenue_naira,
      coalesce(sum(o.order_value_naira) filter (where o.order_status = 'delivered'), 0) as delivered_revenue_naira
    from orders o
    where o.company_id = current_company_id()
      and (current_user_role() in ('owner','admin','customer_care') or company_wide or o.media_buyer_id = (select id from my_buyer))
      and (from_date is null or (o.ordered_at at time zone 'Africa/Lagos')::date >= from_date)
      and (to_date is null or (o.ordered_at at time zone 'Africa/Lagos')::date <= to_date)
    group by o.media_buyer_id, ((o.ordered_at at time zone 'Africa/Lagos')::date)
  ),
  confirmed as (
    select p.media_buyer_id,
      (p.paid_at at time zone 'Africa/Lagos')::date as day,
      coalesce(sum(p.amount_naira), 0) as confirmed_revenue_naira
    from payments p
    where p.status = 'confirmed'
      and p.company_id = current_company_id()
      and (current_user_role() in ('owner','admin') or company_wide or p.media_buyer_id = (select id from my_buyer))
      and (from_date is null or (p.paid_at at time zone 'Africa/Lagos')::date >= from_date)
      and (to_date is null or (p.paid_at at time zone 'Africa/Lagos')::date <= to_date)
    group by p.media_buyer_id, ((p.paid_at at time zone 'Africa/Lagos')::date)
  )
  select
    coalesce(s.media_buyer_id, r.media_buyer_id, c.media_buyer_id),
    coalesce(s.day, r.day, c.day),
    coalesce(s.spend_naira, 0), coalesce(r.orders, 0),
    coalesce(r.revenue_naira, 0), coalesce(r.delivered_revenue_naira, 0),
    coalesce(c.confirmed_revenue_naira, 0)
  from spend s
  full join revenue r on r.media_buyer_id is not distinct from s.media_buyer_id and r.day = s.day
  full join confirmed c on c.media_buyer_id is not distinct from coalesce(s.media_buyer_id, r.media_buyer_id) and c.day = coalesce(s.day, r.day);
$function$
;

CREATE OR REPLACE FUNCTION public.media_buyers_guard_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or current_user_role() in ('owner','admin') then return new; end if;
  if (to_jsonb(new) - 'meta_partner_business_id') is distinct from (to_jsonb(old) - 'meta_partner_business_id') then
    raise exception 'Only an owner or admin can change this';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.my_account_wallet_balance(p_account uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.account_wallet_balance(a.id) from public.ad_accounts a
  where a.id = p_account and a.company_id = (select company_id from public.profiles where id = auth.uid());
$function$
;

CREATE OR REPLACE FUNCTION public.my_buyer_wallet_balance()
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when p.media_buyer_id is null then null else public.buyer_wallet_balance(p.media_buyer_id) end
  from public.profiles p where p.id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.my_company_wallet_balance()
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.company_wallet_balance((select company_id from public.profiles where id = auth.uid()));
$function$
;

CREATE OR REPLACE FUNCTION public.my_managed_billed_spend()
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.managed_billed_spend((select company_id from public.profiles where id = auth.uid()));
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_ng_phone(raw text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
declare d text;
begin
  if raw is null then return null; end if;
  d := regexp_replace(raw, '\D', '', 'g');
  if left(d, 1) = '0' and length(d) = 11 then d := '234' || substring(d from 2); end if;
  if length(d) = 10 and d ~ '^[789]' then d := '234' || d; end if;
  if d !~ '^234[789]\d{9}$' then return null; end if;
  return '+' || d;
end; $function$
;

CREATE OR REPLACE FUNCTION public.order_payment_details(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record;
  b record;
  c record;
  me record;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then raise exception 'Order not found.'; end if;
  select role, delivery_agent_id, media_buyer_id into me from public.profiles where id = auth.uid();
  if o.company_id is distinct from current_company_id() then raise exception 'Not your order.'; end if;
  if not (me.role in ('owner','admin','customer_care') or (me.role = 'delivery_agent' and me.delivery_agent_id is not null and me.delivery_agent_id = o.delivery_agent_id) or (me.role = 'buyer' and me.media_buyer_id = o.media_buyer_id)) then
    raise exception 'Not your order.';
  end if;
  select name into c from public.companies where id = o.company_id;
  select name, dedicated_account_number, dedicated_account_bank into b from public.media_buyers where id = o.media_buyer_id;
  return jsonb_build_object('customer_name', o.customer_name, 'customer_phone', o.customer_phone, 'amount', o.order_value_naira,
    'code', o.payment_narration_code, 'bank', b.dedicated_account_bank, 'account_number', b.dedicated_account_number,
    'account_name', trim(coalesce(c.name, '') || ' ' || coalesce(b.name, '')));
end $function$
;

CREATE OR REPLACE FUNCTION public.orders_assign_care()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cid uuid;
begin
  if new.care_agent_id is null and new.company_id is not null then
    select p.id into cid from public.profiles p
      where p.company_id = new.company_id and p.role = 'customer_care'
      order by (select count(*) from public.orders o where o.care_agent_id = p.id and o.order_status = 'pending') asc, random()
      limit 1;
    if cid is not null then new.care_agent_id := cid; new.care_assigned_at := now(); end if;
  end if;
  return new;
exception when others then
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.orders_assign_media_buyer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if new.media_buyer_id is null and new.ad_set_id is not null then
    select a.media_buyer_id into new.media_buyer_id from ad_sets a where a.id = new.ad_set_id;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.orders_guard_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r text;
begin
  if auth.uid() is null then return new; end if;
  r := current_user_role();
  if r in ('owner','admin') then return new; end if;
  if new.company_id is distinct from old.company_id or new.media_buyer_id is distinct from old.media_buyer_id
     or new.product_id is distinct from old.product_id or new.order_value_naira is distinct from old.order_value_naira
     or new.quantity is distinct from old.quantity or new.currency is distinct from old.currency
     or new.event_id is distinct from old.event_id or new.capi_sent is distinct from old.capi_sent
     or new.ad_set_id is distinct from old.ad_set_id or new.ad_account_id is distinct from old.ad_account_id
     or new.site_id is distinct from old.site_id or new.payment_narration_code is distinct from old.payment_narration_code
     or new.delivered_order_commission_naira is distinct from old.delivered_order_commission_naira
     or new.care_agent_id is distinct from old.care_agent_id then
    raise exception 'Only an owner or admin can change an order''s value, product, owner or customer-care agent';
  end if;
  if new.order_status is distinct from old.order_status then
    if old.order_status = 'delivered' then raise exception 'A delivered order can only be changed by an admin'; end if;
    if new.order_status = 'delivered' and r <> 'delivery_agent' then
      raise exception 'Only the delivery agent, or a confirmed payment, can mark an order delivered';
    end if;
    if new.order_status = 'returned' and r not in ('delivery_agent','customer_care') then
      raise exception 'Only the delivery agent or customer care can mark an order returned';
    end if;
  end if;
  if new.delivered_at is distinct from old.delivered_at and r <> 'delivery_agent' then
    raise exception 'Only the delivery agent can set the delivery time';
  end if;
  if new.delivery_stage is distinct from old.delivery_stage and r <> 'delivery_agent' then
    raise exception 'Only the delivery agent can update the delivery stage';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.orders_spam_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ begin if new.customer_phone is not null and new.customer_phone <> '' then if (select count(*) from public.orders o where o.company_id is not distinct from new.company_id and o.customer_phone = new.customer_phone and o.ordered_at > now() - interval '1 hour') >= 8 then raise exception 'Too many orders from this phone number. Please try again later.' using errcode = 'P0001'; end if; end if; if (select count(*) from public.orders o where o.company_id is not distinct from new.company_id and o.ordered_at > now() - interval '10 minutes') >= 300 then raise exception 'Order volume limit reached. Please try again shortly.' using errcode = 'P0001'; end if; return new; end $function$
;

CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.role <> old.role
     or new.company_id <> old.company_id
     or new.media_buyer_id is distinct from old.media_buyer_id
     or new.delivery_agent_id is distinct from old.delivery_agent_id then
    if current_user_role() not in ('owner','admin') then
      raise exception 'Cannot change role, company, or buyer/agent assignment from here';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into push_subscriptions (user_id, company_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), current_company_id(), p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set user_id = auth.uid(), company_id = current_company_id(),
        p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, last_seen_at = now();
end $function$
;

CREATE OR REPLACE FUNCTION public.resolve_customer_id(p_company_id uuid, p_raw_phone text, p_name text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_state text DEFAULT NULL::text, p_address text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_phone text; v_id uuid;
begin
  v_phone := normalize_ng_phone(p_raw_phone);
  if v_phone is null or p_company_id is null then return null; end if;
  insert into conversation_customers (company_id, phone, name, city, state, address)
  values (p_company_id, v_phone, p_name, p_city, p_state, p_address)
  on conflict (company_id, phone) do update set
    name = coalesce(conversation_customers.name, excluded.name),
    city = coalesce(conversation_customers.city, excluded.city),
    state = coalesce(conversation_customers.state, excluded.state),
    address = coalesce(conversation_customers.address, excluded.address)
  returning id into v_id;
  return v_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.resolve_media_buyer(names text[])
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  select mb.id
  from media_buyers mb, unnest(names) n
  where n is not null and upper(n) like '%[' || mb.code || ']%'
  order by length(mb.code) desc
  limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.revoke_user_sessions(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
  delete from auth.sessions where user_id = p_user;
end $function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_ad_set_media_buyer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if new.media_buyer_id is null and new.ad_account_id is not null then
    select coalesce(aa.media_buyer_id, mc.media_buyer_id) into new.media_buyer_id
    from ad_accounts aa
    left join meta_connections mc on mc.id = aa.meta_connection_id
    where aa.id = new.ad_account_id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_delivery_agent_area(p_agent_id uuid, p_state text, p_city text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ag record;
  mine uuid;
begin
  select * into ag from public.delivery_agents where id = p_agent_id;
  if not found then raise exception 'Rider not found.'; end if;
  select delivery_agent_id into mine from public.profiles where id = auth.uid();
  if not ((ag.company_id = current_company_id() and current_user_role() in ('owner','admin')) or mine = p_agent_id) then
    raise exception 'You cannot change this rider.';
  end if;
  if coalesce(trim(p_state), '') = '' then raise exception 'Choose a state.'; end if;
  update public.delivery_agents set state = trim(p_state), city = nullif(trim(coalesce(p_city, '')), ''), zone = trim(p_state) || coalesce(', ' || nullif(trim(coalesce(p_city, '')), ''), '') where id = p_agent_id;
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.set_product_default_ad_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.ad_account_id is null and new.media_buyer_id is not null then
    select a.id into new.ad_account_id
    from public.ad_accounts a
    where a.media_buyer_id = new.media_buyer_id
      and a.company_id = new.company_id
      and a.status = 'active'
    order by a.created_at desc
    limit 1;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_product_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.created_by is null then new.created_by := auth.uid(); end if;
  if new.media_buyer_id is null then
    select pr.media_buyer_id into new.media_buyer_id from public.profiles pr where pr.id = auth.uid();
  end if;
  if new.media_buyer_id is null and new.ad_account_id is not null then
    select a.media_buyer_id into new.media_buyer_id from public.ad_accounts a where a.id = new.ad_account_id;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_ai_sales_reply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_secret text;
begin
  if new.direction = 'inbound' and new.message_type in ('text', 'audio', 'image', 'button', 'interactive', 'document', 'video')
     and exists (
       select 1 from conversations c join ai_sales_agents a on a.buyer_whatsapp_number_id = c.buyer_whatsapp_number_id
       where c.id = new.conversation_id and a.mode <> 'off'
     ) then
    select value into v_secret from app_secrets where key = 'ads_cron_secret';
    perform net.http_post(
      url := '__SUPABASE_URL__/functions/v1/ai-sales-reply',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := jsonb_build_object('message_id', new.id),
      timeout_milliseconds := 60000
    );
  end if;
  return new;
exception when others then
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_launch_wa_launched()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare k text;
begin
  if new.status = 'launched' and old.status is distinct from 'launched' then
    select value into k from app_secrets where key = 'ads_cron_secret';
    if k is not null then
      perform net.http_post(url := '__SUPABASE_URL__/functions/v1/launch-wa',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', k),
        body := jsonb_build_object('event','launched','plan_id', new.id), timeout_milliseconds := 25000);
    end if;
  end if;
  return new;
exception when others then return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_launch_wa_prepare()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare k text;
begin
  select value into k from app_secrets where key = 'ads_cron_secret';
  if k is null then return new; end if;
  perform net.http_post(url := '__SUPABASE_URL__/functions/v1/launch-wa',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', k),
    body := jsonb_build_object('event','prepare','approval_id', new.id), timeout_milliseconds := 25000);
  return new;
exception when others then return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_leads_resolve_customer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  new.customer_id := resolve_customer_id(new.company_id, new.phone, new.full_name);
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.trg_notify_care()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_secret text;
begin
  if new.care_agent_id is not null and new.order_status = 'pending' and (tg_op = 'INSERT' or new.care_agent_id is distinct from old.care_agent_id) then
    select value into v_secret from app_secrets where key = 'ads_cron_secret';
    perform net.http_post(
      url := '__SUPABASE_URL__/functions/v1/notify-customer',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := jsonb_build_object('order_id', new.id, 'event', 'care_assigned'),
      timeout_milliseconds := 30000
    );
  end if;
  return new;
exception when others then
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_notify_customer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_secret text; v_event text; v_on text; v_co boolean;
begin
  -- Customer WhatsApp notices go out when the platform-wide switch is on, or when this company has switched them on for itself.
  select value into v_on from app_secrets where key = 'customer_notifications_enabled';
  select coalesce(customer_whatsapp_enabled, false) into v_co from companies where id = new.company_id;
  if coalesce(v_on, 'off') <> 'on' and not coalesce(v_co, false) then return new; end if;
  if tg_op = 'INSERT' then
    -- Approved template with Confirm / Cancel buttons goes first (plain text is not delivered to a customer outside the 24h window).
    v_event := 'order_confirm_request';
  else
    if new.order_status is distinct from old.order_status then
      if new.order_status = 'valid' then v_event := 'order_confirmed';
      elsif new.order_status = 'delivered' then v_event := 'order_delivered'; end if;
    end if;
    if v_event is null and new.assignment_status is distinct from old.assignment_status and new.assignment_status = 'accepted' then v_event := 'agent_accepted'; end if;
    if v_event is null and new.delivery_stage is distinct from old.delivery_stage and new.delivery_stage = 'on_the_way' then v_event := 'out_for_delivery'; end if;
  end if;
  if v_event is not null and new.customer_phone is not null then
    select value into v_secret from app_secrets where key = 'ads_cron_secret';
    perform net.http_post(
      url := '__SUPABASE_URL__/functions/v1/notify-customer',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := jsonb_build_object('order_id', new.id, 'event', v_event),
      timeout_milliseconds := 30000
    );
  end if;
  return new;
exception when others then
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_orders_adjust_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  -- A single-product order (incl. a single-line cart) stores product_id
  -- directly on the order and is handled by the first branch only. A
  -- multi-product cart leaves product_id null -- order_items is the only
  -- place to find what's in it, so the second branch (guarded on
  -- product_id is null) handles that case instead. Never both, or a
  -- single-line cart would double-decrement (it has both a product_id AND
  -- one order_items row for that same line).
  if new.order_status = 'delivered' and old.order_status is distinct from 'delivered' then
    if new.product_id is not null then
      update products set stock_on_hand = stock_on_hand - coalesce(new.quantity, 1)
      where id = new.product_id and stock_on_hand is not null;
    else
      update products set stock_on_hand = products.stock_on_hand - oi.quantity
      from order_items oi
      where oi.order_id = new.id and products.id = oi.product_id and products.stock_on_hand is not null;
    end if;
  elsif old.order_status = 'delivered' and new.order_status is distinct from 'delivered' then
    if new.product_id is not null then
      update products set stock_on_hand = stock_on_hand + coalesce(new.quantity, 1)
      where id = new.product_id and stock_on_hand is not null;
    else
      update products set stock_on_hand = products.stock_on_hand + oi.quantity
      from order_items oi
      where oi.order_id = new.id and products.id = oi.product_id and products.stock_on_hand is not null;
    end if;
  end if;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.trg_orders_audit_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- A null company_id means this order is already invisible to every
  -- dashboard (the deliberate failure mode for an order whose company
  -- couldn't be resolved) -- nothing to audit for nobody to see, and
  -- order_events.company_id is NOT NULL, so this must be skipped rather
  -- than attempted.
  if new.company_id is null then
    return new;
  end if;
  if new.order_status is distinct from old.order_status then
    insert into order_events (company_id, order_id, changed_by, field_name, old_value, new_value)
    values (new.company_id, new.id, auth.uid(), 'order_status', old.order_status, new.order_status);
  end if;
  if new.delivery_agent_id is distinct from old.delivery_agent_id then
    insert into order_events (company_id, order_id, changed_by, field_name, old_value, new_value)
    values (new.company_id, new.id, auth.uid(), 'delivery_agent_id', old.delivery_agent_id::text, new.delivery_agent_id::text);
  end if;
  if new.assignment_status is distinct from old.assignment_status then
    insert into order_events (company_id, order_id, changed_by, field_name, old_value, new_value)
    values (new.company_id, new.id, auth.uid(), 'assignment_status', old.assignment_status, new.assignment_status);
  end if;
  if new.media_buyer_id is distinct from old.media_buyer_id then
    insert into order_events (company_id, order_id, changed_by, field_name, old_value, new_value)
    values (new.company_id, new.id, auth.uid(), 'media_buyer_id', old.media_buyer_id::text, new.media_buyer_id::text);
  end if;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.trg_orders_capi_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$ declare v_secret text; begin if new.order_status = 'delivered' and old.order_status is distinct from 'delivered' and new.capi_paid_sent_at is null and new.site_id is not null then select value into v_secret from app_secrets where key = 'ads_cron_secret'; perform net.http_post(url := '__SUPABASE_URL__/functions/v1/meta-capi', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret), body := jsonb_build_object('order_id', new.id), timeout_milliseconds := 30000); end if; return new; exception when others then return new; end $function$
;

CREATE OR REPLACE FUNCTION public.trg_orders_resolve_customer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_dup_id uuid;
begin
  new.customer_id := resolve_customer_id(new.company_id, new.customer_phone, new.customer_name, new.customer_city, new.customer_state, new.customer_address);

  -- Same customer, same delivery address, placed again within the hour --
  -- the classic COD duplicate/spam pattern (same person hitting submit
  -- twice, or junk orders aimed at wasting a delivery attempt). Flagged for
  -- a human to glance at, never blocked -- a real repeat order should still
  -- go through.
  if new.customer_id is not null and new.customer_address is not null and tg_op = 'INSERT' then
    select id into v_dup_id from orders
    where customer_id = new.customer_id
      and order_status <> 'cancelled'
      and lower(trim(customer_address)) = lower(trim(new.customer_address))
      and ordered_at > now() - interval '1 hour'
    order by ordered_at desc
    limit 1;
    if v_dup_id is not null then
      new.possible_duplicate := true;
      new.duplicate_of_order_id := v_dup_id;
    end if;
  end if;

  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.trg_orders_shipbubble_dispatch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_mode text; v_secret text;
begin
  if new.order_status = 'valid' and new.shipbubble_order_id is null
     and (tg_op = 'INSERT' or old.order_status is distinct from 'valid') then
    select value into v_mode from app_secrets where key = 'shipbubble_dispatch';
    if coalesce(v_mode, 'off') <> 'off' then
      select value into v_secret from app_secrets where key = 'ads_cron_secret';
      perform net.http_post(
        url := '__SUPABASE_URL__/functions/v1/create-shipbubble-delivery',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
        body := jsonb_build_object('order_id', new.id),
        timeout_milliseconds := 55000
      );
    end if;
  end if;
  return new;
exception when others then
  return new; -- never block an order update because dispatch failed
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_website_leads_resolve_customer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  new.customer_id := resolve_customer_id(new.company_id, new.phone, new.name);
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.user_owns_ad_account(account_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.ad_accounts 
    WHERE id = account_id AND user_id = auth.uid()
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.zz_probe()
 RETURNS integer
 LANGUAGE sql
AS $function$select 1$function$
;

CREATE OR REPLACE FUNCTION public.zz_probe2(a integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$ begin if a > 1 then raise exception 'too big %', a; end if; return a; end $function$
;
