-- Stock tracking. Confirmed real gap: nothing tracked stock-on-hand for a
-- physical product -- running ads on something actually out of stock, and
-- finding out only when delivery fails, was a completely avoidable failure
-- mode. Also fixed along the way: orders.product_id was never stored even
-- though receive-order already resolves product_id to look up company_id
-- -- the decrement below needs that link, and it's a real gap on its own
-- (order.product_name is free text with no FK to the actual product row).

alter table products add column if not exists stock_on_hand integer; -- null = not tracked for this product
alter table products add column if not exists low_stock_threshold integer not null default 10;

alter table orders add column if not exists product_id uuid references products(id);
create index if not exists orders_product_id_idx on orders(product_id);

-- Best-effort backfill for existing orders (matches by name within the same
-- company) -- receive-order now stores product_id directly going forward.
update orders o set product_id = p.id
from products p
where o.product_id is null
  and o.company_id = p.company_id
  and lower(trim(o.product_name)) = lower(trim(p.product_name));

-- Manual decrement/increment (the gaps doc's own suggested scope) rather
-- than a full stock-movement ledger: delivered decrements by the order's
-- quantity, moving back OFF delivered (e.g. a return) restores it. Only
-- touches products where stock_on_hand is actually set -- an untracked
-- product's stock stays null, never drifts to a number nobody entered.
create or replace function trg_orders_adjust_stock() returns trigger language plpgsql as $$
begin
  if new.product_id is not null then
    if new.order_status = 'delivered' and old.order_status is distinct from 'delivered' then
      update products set stock_on_hand = stock_on_hand - coalesce(new.quantity, 1)
      where id = new.product_id and stock_on_hand is not null;
    elsif old.order_status = 'delivered' and new.order_status is distinct from 'delivered' then
      update products set stock_on_hand = stock_on_hand + coalesce(new.quantity, 1)
      where id = new.product_id and stock_on_hand is not null;
    end if;
  end if;
  return new;
end; $$;

create trigger orders_adjust_stock after update of order_status on orders
  for each row execute function trg_orders_adjust_stock();
