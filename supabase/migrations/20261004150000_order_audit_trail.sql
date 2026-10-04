-- Order audit trail. Confirmed real gap: every status change, rider
-- reassignment, or buyer reassignment just overwrote the row -- "who
-- changed this to cancelled, and from what" had no answer once more than
-- one person touches the dashboard.
--
-- order_events is an append-only log, written automatically by a trigger
-- (not by application code remembering to log it) on every real UPDATE to
-- orders -- so there's no write path left to forget, same reasoning as the
-- customer_id-resolving trigger. changed_by is auth.uid(), which is
-- actually available here: every dashboard write already goes through
-- supabaseClient with the signed-in user's own JWT, not a service-role
-- edge function. A null changed_by means an automated change (the rider
-- auto-assignment sweep, the AI confirmation webhook), not a person.

create table if not exists order_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  order_id uuid not null references orders(id),
  changed_by uuid references profiles(id),
  field_name text not null,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_id_idx on order_events(order_id, created_at desc);

alter table order_events enable row level security;
-- Read-only, and only for the roles who'd actually ask "who changed this" --
-- a buyer/rider doesn't need a change-history view, and orders' own RLS
-- already scopes what they can see of the order itself.
create policy order_events_company_scoped on order_events for select using (
  company_id = current_company_id()
  and current_user_role() in ('owner','admin','customer_care')
);

-- security definer so the trigger's own insert isn't blocked by the
-- read-only policy above -- a controlled, fixed-shape audit write, not
-- user-supplied SQL, so bypassing RLS for it is the standard, safe pattern.
create or replace function trg_orders_audit_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
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

create trigger orders_audit_log after update on orders
  for each row execute function trg_orders_audit_log();
