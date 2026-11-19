-- Wallet to wallet: the sender pays a send fee, the receiver pays a receive fee (two separate platform fees).
alter table public.platform_fees drop constraint if exists platform_fees_kind_check;
alter table public.platform_fees add constraint platform_fees_kind_check check (kind in ('deposit', 'transfer', 'wallet', 'credit', 'wallet_send', 'wallet_receive'));
alter table public.fee_ledger drop constraint if exists fee_ledger_kind_check;
alter table public.fee_ledger add constraint fee_ledger_kind_check check (kind in ('deposit', 'transfer', 'wallet', 'credit', 'wallet_send', 'wallet_receive'));
-- Starting values mirror the transfer fee (sender) and the deposit fee (receiver); both are editable in HQ.
insert into public.platform_fees (kind, pct, flat_naira, min_naira, cap_naira)
  select 'wallet_send', pct, flat_naira, min_naira, cap_naira from public.platform_fees where kind = 'transfer' on conflict (kind) do nothing;
insert into public.platform_fees (kind, pct, flat_naira, min_naira, cap_naira)
  select 'wallet_receive', pct, flat_naira, min_naira, cap_naira from public.platform_fees where kind = 'deposit' on conflict (kind) do nothing;

create or replace function public.rv_wallet_send(p_from uuid, p_to uuid, p_amount numeric, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; r record; fee_s numeric; fee_r numeric; sender_pays numeric; receiver_gets numeric; bal numeric; tid uuid := gen_random_uuid(); v_ref text;
begin
  if p_from = p_to then raise exception 'You cannot send money to yourself.'; end if;
  if p_amount is null or p_amount < 100 or p_amount > 5000000 then raise exception 'Send between ₦100 and ₦5,000,000.'; end if;
  select pr.id, pr.role, pr.company_id, pr.media_buyer_id, pr.display_name into s from profiles pr where pr.id = p_from;
  select pr.id, pr.role, pr.company_id, pr.media_buyer_id, pr.display_name into r from profiles pr where pr.id = p_to;
  if s.id is null or r.id is null then raise exception 'Person not found.'; end if;
  if not ((s.role = 'buyer' and s.media_buyer_id is not null) or s.role in ('owner', 'admin')) then raise exception 'Your account cannot send money.'; end if;
  if not ((r.role = 'buyer' and r.media_buyer_id is not null) or r.role in ('owner', 'admin')) then raise exception 'That person cannot receive money yet.'; end if;
  perform pg_advisory_xact_lock(hashtext('wallet:' || case when s.role = 'buyer' then s.media_buyer_id::text else s.company_id::text end));
  fee_s := rv_fee('wallet_send', p_amount);
  fee_r := least(rv_fee('wallet_receive', p_amount), p_amount);
  sender_pays := p_amount + fee_s;
  receiver_gets := p_amount - fee_r;
  bal := rv_wallet_balance_of(p_from);
  if bal < sender_pays then raise exception 'Your wallet has ₦%, which cannot cover ₦%.', to_char(greatest(bal, 0), 'FM999,999,999,990'), to_char(sender_pays, 'FM999,999,999,990'); end if;
  v_ref := 'w2w:' || tid::text;
  insert into wallet_adjustments (company_id, media_buyer_id, amount_naira, reason, ref, note)
  values (s.company_id, case when s.role = 'buyer' then s.media_buyer_id else null end, p_amount, 'sent_to_user', v_ref, 'To ' || coalesce(r.display_name, 'a Revora user'));
  insert into wallet_adjustments (company_id, media_buyer_id, amount_naira, reason, ref, note)
  values (r.company_id, case when r.role = 'buyer' then r.media_buyer_id else null end, -receiver_gets, 'received_from_user', v_ref, 'From ' || coalesce(s.display_name, 'a Revora user'));
  if fee_s > 0 then
    perform rv_take_fee('wallet_send', s.company_id, case when s.role = 'buyer' then s.media_buyer_id else null end, s.id, p_amount, fee_s, v_ref, 'Send fee to ' || coalesce(r.display_name, 'a Revora user'));
  end if;
  if fee_r > 0 then
    -- the receiver's credit above is already net of their fee, so only the revenue line is written
    insert into fee_ledger (kind, company_id, media_buyer_id, user_id, amount_naira, fee_naira, ref)
    values ('wallet_receive', r.company_id, case when r.role = 'buyer' then r.media_buyer_id else null end, r.id, p_amount, fee_r, v_ref) on conflict (kind, ref) do nothing;
  end if;
  insert into wallet_transfers (id, from_user, to_user, from_company, to_company, from_name, to_name, amount_naira, fee_naira, payer, note)
  values (tid, s.id, r.id, s.company_id, r.company_id, s.display_name, r.display_name, p_amount, fee_s + fee_r, 'both', nullif(left(coalesce(p_note, ''), 200), ''));
  perform rv_notify(r.company_id, 'money', 'wallet_received', '💰 You received ₦' || to_char(receiver_gets, 'FM999,999,999,990'),
    coalesce(s.display_name, 'A Revora user') || ' sent you ₦' || to_char(p_amount, 'FM999,999,999,990') || case when fee_r > 0 then ' (₦' || to_char(fee_r, 'FM999,999,999,990') || ' fee)' else '' end || coalesce(': ' || nullif(left(coalesce(p_note, ''), 80), ''), ''),
    '/dashboard_new.html?open=tab:wallet', 'success', jsonb_build_object('transfer_id', tid), 'w2w:' || tid::text, null, r.id, true);
  return jsonb_build_object('ok', true, 'id', tid, 'amount', p_amount, 'fee', fee_s, 'fee_sender', fee_s, 'fee_receiver', fee_r, 'sender_pays', sender_pays, 'receiver_gets', receiver_gets, 'to_name', r.display_name);
end $$;
revoke all on function public.rv_wallet_send(uuid, uuid, numeric, text) from public, anon, authenticated;
