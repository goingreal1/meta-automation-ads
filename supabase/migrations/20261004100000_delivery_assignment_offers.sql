-- Rider assignment, confirmed missing entirely: orders.delivery_agent_id was a
-- real column nobody ever wrote. This adds the actual offer/accept/decline
-- flow instead of leaving it set by hand.
--
-- Design choice: delivery_agent_id gets set the moment an order is OFFERED
-- to an agent, not only once they accept -- orders_company_scoped RLS
-- already restricts a delivery_agent to rows where delivery_agent_id is
-- theirs, so this is the only way they can see the order to decide on it at
-- all, with zero RLS changes needed. assignment_status tracks where that
-- offer stands; a decline or timeout clears delivery_agent_id back to null
-- so the order is eligible for the next candidate.

alter table orders add column if not exists assignment_status text
  check (assignment_status in ('offered','accepted','declined','expired'));
alter table orders add column if not exists assignment_offered_at timestamptz;
create index if not exists orders_assignment_status_idx on orders(assignment_status) where assignment_status = 'offered';

-- Audit trail (a real gap on its own -- "who was this offered to and when"
-- had no record anywhere) and the thing that stops re-offering an order to
-- an agent who already declined it.
create table if not exists assignment_offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  order_id uuid not null references orders(id),
  delivery_agent_id uuid not null references delivery_agents(id),
  outcome text not null default 'offered' check (outcome in ('offered','accepted','declined','expired')),
  offered_at timestamptz not null default now(),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists assignment_offers_order_idx on assignment_offers(order_id);
create index if not exists assignment_offers_agent_idx on assignment_offers(delivery_agent_id);

alter table assignment_offers enable row level security;
create policy assignment_offers_company_scoped on assignment_offers for all using (
  company_id = current_company_id()
  and (
    current_user_role() in ('owner','admin','customer_care')
    or (current_user_role() = 'delivery_agent' and delivery_agent_id = (select p.delivery_agent_id from profiles p where p.id = auth.uid()))
  )
) with check (company_id = current_company_id());
