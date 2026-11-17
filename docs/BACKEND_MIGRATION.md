# Moving Revora's backend to a new free Supabase project (media on Cloudflare R2)

Written 2026-11-17. Decision: new FREE Supabase project for the database, auth and edge functions; the big images and videos move to Cloudflare R2 so the free 1 GB storage limit stops mattering.

## Why
The current project passed the free plan's 1 GB storage limit: about 1.34 GB in storage (`creative-vault` 962 MB, `site-image-originals` 131 MB, `social-media` 67 MB, `site-media` 61 MB, `draft-media` 45 MB, `ad-fit` 15 MB). The database is only 101 MB, with 105 tables, 12 users and 12 scheduled jobs. A new free project would hit the same wall the moment the media is copied over, so the media must live elsewhere.

## What is in the repo now
- `supabase/schema/*.sql`: the real production schema captured from the live database (the 90 old migrations only create 40 of the 105 tables, so they cannot rebuild it). Apply in file order. Replace `__SUPABASE_URL__` with the new project URL (the cron file and the functions file use it).
- `supabase/functions/*`: 96 edge functions.
- `docs/BACKEND_SECRETS.md`: every secret the functions read.
- `scripts/migrate/swap-supabase.py`: re-points the website, docs and function code at the new project (dry run by default).

## What the owner does
1. Back up the old project now (Supabase dashboard, Database, Backups, or `supabase db dump`). Keep the old project alive until cut-over is verified.
2. Create the new free Supabase project. Note its project ref, URL and anon (public) key.
3. Create a Supabase access token (Account, Access Tokens) and give it to Claude through the secure form. It lets Claude run the schema, deploy the 96 functions and set secrets without pasting anything into chat.
4. Cloudflare: create a free account, an R2 bucket (for example `revora-media`), turn on public access, and create an R2 API token (Access Key ID and Secret). They go in as secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE` on the new project (the dashboard form, not chat).
5. Re-enter or copy the third-party secrets (Meta, Paystack, WhatsApp, OpenAI, Resend, Telnyx, ElevenLabs, Vercel) per `BACKEND_SECRETS.md`.

## Order of work (Claude)
1. **Schema**: run `supabase/schema/00` to `12` on the new project; add the `app_secrets` rows. Check table count (105 minus 2 throw-away tables = 103) and policies.
2. **Functions**: deploy all 96 (`supabase functions deploy --use-api`), then set secrets. Test the health ones (`mcp/health`).
3. **Data**: copy every table, in dependency order, from old to new with a temporary exporter/importer function pair over HTTPS (never through chat). Auth: copy `auth.users` and `auth.identities` with password hashes through the functions' own database connection so the 12 users keep their passwords and their ids (profiles point at those ids).
4. **Media**: add an R2 upload path (a `media` function that signs uploads; `creative-vault`, `social-media`, `site-media`, `draft-media`, `ad-fit`, `site-image-originals` uploads switch to it; the browser uploads straight to R2 with a signed link). Copy the ~1.3 GB across, then rewrite every stored link in the database (`.../storage/v1/object/public/<bucket>/...` becomes the new media base). Serve media through the site (`/m/<key>` rewritten to R2) so the storage provider can change again without breaking links.
5. **Cut-over** (a quiet hour): run `swap-supabase.py --write`, merge, redeploy the site; then repoint the outside services below; run the schedule (`11_cron_jobs.sql`); smoke-test sign-in, an order, a wallet top-up, a WhatsApp reply, the MCP connector and a social post.
6. **Rollback**: the old project is untouched until the end. Repoint the services back and revert the swap commit.

## Outside services that point at the old project and must be repointed
- Meta (WhatsApp webhook -> `handle-whatsapp-reply`; Lead Ads webhook -> `meta-lead-webhook`; Facebook Login / OAuth redirect -> `meta-oauth-callback`, plus the app's valid redirect URIs).
- Paystack webhook -> `paystack-webhook`. Telnyx -> `telnyx-webhook`. ElevenLabs -> `elevenlabs-webhook`. Shipbubble callbacks.
- Supabase Auth settings on the new project: Site URL and redirect URLs (the dashboard, login, reset-password and setup-company pages), email/SMTP, and the OAuth server used by the ChatGPT/Claude connector (`oauth/consent.html`).
- The Vercel rewrite for `/mcp` and anything in `vercel.json` that names the project (the swap script handles it). The ChatGPT/Claude connectors must be reconnected once.
- `revora-sites` project settings (`VERCEL_*` secrets are on Supabase; the site renderer reads the project URL from `api/site.js`).

## Things to clean up while moving
- One scheduled job (`stuck-order-followup-every-30min`) has the service-role key written into the job itself. Rewrite it to use the `x-cron-secret` header like the others, and rotate the service-role key after cut-over. (The schema file keeps only a `__SERVICE_ROLE_KEY__` placeholder.)
- Throw-away tables `_ddl_probe` and `site_pixel_fix_backup_20261021` are not copied.
- `wa-template-setup-once` is a retired helper; do not deploy it to the new project.
- Free projects pause after a week with no activity; the scheduled jobs keep this one awake.

## Free plan limits to keep in mind on the new project
500 MB database (today 101 MB), 1 GB storage (target: only tiny files, media on R2), 5 GB egress (media egress moves to R2, which has no egress fees), 500k edge function calls a month (today about 76k from the schedule), 50k monthly active users.
