-- Cart support: a multi-product shop checkout needs more than one line per
-- order. orders stays the order-level record (customer, delivery, status,
-- ad attribution, CAPI) exactly as every existing hot-path function
-- (receive-order, auto-assign-delivery, place-order-call, commission calcs)
-- already relies on -- none of that changes. order_items is purely additive:
-- a single-product checkout (order.html today) never writes to it; a cart
-- checkout (shop.html) writes one row per distinct product alongside the
-- usual orders row, which keeps aggregated totals (quantity, order_value_naira,
-- product_name) so every existing report keeps working unmodified.
create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  company_id uuid references companies(id),
  product_id uuid references products(id),
  product_name text not null,
  quantity integer not null default 1,
  unit_price_naira numeric not null default 0,
  line_total_naira numeric not null default 0,
  tier_id uuid references product_tiers(id),
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_idx on order_items(order_id);
create index if not exists order_items_company_idx on order_items(company_id);
create index if not exists order_items_product_idx on order_items(product_id);

alter table order_items enable row level security;

drop policy if exists "order_items_company_all" on order_items;
create policy "order_items_company_all" on order_items for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

alter table order_items alter column company_id set default current_company_id();
