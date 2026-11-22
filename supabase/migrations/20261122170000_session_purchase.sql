-- A thank-you page can tell Revora "this visit bought something" (value and reference optional). Only the visit's own key can mark it.
alter table public.site_sessions add column if not exists order_value numeric;
alter table public.site_sessions add column if not exists order_ref text;
alter table public.site_sessions add column if not exists ordered_at timestamptz;

create or replace function public.rv_session_purchase(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_site uuid := nullif(p->>'site', '')::uuid; v_proj uuid; v_key text := left(p->>'key', 64); v_company uuid;
        v_host text := lower(regexp_replace(coalesce(p->>'host', ''), '^www\.', ''));
        v_val numeric := case when coalesce(p->>'value', '') ~ '^[0-9]+(\.[0-9]+)?$' then (p->>'value')::numeric else null end;
begin
  if v_key is null or length(v_key) < 8 then return; end if;
  if v_site is not null then
    select company_id into v_company from sites where id = v_site and status = 'published';
  elsif coalesce(p->>'project', '') <> '' then
    select id, company_id into v_proj, v_company from rec_projects
      where public_id = p->>'project' and enabled and (cardinality(domains) = 0 or v_host = any (select lower(regexp_replace(d, '^www\.', '')) from unnest(domains) d));
  end if;
  if v_company is null then return; end if;
  update site_sessions set ordered = true, ordered_at = now(), order_value = coalesce(v_val, order_value), order_ref = coalesce(nullif(left(p->>'ref', 60), ''), order_ref), last_seen_at = now()
   where session_key = v_key and company_id = v_company and coalesce(site_id, project_id) = coalesce(v_site, v_proj) and ordered is not true;
end $$;
revoke all on function public.rv_session_purchase(jsonb) from public;
grant execute on function public.rv_session_purchase(jsonb) to anon, authenticated;
