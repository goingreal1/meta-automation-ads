-- Duplicate/fraud flag for COD orders. Pay-on-delivery is the default
-- payment method here, and it's exactly the payment method most exposed to
-- junk orders: the same person hitting submit twice, or someone spamming an
-- ad's order form to waste delivery attempts. Nothing caught "same phone,
-- same address, placed again within the hour" before this.
--
-- Flags, never blocks -- a real repeat order (someone reordering) should
-- still go through; it just gets a visible heads-up pill on the Orders tab
-- for a human to glance at before it's confirmed/dispatched.

alter table orders add column if not exists possible_duplicate boolean not null default false;
alter table orders add column if not exists duplicate_of_order_id uuid references orders(id);
create index if not exists orders_dup_check_idx on orders(customer_id, ordered_at) where order_status <> 'cancelled';

-- Folded into the same BEFORE INSERT trigger that resolves customer_id
-- (20261004110000_unified_customer_record.sql) rather than a second
-- trigger, so there's no ordering ambiguity about whether customer_id is
-- already set when the duplicate check runs.
create or replace function trg_orders_resolve_customer() returns trigger language plpgsql as $$
declare v_dup_id uuid;
begin
  new.customer_id := resolve_customer_id(new.company_id, new.customer_phone, new.customer_name, new.customer_city, new.customer_state, new.customer_address);

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
end; $$;
