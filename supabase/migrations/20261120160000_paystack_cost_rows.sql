-- Cost-only rows: a send/withdrawal Paystack charged us for, where Revora took no fee (fee off, or sent before fees existed).
alter table public.fee_ledger drop constraint if exists fee_ledger_kind_check;
alter table public.fee_ledger add constraint fee_ledger_kind_check check (kind = any (array['deposit','transfer','wallet','credit','wallet_send','wallet_receive','paystack_cost']));

create or replace function public.rv_fee_ledger_cost() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(new.paystack_cost_naira, 0) = 0 then
    if new.kind in ('transfer', 'paystack_cost') then
      new.paystack_cost_naira := rv_paystack_transfer_cost(new.amount_naira);
    elsif new.kind = 'deposit' then
      select coalesce(max(paystack_fee_naira), 0) into new.paystack_cost_naira from wallet_topups where reference = new.ref;
    end if;
  end if;
  return new;
end $$;

create or replace function public.rv_log_paystack_cost(p_company uuid, p_buyer uuid, p_user uuid, p_amount numeric, p_ref text) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if exists (select 1 from fee_ledger where kind = 'transfer' and ref = p_ref) then return; end if;
  insert into fee_ledger (kind, company_id, media_buyer_id, user_id, amount_naira, fee_naira, ref)
  values ('paystack_cost', p_company, p_buyer, p_user, p_amount, 0, p_ref) on conflict (kind, ref) do nothing;
end $$;

-- Backfill: past sent withdrawals and past sends to Meta that never got a ledger row.
insert into fee_ledger (kind, company_id, media_buyer_id, amount_naira, fee_naira, ref, created_at)
select 'paystack_cost', w.company_id, w.media_buyer_id, w.amount_naira, 0, w.id::text, coalesce(w.sent_at, w.created_at)
from admin_withdrawals w where w.status = 'sent' and not exists (select 1 from fee_ledger f where f.kind in ('transfer','paystack_cost') and f.ref = w.id::text)
on conflict (kind, ref) do nothing;

insert into fee_ledger (kind, company_id, media_buyer_id, amount_naira, fee_naira, ref, created_at)
select 'paystack_cost', r.company_id, case when r.paid_from = 'buyer' then r.media_buyer_id else null end, r.amount_naira, 0, r.id::text, coalesce(r.decided_at, now())
from fund_requests r where r.status = 'transferred' and not exists (select 1 from fee_ledger f where f.kind in ('transfer','paystack_cost') and f.ref = r.id::text)
on conflict (kind, ref) do nothing;
