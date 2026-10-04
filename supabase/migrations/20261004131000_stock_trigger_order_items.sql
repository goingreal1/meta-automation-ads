-- A multi-product cart order leaves orders.product_id null (there's no one
-- product to point at) -- order_items is where each of its lines lives, so
-- the stock-adjust trigger needs to walk that table for a cart order, not
-- just read orders.product_id directly. Guarded as an either/or: a
-- single-product order (including a single-line cart, which has both a
-- product_id AND one order_items row for that same line) still only
-- adjusts once, via the product_id branch -- never both, or it would
-- double-decrement.
create or replace function trg_orders_adjust_stock() returns trigger language plpgsql as $$
begin
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
end; $$;
