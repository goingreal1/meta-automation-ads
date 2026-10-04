-- Unified customer record. Confirmed real: the same phone number showed up
-- as "08104965538" on an order and "8104965538" on that same person's
-- earlier website lead -- two different strings, invisible as one customer.
--
-- conversation_customers (née beoliv_customers, from before multi-tenancy)
-- already *is* almost this table -- conversations and the legacy
-- beoliv_orders already point at it -- it just had a company-blind global
-- UNIQUE(phone) (a real cross-tenant collision risk) and nothing else
-- linked to it. This makes it the one real hub instead of building a
-- second, competing table.

-- Same normalization as _shared/safety.ts's toE164NG, so a phone collected
-- anywhere in the app (order form, WhatsApp, a DB trigger) resolves to the
-- exact same identity.
create or replace function normalize_ng_phone(raw text) returns text
language plpgsql immutable as $$
declare d text;
begin
  if raw is null then return null; end if;
  d := regexp_replace(raw, '\D', '', 'g');
  if left(d, 1) = '0' and length(d) = 11 then d := '234' || substring(d from 2); end if;
  if length(d) = 10 and d ~ '^[789]' then d := '234' || d; end if;
  if d !~ '^234[789]\d{9}$' then return null; end if;
  return '+' || d;
end; $$;

-- Normalize what's there before the constraint is scoped per company --
-- otherwise two different raw spellings of the same number could now
-- collide across companies under the new unique index.
update conversation_customers set phone = normalize_ng_phone(phone) where normalize_ng_phone(phone) is not null;

alter table conversation_customers drop constraint if exists beoliv_customers_phone_key;
create unique index if not exists conversation_customers_company_phone_key on conversation_customers(company_id, phone);

-- The one true link, added to every other table that collects a phone
-- number. voice_calls doesn't need its own -- it already reaches a customer
-- through orders.id = voice_calls.order_id.
alter table orders add column if not exists customer_id uuid references conversation_customers(id);
alter table website_leads add column if not exists customer_id uuid references conversation_customers(id);
alter table leads add column if not exists customer_id uuid references conversation_customers(id);
create index if not exists orders_customer_id_idx on orders(customer_id);
create index if not exists website_leads_customer_id_idx on website_leads(customer_id);
create index if not exists leads_customer_id_idx on leads(customer_id);

-- Resolves (or creates) the one customer row for a phone number, filling in
-- any blank name/city/state/address without overwriting richer data an
-- earlier touchpoint already captured. Returns null (never errors the
-- insert) when the phone doesn't normalize -- a messy phone shouldn't block
-- someone's order, it just won't be linked to a customer yet.
create or replace function resolve_customer_id(
  p_company_id uuid, p_raw_phone text, p_name text default null,
  p_city text default null, p_state text default null, p_address text default null
) returns uuid language plpgsql as $$
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
end; $$;

-- A BEFORE INSERT/UPDATE trigger per source table instead of touching every
-- write path (receive-order, submit-website-lead, meta-lead-webhook, ...):
-- this resolves correctly no matter which function writes the row, so there
-- is no edge function left to forget -- the exact failure mode that made
-- company_id go missing from the Meta sync pipeline earlier this project.
create or replace function trg_orders_resolve_customer() returns trigger language plpgsql as $$
begin
  new.customer_id := resolve_customer_id(new.company_id, new.customer_phone, new.customer_name, new.customer_city, new.customer_state, new.customer_address);
  return new;
end; $$;
drop trigger if exists orders_resolve_customer on orders;
create trigger orders_resolve_customer before insert or update of customer_phone on orders
  for each row execute function trg_orders_resolve_customer();

create or replace function trg_website_leads_resolve_customer() returns trigger language plpgsql as $$
begin
  new.customer_id := resolve_customer_id(new.company_id, new.phone, new.name);
  return new;
end; $$;
drop trigger if exists website_leads_resolve_customer on website_leads;
create trigger website_leads_resolve_customer before insert or update of phone on website_leads
  for each row execute function trg_website_leads_resolve_customer();

create or replace function trg_leads_resolve_customer() returns trigger language plpgsql as $$
begin
  new.customer_id := resolve_customer_id(new.company_id, new.phone, new.full_name);
  return new;
end; $$;
drop trigger if exists leads_resolve_customer on leads;
create trigger leads_resolve_customer before insert or update of phone on leads
  for each row execute function trg_leads_resolve_customer();

-- Backfill what already existed -- triggers only fire on future writes.
update orders set customer_phone = customer_phone where customer_id is null;
update website_leads set phone = phone where customer_id is null;
update leads set phone = phone where customer_id is null;
