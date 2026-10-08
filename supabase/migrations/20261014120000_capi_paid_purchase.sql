-- Purchase tracking can now be "paid": the Purchase event goes to Meta (server side) only once the order is delivered / paid,
-- so ads optimise for real money instead of form submits.
alter table public.sites drop constraint if exists sites_purchase_event_check;
alter table public.sites add constraint sites_purchase_event_check check (purchase_event in ('submit','none','paid'));
alter table public.orders add column if not exists capi_paid_sent_at timestamptz;

create or replace function public.trg_orders_capi_paid() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text;
begin
  if new.order_status = 'delivered' and old.order_status is distinct from 'delivered' and new.capi_paid_sent_at is null and new.site_id is not null then
    select value into v_secret from app_secrets where key = 'ads_cron_secret';
    perform net.http_post(
      url := 'https://rrkhkhgdxhmogxxtbvyt.supabase.co/functions/v1/meta-capi',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := jsonb_build_object('order_id', new.id),
      timeout_milliseconds := 30000
    );
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists orders_capi_paid on public.orders;
create trigger orders_capi_paid after update of order_status on public.orders for each row execute function public.trg_orders_capi_paid();
