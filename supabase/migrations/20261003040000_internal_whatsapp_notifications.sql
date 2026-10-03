-- Internal (staff-facing) WhatsApp alerts: low ad-account balance, payment
-- confirmed, funding request submitted/decided, transfer sent/failed. All
-- go out on the same global WhatsApp number already used for customer/
-- delivery-agent messages -- see send-internal-whatsapp.

alter table profiles add column if not exists whatsapp_number text;

-- profiles had no self-update policy at all before this -- adding one to
-- let a buyer/admin set their own alert number means an escalation guard
-- has to come with it, or a buyer could rewrite their own role/company_id/
-- media_buyer_id through the same policy.
create policy profiles_self_update on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function prevent_profile_privilege_escalation() returns trigger as $$
begin
  if new.role <> old.role
     or new.company_id <> old.company_id
     or new.media_buyer_id is distinct from old.media_buyer_id
     or new.delivery_agent_id is distinct from old.delivery_agent_id then
    if current_user_role() not in ('owner','admin') then
      raise exception 'Cannot change role, company, or buyer/agent assignment from here';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger profiles_guard_privilege before update on profiles
for each row execute function prevent_profile_privilege_escalation();

-- Low-balance alerting needs a per-account threshold and a way to avoid
-- re-alerting every 10 minutes once an account is already known-low.
alter table ad_accounts add column if not exists low_balance_threshold_naira numeric not null default 5000;
alter table ad_accounts add column if not exists last_low_balance_alert_at timestamptz;
