-- 1) A log of funds received (money a media buyer got for ads), so the daily reports can show "Fund received".
create table if not exists public.fund_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  media_buyer_id uuid references public.media_buyers(id) on delete set null,
  ad_account_id uuid references public.ad_accounts(id) on delete set null,
  amount_naira numeric not null check (amount_naira > 0),
  note text,
  logged_by uuid,
  log_date date not null default ((now() at time zone 'Africa/Lagos')::date),
  created_at timestamptz not null default now()
);
create index if not exists fund_logs_company_date on public.fund_logs (company_id, log_date);
alter table public.fund_logs enable row level security;
create policy fund_logs_read on public.fund_logs for select using (
  company_id = current_company_id() and (
    current_user_role() = any (array['owner','admin'])
    or media_buyer_id = (select media_buyer_id from public.profiles where id = auth.uid())));
create policy fund_logs_write on public.fund_logs for insert with check (
  company_id = current_company_id() and logged_by = auth.uid() and (
    current_user_role() = any (array['owner','admin'])
    or media_buyer_id = (select media_buyer_id from public.profiles where id = auth.uid())));
create policy fund_logs_delete on public.fund_logs for delete using (
  company_id = current_company_id() and (current_user_role() = any (array['owner','admin']) or logged_by = auth.uid()));

-- 2) A media buyer can send money from their OWN held balance to Meta (and only to Meta). Those sends come out of the buyer's wallet, not the company funding wallet.
alter table public.fund_requests add column if not exists paid_from text not null default 'company' check (paid_from in ('company','buyer'));

create or replace function public.company_wallet_balance(p_company uuid)
 returns numeric language sql stable security definer set search_path to 'public' as $function$
  select coalesce((select sum(amount_naira) from payments where company_id = p_company and status = 'confirmed' and media_buyer_id is null and source = 'admin_topup'), 0)
       - coalesce((select sum(amount_naira) from fund_requests where company_id = p_company and paid_from = 'company' and status in ('approved','transferred')), 0)
       - coalesce((select sum(amount_naira) from admin_withdrawals where company_id = p_company and status = 'sent'), 0)
       - public.managed_billed_spend(p_company);
$function$;

create or replace function public.buyer_wallet_balance(p_buyer uuid)
 returns numeric language sql stable security definer set search_path to 'public' as $function$
  select coalesce((select sum(amount_naira) from public.wallet_topups where media_buyer_id = p_buyer and status = 'confirmed'), 0)
       - coalesce((select sum(amount_naira) from public.fund_requests where media_buyer_id = p_buyer and paid_from = 'buyer' and status in ('approved','transferred')), 0)
       - public.buyer_billed_spend(p_buyer);
$function$;
