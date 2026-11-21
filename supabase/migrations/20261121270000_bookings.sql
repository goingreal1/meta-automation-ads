-- Offer type: bookings (salon, spa, clinic, consultation...). A product of type 'booking' has services, weekly hours and a capacity; customers pick a service, date and time.
alter table public.products drop constraint if exists products_product_type_check;
alter table public.products add constraint products_product_type_check check (product_type = any (array['physical','housing','booking','digital']));
alter table public.products add column if not exists booking_settings jsonb;
-- booking_settings: {services:[{id,name,duration_min,price}], days:[1..6,0], open:"09:00", close:"18:00", step_min:30, capacity:1, advance_days:30, lead_hours:2, utc_offset_min:60}

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  product_id uuid,
  order_id uuid,
  service_name text not null,
  duration_min int not null default 60,
  price_naira numeric not null default 0,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  customer_name text,
  customer_phone text,
  customer_email text,
  notes text,
  status text not null default 'confirmed' check (status in ('pending_payment','confirmed','completed','cancelled','no_show')),
  hold_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bookings_company_time on public.bookings (company_id, starts_at);
create index if not exists bookings_product_time on public.bookings (product_id, starts_at);
create unique index if not exists bookings_order on public.bookings (order_id) where order_id is not null;
alter table public.bookings enable row level security;
drop policy if exists bookings_read on public.bookings;
create policy bookings_read on public.bookings for select using (company_id = (select company_id from public.profiles where id = auth.uid()));
drop policy if exists bookings_update on public.bookings;
create policy bookings_update on public.bookings for update
  using (company_id = (select company_id from public.profiles where id = auth.uid()) and (select role from public.profiles where id = auth.uid()) in ('owner','admin','buyer','customer_care'))
  with check (company_id = (select company_id from public.profiles where id = auth.uid()));

-- What the order form needs to hide taken times: only start and end times of live bookings of one booking product, no names or numbers.
create or replace function public.rv_booking_taken(p_product uuid, p_from timestamptz, p_to timestamptz)
returns table(starts_at timestamptz, ends_at timestamptz) language sql stable security definer set search_path to 'public' as $$
  select b.starts_at, b.ends_at from bookings b
  where b.product_id = p_product and b.starts_at >= p_from and b.starts_at < p_to
    and (b.status in ('confirmed','completed') or (b.status = 'pending_payment' and b.hold_until > now()))
    and exists (select 1 from products p where p.id = p_product and p.product_type = 'booking' and coalesce(p.is_active, true))
  limit 500
$$;
grant execute on function public.rv_booking_taken(uuid, timestamptz, timestamptz) to anon, authenticated;

-- Creates a booking only if the time is still free (several customers can tap at once: one lock per booking product).
create or replace function public.rv_create_booking(p_company uuid, p_product uuid, p_order uuid, p_service text, p_duration int, p_price numeric, p_start timestamptz, p_end timestamptz,
  p_name text, p_phone text, p_email text, p_notes text, p_status text, p_hold_minutes int, p_capacity int)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare n int; bid uuid;
begin
  perform pg_advisory_xact_lock(hashtext('booking:' || p_product::text));
  select count(*) into n from bookings b where b.product_id = p_product and b.starts_at < p_end and b.ends_at > p_start
    and (b.status in ('confirmed','completed') or (b.status = 'pending_payment' and b.hold_until > now()));
  if n >= greatest(coalesce(p_capacity, 1), 1) then raise exception 'slot_taken'; end if;
  insert into bookings (company_id, product_id, order_id, service_name, duration_min, price_naira, starts_at, ends_at, customer_name, customer_phone, customer_email, notes, status, hold_until)
  values (p_company, p_product, p_order, left(p_service, 120), p_duration, p_price, p_start, p_end, left(p_name, 120), left(p_phone, 40), left(p_email, 160), left(p_notes, 500), p_status,
          case when p_status = 'pending_payment' then now() + make_interval(mins => coalesce(p_hold_minutes, 20)) else null end) returning id into bid;
  return bid;
end $$;
revoke all on function public.rv_create_booking(uuid, uuid, uuid, text, int, numeric, timestamptz, timestamptz, text, text, text, text, text, int, int) from public, anon, authenticated;
