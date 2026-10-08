alter table public.companies
  add column if not exists plan text not null default 'trial' check (plan in ('trial','media_buyer','business','enterprise','comped')),
  add column if not exists trial_ends_at timestamptz,
  add column if not exists plan_expires_at timestamptz;

-- Everyone already using the product is kept fully unlocked.
update public.companies set plan = 'comped' where trial_ends_at is null and plan = 'trial';

alter table public.companies alter column trial_ends_at set default (now() + interval '7 days');

create table if not exists public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  reference text not null unique,
  plan text not null,
  months int not null,
  amount_naira numeric not null,
  status text not null default 'success',
  paid_at timestamptz not null default now(),
  raw_event jsonb
);
alter table public.billing_payments enable row level security;
create policy billing_payments_select on public.billing_payments for select to authenticated
  using (company_id = (select company_id from public.profiles where id = auth.uid())
         and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','admin')));

create or replace function public.apply_subscription_payment(p_reference text, p_company uuid, p_plan text, p_months int, p_amount numeric, p_raw jsonb)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_exp timestamptz; v_cur timestamptz;
begin
  if p_plan not in ('media_buyer','business') or p_months not in (1,3,6,12) then raise exception 'bad plan or months'; end if;
  insert into billing_payments(company_id, reference, plan, months, amount_naira, raw_event)
    values (p_company, p_reference, p_plan, p_months, p_amount, p_raw)
    on conflict (reference) do nothing;
  if not found then
    select plan_expires_at into v_exp from companies where id = p_company;
    return v_exp;
  end if;
  select plan_expires_at into v_cur from companies where id = p_company for update;
  v_exp := greatest(now(), coalesce(v_cur, now())) + make_interval(days => 30 * p_months);
  update companies set plan = p_plan, plan_expires_at = v_exp where id = p_company and plan <> 'comped';
  return v_exp;
end $$;
revoke all on function public.apply_subscription_payment(text, uuid, text, int, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.apply_subscription_payment(text, uuid, text, int, numeric, jsonb) to service_role;
