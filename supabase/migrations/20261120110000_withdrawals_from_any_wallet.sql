-- Withdrawals to a bank account (or to Meta) can now come from a media buyer's wallet as well as the company wallet.
alter table public.admin_withdrawals add column if not exists media_buyer_id uuid references public.media_buyers(id) on delete set null;
alter table public.admin_withdrawals drop constraint if exists admin_withdrawals_status_check;
alter table public.admin_withdrawals add constraint admin_withdrawals_status_check check (status in ('pending', 'sent', 'failed'));

-- A withdrawal that is waiting on the bank still holds its money.
create or replace function public.company_wallet_balance(p_company uuid)
 returns numeric language sql stable security definer set search_path to 'public' as $function$
  select coalesce((select sum(amount_naira) from payments where company_id = p_company and status = 'confirmed' and media_buyer_id is null and source = 'admin_topup'), 0)
       - coalesce((select sum(amount_naira) from fund_requests where company_id = p_company and paid_from = 'company' and status in ('approved','transferred')), 0)
       - coalesce((select sum(amount_naira) from admin_withdrawals where company_id = p_company and media_buyer_id is null and status in ('pending','sent')), 0)
       - public.managed_billed_spend(p_company);
$function$;

create or replace function public.buyer_wallet_balance(p_buyer uuid)
 returns numeric language sql stable security definer set search_path to 'public' as $function$
  select coalesce((select sum(amount_naira) from public.wallet_topups where media_buyer_id = p_buyer and status = 'confirmed'), 0)
       - coalesce((select sum(amount_naira) from public.fund_requests where media_buyer_id = p_buyer and paid_from = 'buyer' and status in ('approved','transferred')), 0)
       - coalesce((select sum(amount_naira) from public.admin_withdrawals where media_buyer_id = p_buyer and status in ('pending','sent')), 0)
       - public.buyer_billed_spend(p_buyer);
$function$;

-- Reserve the money before the bank is asked, under a lock, so two taps can never spend the same naira.
create or replace function public.rv_withdraw_reserve(p_user uuid, p_amount numeric, p_fee numeric, p_acct text, p_bank_code text, p_bank_name text, p_acct_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare pr record; bal numeric; wid uuid;
begin
  select role, company_id, media_buyer_id into pr from profiles where id = p_user;
  if not found then raise exception 'Person not found.'; end if;
  if not ((pr.role = 'buyer' and pr.media_buyer_id is not null) or pr.role in ('owner', 'admin')) then raise exception 'Your account cannot withdraw.'; end if;
  perform pg_advisory_xact_lock(hashtext('wallet:' || case when pr.role = 'buyer' then pr.media_buyer_id::text else pr.company_id::text end));
  bal := rv_wallet_balance_of(p_user);
  if bal < p_amount + p_fee then raise exception 'Your wallet has ₦%, which cannot cover ₦% plus the ₦% fee.', to_char(greatest(bal, 0), 'FM999,999,999,990'), to_char(p_amount, 'FM999,999,999,990'), to_char(p_fee, 'FM999,999,999,990'); end if;
  insert into admin_withdrawals (company_id, media_buyer_id, amount_naira, destination_account_number, destination_bank_code, destination_bank_name, destination_account_name, status, created_by)
  values (pr.company_id, case when pr.role = 'buyer' then pr.media_buyer_id else null end, p_amount, p_acct, p_bank_code, p_bank_name, p_acct_name, 'pending', p_user) returning id into wid;
  return wid;
end $$;
revoke all on function public.rv_withdraw_reserve(uuid, numeric, numeric, text, text, text, text) from public, anon, authenticated;

-- If the bank sends a transfer back, the fee goes back with it.
create or replace function public.rv_refund_fee(p_kind text, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from wallet_adjustments where ref = p_ref and reason = p_kind || '_fee';
  delete from fee_ledger where kind = p_kind and ref = p_ref;
end $$;
revoke all on function public.rv_refund_fee(text, text) from public, anon, authenticated;
