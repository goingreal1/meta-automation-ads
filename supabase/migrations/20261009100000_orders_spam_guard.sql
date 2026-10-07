-- receive-order is a public endpoint (anyone can POST an order). Cheap database-level
-- brake against scripted spam: one phone number can't create more than 8 orders an
-- hour in a company, and a company can't receive more than 300 orders in 10 minutes.
create or replace function public.orders_spam_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.customer_phone is not null and new.customer_phone <> '' then
    if (select count(*) from public.orders o
         where o.company_id is not distinct from new.company_id
           and o.customer_phone = new.customer_phone
           and o.ordered_at > now() - interval '1 hour') >= 8 then
      raise exception 'Too many orders from this phone number. Please try again later.' using errcode = 'P0001';
    end if;
  end if;
  if (select count(*) from public.orders o
       where o.company_id is not distinct from new.company_id
         and o.ordered_at > now() - interval '10 minutes') >= 300 then
    raise exception 'Order volume limit reached. Please try again shortly.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists orders_spam_guard on public.orders;
create trigger orders_spam_guard before insert on public.orders
  for each row execute function public.orders_spam_guard();

revoke execute on function public.orders_spam_guard() from public, anon, authenticated;
