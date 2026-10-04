-- Stuck-order follow-up. place-order-call only ever places ONE automatic
-- call per order -- confirmed real: a pending order whose call attempt
-- didn't land (no answer, declined, or the dial itself failed) just sat
-- there forever, with no retry and no follow-up of any kind.
--
-- stuck-order-followup (edge function, pg_cron every 30 min) now does:
--   pending order, call attempt concluded (done/failed, not confirmed),
--   >= 2h since ordered / since the last follow-up step
--     attempt 0 -> queue a real second call (place-order-call, force)
--     attempt 1 (retry also didn't land) -> stop auto-calling, flag the
--       call for a human (the same needs_human mechanism the Support
--       Queue / "AI calls needing a human" panel already watches) and
--       send the customer a WhatsApp nudge

alter table orders add column if not exists followup_attempts int not null default 0;
alter table orders add column if not exists last_followup_at timestamptz;
create index if not exists orders_followup_candidates_idx on orders(order_status, ordered_at) where order_status = 'pending';
