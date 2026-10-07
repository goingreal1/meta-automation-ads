# sites-app — the dedicated "revora-sites" Vercel project

Serves **only** customer websites (no dashboard, builder or login). Built with the Vercel Build Output API (`build.js`).

## Vercel project settings
| Setting | Value |
|---|---|
| Git repository | this repo, production branch `main` |
| Root Directory | `sites-app` |
| Include source files outside of the Root Directory | **on** (build.js reads `../rv`, `../api/site.js`) |
| Framework Preset | Other |
| Build Command | `node build.js` |
| Install Command | `echo skip` |
| Output Directory | *(leave empty)* |
| Deployment Protection | **off** (public pages) |
| Domains | `revora-sites.vercel.app` (moved from the dashboard project) + every customer domain |

## Custom domains
`site_domains` table (RLS: company members read) + `manage-domain` edge function (add / check / assign / remove).
The function registers the hostname on this project through the Vercel API and needs these Supabase secrets:
`VERCEL_API_TOKEN`, `VERCEL_SITES_PROJECT_ID` (optional `VERCEL_TEAM_ID`).

Routing (api/site.js, sites project only):
- `<platform host>/s/<site>/<page>` — as before.
- `<custom host>/` and `/<page>` — the domain's default site (`site_domains.site_id`).
- `<custom host>/s/<site>/<page>` — any other site of the same company (`get-site-public` checks the company matches).
