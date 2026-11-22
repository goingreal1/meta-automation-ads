create table if not exists public.login_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.login_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table if not exists public.login_attempts (
  id bigserial primary key,
  email_key text not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_email_at on public.login_attempts (email_key, at desc);
alter table public.login_codes enable row level security;
alter table public.login_grants enable row level security;
alter table public.login_attempts enable row level security;

create or replace function public.rv_login_check(p_email text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions, auth as $$
declare k text := lower(trim(p_email)); uid uuid; fails int;
begin
  delete from login_attempts where at < now() - interval '1 day';
  select count(*) into fails from login_attempts where email_key = k and at > now() - interval '15 minutes';
  if fails >= 8 then return jsonb_build_object('status', 'locked'); end if;
  select id into uid from auth.users
   where lower(email) = k and encrypted_password is not null and deleted_at is null
     and email_confirmed_at is not null and (banned_until is null or banned_until < now())
     and encrypted_password = crypt(p_password, encrypted_password);
  if uid is null then
    insert into login_attempts (email_key) values (k);
    return jsonb_build_object('status', 'bad');
  end if;
  return jsonb_build_object('status', 'ok', 'user_id', uid);
end $$;
revoke all on function public.rv_login_check(text, text) from public, anon, authenticated;
grant execute on function public.rv_login_check(text, text) to service_role;

create or replace function public.rv_access_token_hook(event jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m text := event->>'authentication_method'; uid uuid := (event->>'user_id')::uuid; gid uuid;
begin
  if m = 'password' then
    delete from login_grants where expires_at < now();
    select id into gid from login_grants where user_id = uid order by created_at limit 1 for update skip locked;
    if gid is null then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Sign in on the Revora login page: your email code is needed first.'));
    end if;
    delete from login_grants where id = gid;
  end if;
  return event;
exception when others then
  return event;
end $$;
revoke all on function public.rv_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.rv_access_token_hook(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
