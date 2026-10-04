-- Package tiers: one order form, several selectable package options (e.g.
-- "1 piece" / "3-piece bundle" / "5-piece bundle"), instead of one fixed
-- per-unit price with only a quantity stepper.

create table if not exists product_tiers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  company_id uuid not null references companies(id),
  label text not null,
  quantity integer not null default 1 check (quantity > 0),
  price_naira numeric not null check (price_naira >= 0),
  badge text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists product_tiers_product_id_idx on product_tiers(product_id, sort_order);

alter table product_tiers enable row level security;
create policy product_tiers_company_all on product_tiers for all using (company_id = current_company_id()) with check (company_id = current_company_id());

-- Fix found while testing this migration: order_events.company_id is NOT
-- NULL, but orders.company_id can legitimately be null (an order whose
-- company couldn't be resolved -- the deliberately safe failure mode from
-- receive-order). Updating both columns in the same statement crashed the
-- audit trigger added in 20261004150000. Skip logging entirely once
-- company_id is null: there's no dashboard that can see the order anyway.
create or replace function trg_orders_audit_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
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
end; $$;
