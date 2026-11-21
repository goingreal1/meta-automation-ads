-- Housing: tour requests.
-- A visitor books a free tour of a property (fixed slots), BEFORE applying. Tours are saved here,
-- shown in the CRM (housing_tours_list / housing_tour_update) and push a notification to the owner.
-- Purely additive: one new table, one widened CHECK on housing_events, one notification trigger.
-- Slot settings live on the project: products.housing_settings.tour = { "slots": ["10:00","12:00","14:00","16:00"],
--   "days": [0,1,2,3,4,5,6], "advance_days": 14, "capacity": 2 }  (all optional, defaults are used when missing).

create sequence if not exists tour_ref_seq;

create table if not exists public.tours (
  id uuid default gen_random_uuid() primary key,
  ref text not null default ('TOUR-' || lpad(nextval('tour_ref_seq')::text, 5, '0')),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete restrict,
  site_id uuid,
  site_page_id uuid,
  visitor_name text not null,
  visitor_phone text,
  visitor_email text,
  tour_date date not null,          -- the day, as the property's local calendar day
  tour_time text not null,          -- "HH:MM" 24h, one of the project's fixed slots
  notes text,
  status text not null default 'requested',
  possible_duplicate boolean not null default false,
  event_id text,
  fbclid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tours_ref_key unique (ref),
  constraint tours_event_id_key unique (event_id),
  constraint tours_status_check check (status in ('requested', 'confirmed', 'completed', 'no_show', 'cancelled')),
  constraint tours_time_fmt check (tour_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint tours_contact_check check (visitor_phone is not null or visitor_email is not null)
);

create index if not exists tours_company_idx on public.tours (company_id, created_at desc);
create index if not exists tours_slot_idx on public.tours (property_id, tour_date, tour_time) where status in ('requested', 'confirmed');

alter table public.tours enable row level security;
drop policy if exists tours_company_all on public.tours;
create policy tours_company_all on public.tours as permissive for all to public
  using (company_id = current_company_id()) with check (company_id = current_company_id());
-- Visitors never touch this table directly: public pages go through the mcp-housing function (service role).

-- Let housing_events count tour requests (keep every existing value).
alter table public.housing_events drop constraint if exists housing_events_event_check;
alter table public.housing_events add constraint housing_events_event_check
  check (event = any (array['property_view', 'application_start', 'application_submit', 'fee_paid', 'tour_request']::text[]));

-- Tell the owner (bell + phone push) when a tour is requested. Same helper as new orders and leads.
create or replace function public.trg_notify_tour() returns trigger language plpgsql security definer set search_path = public as $$
declare t text;
begin
  select title into t from properties where id = new.property_id;
  perform rv_notify(
    new.company_id, 'leads', 'tour_new',
    'New tour request · ' || coalesce(nullif(trim(new.visitor_name), ''), 'Someone'),
    concat_ws(' · ', t, to_char(new.tour_date, 'Dy Mon DD') || ' ' || new.tour_time, nullif(trim(coalesce(new.visitor_phone, '')), '')),
    '/dashboard_new.html?open=tab:orders', 'info',
    jsonb_build_object('tour_id', new.id, 'ref', new.ref),
    'tour:' || new.id);
  return new;
exception when others then return new;   -- a notification problem must never block a booking
end $$;
revoke all on function public.trg_notify_tour() from public, anon, authenticated;
drop trigger if exists notify_tour on public.tours;
create trigger notify_tour after insert on public.tours for each row execute function public.trg_notify_tour();
