-- Online payments for orders (Paystack checkout). The customer pays, Revora credits the seller's wallet with the sale minus Paystack's charge and Revora's fee.
alter table public.products add column if not exists accept_online boolean not null default false;   -- the seller turned on "customers can pay online"
alter table public.orders add column if not exists payment_status text;            -- null (not an online order) | pending | paid
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists paystack_reference text;
alter table public.orders add column if not exists platform_fee_naira numeric;
alter table public.orders add column if not exists paystack_fee_naira numeric;
alter table public.orders add column if not exists seller_net_naira numeric;
create unique index if not exists orders_paystack_reference on public.orders (paystack_reference) where paystack_reference is not null;

alter table public.platform_fees drop constraint if exists platform_fees_kind_check;
alter table public.platform_fees add constraint platform_fees_kind_check check (kind = any (array['deposit','transfer','wallet','credit','wallet_send','wallet_receive','online_sale']));
alter table public.fee_ledger drop constraint if exists fee_ledger_kind_check;
alter table public.fee_ledger add constraint fee_ledger_kind_check check (kind = any (array['deposit','transfer','wallet','credit','wallet_send','wallet_receive','paystack_cost','online_sale']));
insert into public.platform_fees (kind, enabled, pct, flat_naira, min_naira, cap_naira, payer) values ('online_sale', true, 2, 0, 50, 0, 'receiver') on conflict (kind) do nothing;

-- Called once Paystack confirms the payment. Safe to call twice for the same payment. Credits the company wallet (a negative adjustment raises it).
create or replace function public.rv_credit_online_sale(p_order uuid, p_reference text, p_gross numeric, p_paystack_fee numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; fee numeric; net numeric; v_ref text := 'sale:' || p_reference;
begin
  select id, company_id, payment_status, order_value_naira, customer_name, product_name into o from orders where id = p_order for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'order not found'); end if;
  if o.payment_status = 'paid' then return jsonb_build_object('ok', true, 'already', true); end if;
  if o.company_id is null then return jsonb_build_object('ok', false, 'error', 'order has no business'); end if;
  fee := rv_fee('online_sale', p_gross);
  net := greatest(p_gross - coalesce(p_paystack_fee, 0) - fee, 0);
  insert into wallet_adjustments (company_id, media_buyer_id, amount_naira, reason, ref, note)
  values (o.company_id, null, -net, 'online_sale', v_ref, 'Online sale: ' || coalesce(o.product_name, 'order') || ' (' || coalesce(o.customer_name, 'customer') || ')');
  if fee > 0 then
    insert into fee_ledger (kind, company_id, media_buyer_id, user_id, amount_naira, fee_naira, ref)
    values ('online_sale', o.company_id, null, null, p_gross, fee, v_ref) on conflict (kind, ref) do nothing;
  end if;
  update orders set payment_status = 'paid', paid_at = now(), paystack_reference = coalesce(paystack_reference, p_reference),
         platform_fee_naira = fee, paystack_fee_naira = coalesce(p_paystack_fee, 0), seller_net_naira = net where id = o.id;
  perform rv_notify(o.company_id, 'money', 'online_sale', '💰 Online sale ₦' || to_char(p_gross, 'FM999,999,999,990'),
    coalesce(o.customer_name, 'A customer') || ' paid for ' || coalesce(o.product_name, 'an order') || '. ₦' || to_char(net, 'FM999,999,999,990') || ' is now in your wallet (after Paystack and Revora fees).',
    '/dashboard_new.html?open=tab:orders', 'success', jsonb_build_object('order_id', o.id), v_ref, null, null, true);
  return jsonb_build_object('ok', true, 'gross', p_gross, 'fee', fee, 'paystack_fee', coalesce(p_paystack_fee, 0), 'net', net);
end $$;
revoke all on function public.rv_credit_online_sale(uuid, text, numeric, numeric) from public, anon, authenticated;
