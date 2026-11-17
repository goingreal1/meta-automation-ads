-- Production has NO direct table grants for the anon role (everything public goes through edge functions or RLS-checked authenticated calls).
-- A new Supabase project grants anon on everything by default, so mirror production:
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
