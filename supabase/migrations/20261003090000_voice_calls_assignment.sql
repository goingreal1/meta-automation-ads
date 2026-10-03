-- Escalations (voice_calls.needs_human) sat in a single shared pool with no
-- owner -- any customer_care rep could resolve any of them, but there was
-- no way to tell who actually handled which one, and no way for a rep to
-- "claim" one as theirs before working it. Adds a self-claim assignment,
-- mirroring how an order gets a delivery_agent_id: the queue stays shared
-- (anyone with access can still see and claim unassigned ones), but once
-- claimed it's visibly someone's, and a rep can now see their own tally.

alter table voice_calls add column if not exists assigned_to uuid references profiles(id);
create index if not exists voice_calls_assigned_to_idx on voice_calls(assigned_to);
