-- handle-whatsapp-reply's conversation lookup used .maybeSingle(), which
-- errors out (not just returns null) when MORE than one row matches -- that
-- error was silently dropped, so once two conversations existed for the same
-- (phone, buyer_whatsapp_number_id), every later message looked like "no
-- conversation found" and created yet another new one. Confirmed live: one
-- customer's single ongoing chat (phone 2348108554324) had split into 5
-- separate conversation rows this way before the edge function fix below
-- could be deployed.
--
-- The original trigger was a race: two inbound messages arrived close enough
-- together that two webhook deliveries both saw "not found" before either
-- insert committed. Merges the fallout back into one conversation (the row
-- that carries the real ad attribution).
--
-- DELETE on conversations/messages has repeatedly timed out in this project
-- (unexplained -- not a lock or an unindexed FK, confirmed via pg_stat_activity
-- and pg_indexes) so the duplicates are tombstoned (current_state='MERGED',
-- buyer_whatsapp_number_id cleared) rather than removed. The dashboard's
-- Conversations query filters out current_state=MERGED.

do $$
declare
  canonical_id uuid := '0f6ba1bc-ef39-4eb6-bcc1-7c62b8641b5b'; -- has the real ad_id/ctwa_clid attribution
  dup_ids uuid[] := array[
    '639286e4-bc15-42ea-a792-88ec0a7fbe12',
    '83667f9f-4cf7-43a3-8e8b-25ba1370904a',
    '54ab0397-0231-4a7e-9c0c-1001a34a88ca',
    '51644b30-35c2-4204-982d-3cc742b94ae1'
  ];
begin
  update messages set conversation_id = canonical_id where conversation_id = any(dup_ids);

  update conversations c
  set last_message_at = m.max_at, unread_count = 0
  from (select max(created_at) as max_at from messages where conversation_id = canonical_id) m
  where c.id = canonical_id;

  -- Clear the (phone, buyer_whatsapp_number_id) pairing on the tombstones so
  -- they don't collide with the canonical row under the unique constraint
  -- below (a plain unique constraint allows unlimited NULLs).
  update conversations
  set current_state = 'MERGED', buyer_whatsapp_number_id = null
  where id = any(dup_ids);
end $$;

-- Only restricts rows where buyer_whatsapp_number_id is actually set (a plain
-- unique constraint already allows unlimited NULLs) -- exactly the rows
-- logInboundMessage's insert touches. Older meta_click_to_whatsapp-era
-- conversations (buyer_whatsapp_number_id null) are untouched by this.
alter table conversations
  add constraint conversations_phone_number_unique unique (phone, buyer_whatsapp_number_id);
