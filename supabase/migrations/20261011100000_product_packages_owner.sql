-- Packages can carry a picture, a feature list and a default flag; products record who created them.
alter table public.product_tiers add column if not exists image_url text;
alter table public.product_tiers add column if not exists features text;
alter table public.product_tiers add column if not exists is_default boolean not null default false;
create unique index if not exists product_tiers_one_default on public.product_tiers (product_id) where is_default;

alter table public.products add column if not exists created_by uuid default auth.uid();
alter table public.products add column if not exists media_buyer_id uuid;

-- backfill ownership for existing products from their ad account
update public.products p set media_buyer_id = a.media_buyer_id from public.ad_accounts a where a.id = p.ad_account_id and p.media_buyer_id is null and a.media_buyer_id is not null;

create or replace function public.set_product_owner() returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.created_by is null then new.created_by := auth.uid(); end if;
  if new.media_buyer_id is null then
    select pr.media_buyer_id into new.media_buyer_id from public.profiles pr where pr.id = auth.uid();
  end if;
  if new.media_buyer_id is null and new.ad_account_id is not null then
    select a.media_buyer_id into new.media_buyer_id from public.ad_accounts a where a.id = new.ad_account_id;
  end if;
  return new;
end $fn$;
revoke execute on function public.set_product_owner() from public, anon, authenticated;

drop trigger if exists trg_set_product_owner on public.products;
create trigger trg_set_product_owner before insert on public.products for each row execute function public.set_product_owner();
