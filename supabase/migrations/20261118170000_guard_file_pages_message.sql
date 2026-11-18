-- Same guard, clearer message: AI assistants are not blocked from file sites, they just have to use the file tools (which keep styles).
create or replace function public.rv_guard_file_pages() returns trigger language plpgsql as $$
begin
  if coalesce(old.seo->>'source','') = 'files'
     and (coalesce(new.seo->>'source','') <> 'files' or (new.project is not null and old.project is null)) then
    raise exception 'This page is built from files, so the visual builder and the template page builder cannot overwrite it (that wipes its styles). AI assistants can still edit it: use site_list_files, site_read_file, site_patch_file or site_write_file. People can edit it in the Site IDE.' using errcode = 'P0001';
  end if;
  return new;
end $$;
