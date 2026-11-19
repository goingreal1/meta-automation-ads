-- Platform fees (set by Revora for every company), the fee ledger, wallet-to-wallet transfers, and the lookup used to find a person by phone or email.

create table if not exists public.platform_fees (
  kind text primary key check (kind in ('deposit', 'transfer', 'wallet')),
  enabled boolean not null default true,
  pct numeric not null default 0 check (pct >= 0),
  flat_naira numeric not null default 0 check (flat_naira >= 0),
  min_naira numeric not null default 0 check (min_naira >= 0),
  cap_naira numeric not null default 0 check (cap_naira >= 0),
  payer text not null default 'sender' check (payer in ('sender', 'receiver')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.platform_fees (kind, pct, flat_naira, min_naira, cap_naira) values
  ('deposit', 2, 0, 200, 2500), ('transfer', 0, 100, 100, 0), ('wallet', 0.5, 0, 20, 500)
on conflict (kind) do nothing;
alter table public.platform_fees enable row level security;
drop policy if exists platform_fees_read on public.platform_fees;
create policy platform_fees_read on public.platform_fees for select to authenticated using (true);

create or replace function public.rv_fee(p_kind text, p_amount numeric) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare f record; v numeric;
begin
  select * into f from platform_fees where kind = p_kind;
  if not found or not f.enabled or coalesce(p_amount, 0) <= 0 then return 0; end if;
  v := p_amount * f.pct / 100 + f.flat_naira;
  if v < f.min_naira then v := f.min_naira; end if;
  if f.cap_naira > 0 and v > f.cap_naira then v := f.cap_naira; end if;
  return round(v);
end $$;

-- Every fee Revora earns, one line each (HQ reads this for revenue).
create table if not exists public.fee_ledger (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('deposit', 'transfer', 'wallet')),
  company_id uuid,
  media_buyer_id uuid,
  user_id uuid,
  amount_naira numeric not null,
  fee_naira numeric not null,
  ref text not null,
  created_at timestamptz not null default now(),
  unique (kind, ref)
);
create index if not exists fee_ledger_company on public.fee_ledger (company_id, created_at desc);
alter table public.fee_ledger enable row level security;
drop policy if exists fee_ledger_read on public.fee_ledger;
create policy fee_ledger_read on public.fee_ledger for select using (company_id = current_company_id() and current_user_role() = any (array['owner', 'admin']));

-- What a card top-up cost: the amount that lands is amount_naira; the customer is charged more at checkout.
alter table public.wallet_topups add column if not exists charged_naira numeric;
alter table public.wallet_topups add column if not exists paystack_fee_naira numeric not null default 0;
-- Nicer history lines.
alter table public.wallet_adjustments add column if not exists note text;

-- A wallet-to-wallet send between two Revora users (any company).
create table if not exists public.wallet_transfers (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null,
  to_user uuid not null,
  from_company uuid,
  to_company uuid,
  from_name text,
  to_name text,
  amount_naira numeric not null check (amount_naira > 0),
  fee_naira numeric not null default 0,
  payer text not null default 'sender',
  note text,
  created_at timestamptz not null default now()
);
create index if not exists wallet_transfers_from on public.wallet_transfers (from_user, created_at desc);
create index if not exists wallet_transfers_to on public.wallet_transfers (to_user, created_at desc);
alter table public.wallet_transfers enable row level security;
drop policy if exists wallet_transfers_read on public.wallet_transfers;
create policy wallet_transfers_read on public.wallet_transfers for select using (from_user = auth.uid() or to_user = auth.uid());

-- Whose wallet is it? A media buyer has their own; an owner/admin uses the company funding wallet.
create or replace function public.rv_wallet_balance_of(p_user uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare p record;
begin
  select role, company_id, media_buyer_id into p from profiles where id = p_user;
  if not found then return 0; end if;
  if p.role = 'buyer' and p.media_buyer_id is not null then return buyer_wallet_balance(p.media_buyer_id); end if;
  if p.role in ('owner', 'admin') then return company_wallet_balance(p.company_id); end if;
  return 0;
end $$;

-- Take a fee off a wallet (positive adjustment on that wallet) and record it. Safe to call twice for the same ref.
create or replace function public.rv_take_fee(p_kind text, p_company uuid, p_buyer uuid, p_user uuid, p_amount numeric, p_fee numeric, p_ref text, p_note text)
returns numeric language plpgsql security definer set search_path = public as $$
declare got int;
begin
  if coalesce(p_fee, 0) <= 0 then return 0; end if;
  insert into fee_ledger (kind, company_id, media_buyer_id, user_id, amount_naira, fee_naira, ref)
  values (p_kind, p_company, p_buyer, p_user, p_amount, p_fee, p_ref) on conflict (kind, ref) do nothing;
  get diagnostics got = row_count;
  if got = 0 then return 0; end if;
  insert into wallet_adjustments (company_id, media_buyer_id, amount_naira, reason, ref, note)
  values (p_company, p_buyer, p_fee, p_kind || '_fee', p_ref, p_note);
  return p_fee;
end $$;

-- Send money wallet to wallet. One transaction, one lock per sender, so two taps cannot overspend.
create or replace function public.rv_wallet_send(p_from uuid, p_to uuid, p_amount numeric, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; r record; f record; fee numeric; payer text; sender_pays numeric; receiver_gets numeric; bal numeric; tid uuid := gen_random_uuid(); v_ref text;
begin
  if p_from = p_to then raise exception 'You cannot send money to yourself.'; end if;
  if p_amount is null or p_amount < 100 or p_amount > 5000000 then raise exception 'Send between ₦100 and ₦5,000,000.'; end if;
  select pr.id, pr.role, pr.company_id, pr.media_buyer_id, pr.display_name into s from profiles pr where pr.id = p_from;
  select pr.id, pr.role, pr.company_id, pr.media_buyer_id, pr.display_name into r from profiles pr where pr.id = p_to;
  if s.id is null or r.id is null then raise exception 'Person not found.'; end if;
  if not ((s.role = 'buyer' and s.media_buyer_id is not null) or s.role in ('owner', 'admin')) then raise exception 'Your account cannot send money.'; end if;
  if not ((r.role = 'buyer' and r.media_buyer_id is not null) or r.role in ('owner', 'admin')) then raise exception 'That person cannot receive money yet.'; end if;
  perform pg_advisory_xact_lock(hashtext('wallet:' || case when s.role = 'buyer' then s.media_buyer_id::text else s.company_id::text end));
  select * into f from platform_fees where kind = 'wallet';
  fee := rv_fee('wallet', p_amount); payer := coalesce(f.payer, 'sender');
  sender_pays := p_amount + case when payer = 'sender' then fee else 0 end;
  receiver_gets := p_amount - case when payer = 'receiver' then fee else 0 end;
  bal := rv_wallet_balance_of(p_from);
  if bal < sender_pays then raise exception 'Your wallet has ₦% , which cannot cover ₦%.', to_char(greatest(bal, 0), 'FM999,999,999,990'), to_char(sender_pays, 'FM999,999,999,990'); end if;
  v_ref := 'w2w:' || tid::text;
  -- sender: debit the amount (positive adjustment reduces a wallet)
  insert into wallet_adjustments (company_id, media_buyer_id, amount_naira, reason, ref, note)
  values (s.company_id, case when s.role = 'buyer' then s.media_buyer_id else null end, p_amount, 'sent_to_user', v_ref, 'To ' || coalesce(r.display_name, 'a Revora user'));
  -- receiver: credit what they receive (negative adjustment raises a wallet)
  insert into wallet_adjustments (company_id, media_buyer_id, amount_naira, reason, ref, note)
  values (r.company_id, case when r.role = 'buyer' then r.media_buyer_id else null end, -receiver_gets, 'received_from_user', v_ref, 'From ' || coalesce(s.display_name, 'a Revora user'));
  -- the fee comes off whoever pays it
  if fee > 0 then
    if payer = 'sender' then
      perform rv_take_fee('wallet', s.company_id, case when s.role = 'buyer' then s.media_buyer_id else null end, s.id, p_amount, fee, v_ref, 'Fee on send to ' || coalesce(r.display_name, 'a Revora user'));
    else
      -- the receiver's credit above is already net of the fee, so only the revenue line is written
      insert into fee_ledger (kind, company_id, media_buyer_id, user_id, amount_naira, fee_naira, ref)
      values ('wallet', r.company_id, case when r.role = 'buyer' then r.media_buyer_id else null end, r.id, p_amount, fee, v_ref) on conflict (kind, ref) do nothing;
    end if;
  end if;
  insert into wallet_transfers (id, from_user, to_user, from_company, to_company, from_name, to_name, amount_naira, fee_naira, payer, note)
  values (tid, s.id, r.id, s.company_id, r.company_id, s.display_name, r.display_name, p_amount, fee, payer, nullif(left(coalesce(p_note, ''), 200), ''));
  perform rv_notify(r.company_id, 'money', 'wallet_received', '💰 You received ₦' || to_char(receiver_gets, 'FM999,999,999,990'),
    coalesce(s.display_name, 'A Revora user') || ' sent you ₦' || to_char(receiver_gets, 'FM999,999,999,990') || coalesce(': ' || nullif(left(coalesce(p_note, ''), 80), ''), ''),
    '/dashboard_new.html?open=tab:wallet', 'success', jsonb_build_object('transfer_id', tid), 'w2w:' || tid::text, null, r.id, true);
  return jsonb_build_object('ok', true, 'id', tid, 'amount', p_amount, 'fee', fee, 'payer', payer, 'sender_pays', sender_pays, 'receiver_gets', receiver_gets, 'to_name', r.display_name);
end $$;

-- Find a person by phone number or email. Exact match only; returns a masked label so nobody can browse the user list.
create or replace function public.rv_find_user(p_key text, p_exclude uuid)
returns table (user_id uuid, name text, role text, company_name text, hint text)
language plpgsql stable security definer set search_path = public, auth as $$
declare k text := lower(trim(coalesce(p_key, ''))); digits text := regexp_replace(k, '\D', '', 'g'); tail text;
begin
  if length(k) < 6 then return; end if;
  tail := case when length(digits) >= 10 then right(digits, 10) else null end;
  return query
  select pr.id, coalesce(pr.display_name, 'Revora user'), pr.role, c.name,
         case when k like '%@%' then regexp_replace(k, '^(.).*(@.*)$', '\1•••\2') else '••• ' || right(digits, 4) end
  from profiles pr
  left join companies c on c.id = pr.company_id
  left join auth.users u on u.id = pr.id
  where pr.id <> coalesce(p_exclude, '00000000-0000-0000-0000-000000000000')
    and ((pr.role = 'buyer' and pr.media_buyer_id is not null) or pr.role in ('owner', 'admin'))
    and ((k like '%@%' and lower(u.email) = k)
      or (tail is not null and right(regexp_replace(coalesce(pr.whatsapp_number, ''), '\D', '', 'g'), 10) = tail))
  limit 3;
end $$;
revoke all on function public.rv_wallet_send(uuid, uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.rv_find_user(text, uuid) from public, anon, authenticated;
revoke all on function public.rv_take_fee(text, uuid, uuid, uuid, numeric, numeric, text, text) from public, anon, authenticated;
revoke all on function public.rv_wallet_balance_of(uuid) from public, anon, authenticated;
