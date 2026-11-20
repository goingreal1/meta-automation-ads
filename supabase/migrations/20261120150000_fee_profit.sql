-- Profit tracking: what Paystack costs us on each fee we take, so "Revora fee" and "profit after Paystack" are both visible.
alter table public.fee_ledger add column if not exists paystack_cost_naira numeric not null default 0;

-- Paystack transfer tariff (NGN): 10 up to 5,000; 25 up to 50,000; 50 above; plus 50 stamp duty from 10,000 up.
create or replace function public.rv_paystack_transfer_cost(p_amount numeric) returns numeric language sql immutable as $$
  select (case when p_amount <= 5000 then 10 when p_amount <= 50000 then 25 else 50 end) + (case when p_amount >= 10000 then 50 else 0 end)
$$;

create or replace function public.rv_fee_ledger_cost() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(new.paystack_cost_naira, 0) = 0 then
    if new.kind = 'transfer' then
      new.paystack_cost_naira := rv_paystack_transfer_cost(new.amount_naira);
    elsif new.kind = 'deposit' then
      select coalesce(max(paystack_fee_naira), 0) into new.paystack_cost_naira from wallet_topups where reference = new.ref;
    end if; -- credit, wallet, wallet_send, wallet_receive are inside Revora: no Paystack cost
  end if;
  return new;
end $$;
drop trigger if exists trg_fee_ledger_cost on public.fee_ledger;
create trigger trg_fee_ledger_cost before insert on public.fee_ledger for each row execute function public.rv_fee_ledger_cost();

-- Backfill existing rows
update public.fee_ledger f set paystack_cost_naira = rv_paystack_transfer_cost(f.amount_naira) where f.kind = 'transfer' and f.paystack_cost_naira = 0;
update public.fee_ledger f set paystack_cost_naira = coalesce((select max(t.paystack_fee_naira) from wallet_topups t where t.reference = f.ref), 0) where f.kind = 'deposit' and f.paystack_cost_naira = 0;

create or replace view public.revora_profit as
  select created_at, kind, company_id, media_buyer_id, amount_naira, fee_naira as revora_fee, paystack_cost_naira as paystack_cost, fee_naira - paystack_cost_naira as profit, ref from public.fee_ledger;
