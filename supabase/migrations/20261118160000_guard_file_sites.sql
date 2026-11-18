-- A site built from files (index.html, styles.css ...) is edited in the IDE. The visual builder and the AI page-build tools rebuild a page
-- from their own template, which wipes the custom styles. This stops them from overwriting such a page; IDE/file saves are unaffected.
create or replace function public.rv_guard_file_pages() returns trigger language plpgsql as $$
begin
  if coalesce(old.seo->>'source','') = 'files'
     and (coalesce(new.seo->>'source','') <> 'files' or (new.project is not null and old.project is null)) then
    raise exception 'This page is built from files, so the visual builder and AI page builder can''t edit it (they would wipe its styles). Edit it in the Site IDE instead.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_rv_guard_file_pages on public.site_pages;
create trigger trg_rv_guard_file_pages before update on public.site_pages for each row execute function public.rv_guard_file_pages();
