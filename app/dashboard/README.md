# Dashboard code layout

`dashboard_new.html` is only the page shell (markup + `<link>` and `<script>` tags). Everything else lives here.

- `css/NN-*.css`: the styles, loaded in number order (order matters: later files override earlier ones).
- `js/NN-*.js`: the scripts, loaded in number order as plain scripts. They share one global scope (no modules, no build step), so a function defined in any file can be called from any other file or from an `onclick="..."` handler.

## Rules
- Add new code to the file for that feature (see the header comment of each file for the sections it holds). Keep files under about 1,000 lines; if one grows past that, cut it at a top-level function boundary into a new numbered file and add its `<script>` tag in the right place.
- Top-level `const`/`let` and function declarations can be used from any file as long as nothing calls them while the files are still loading. Code that must run at load time stays in the file where it was.
- Do not rename or reorder files without updating `dashboard_new.html`.

## Where things are
| Part | Contents |
|---|---|
| 01-03 | config, auth, phone screens, billing, PWA, API helpers, shell, router, overview |
| css/06 | campaign setup look |
| css/07 | UI kit for the rebuilt screens (`.rv-ui`, used by Overview and the screens after it) |
| 04-07 | admin overview, creative vault, **campaign builder**, review and launch, ad set builder, audience and placements |
| 08-10 | ad detail and previews, Ads Manager, live ad edits, campaign lists, performance |
| 11-18 | catalog, orders, delivery, forms, websites, conversations, media, approvals, leaderboard, wallet |
| 19-22 | wallet (continued), settings, HQ, AI chat |
| 23 | **Overview** (rebuilt) |
| 24 | chat cards and the startup code (must stay last) |

Caching: `vercel.json` serves `/app/*` with `max-age=0, must-revalidate`; the service worker (`sw.js`) keeps the last copy for offline use.
