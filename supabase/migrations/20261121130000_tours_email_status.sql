-- Tours: remember whether the automatic confirmation email (with the apply link) went out.
alter table public.tours add column if not exists emailed_at timestamptz;
alter table public.tours add column if not exists email_error text;
