-- Applications: remember whether the automatic "how to pay your application fee" email went out.
alter table public.applications add column if not exists emailed_at timestamptz;
alter table public.applications add column if not exists email_error text;
