# Meta App Review: `ads_management` (and friends)

> Status (Oct 2026): the app owner confirmed `ads_management` is already approved, and created the login configuration `1784938949217359` (system-user token that never expires; pages, ad accounts, pixels, Instagram; all the permissions above). The ad-account login now uses it by default. This document stays as a reference for re-submitting or adding permissions.

Use this text in **App Dashboard → App Review → Permissions and Features → ads_management → Request advanced access**.

## Before you submit (checklist)
- [ ] Business verification is complete (Settings → Business info → Verification).
- [ ] App is **Live**, has an icon, a privacy policy URL and a **data deletion** URL (a page that explains how users delete their data, or a callback).
- [ ] App domain, and the dashboard URL, are listed under Settings → Basic → App domains.
- [ ] `https://rrkhkhgdxhmogxxtbvyt.supabase.co/functions/v1/meta-oauth-callback` is listed as a **Valid OAuth Redirect URI** (Facebook Login for Business → Settings).
- [ ] The Login configuration used for ad accounts includes `ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`/`pages_manage_engagement` if you use them (App Dashboard → Facebook Login for Business → Configurations).
- [ ] A test user (not your real one) with a dummy ad account and page, and its login shared in the "Reviewer instructions" box on the submission form (never in this repo).
- [ ] A screen recording (2-4 min, English captions) following the script below.

> Note on "do we already have it?" The earlier note in `TRACKING_STRATEGY.md` saw `ads_management` on the founder's own token. That does **not** prove Advanced Access: people with a role on the app (admin, developer, tester) can use any permission at Standard Access. Check the real level at **App Review → Permissions and Features**: the column must say *Advanced access* for each permission. Only then can strangers (your buyers) grant it.

## Use case description (paste)
Revora is a CRM for e-commerce media buyers in Nigeria. A media buyer connects their own Meta ad account to Revora with Facebook Login. Revora then lets them, from one dashboard:

1. create campaigns, ad sets and ads (Click-to-WhatsApp and website-traffic/sales) in their ad account,
2. pause or resume campaigns, ad sets and ads and change their daily budgets,
3. send Purchase conversion events to their own Meta dataset (Conversions API) when a customer order is confirmed,
4. read their spend, results and balance to show real ROAS against their own orders.

`ads_management` is required for steps 1-3: it is the only permission that allows creating and editing ads and sending conversion events on the buyer's behalf. We only act on the ad accounts the person chooses to connect, only when they press a button in the dashboard or have switched on a rule themselves (for example "pause ads that spend ₦X without a sale"). We never access ad accounts the user did not grant, and users can disconnect at any time in the dashboard or in Facebook Settings → Business Integrations. Access tokens are stored server-side, never shown in the browser.

## Screencast script (what the reviewer must see)
1. Open the dashboard, log in as the test user. Settings → Ad accounts → **Continue with Facebook**.
2. Show Facebook's login/consent dialog listing the permissions, pick the test ad account, approve.
3. Back in the dashboard: the account appears under "Ad accounts we found", press **Add**.
4. Campaigns → **+ New campaign**, walk the 6 steps, launch. Show the campaign appearing in Meta Ads Manager (paused).
5. Back in Campaigns, flip the switch to pause/resume, and show the change in Ads Manager.
6. Show an order being confirmed and the Purchase event arriving in Events Manager → Test events.
7. Settings → disconnect, and show access is removed.

## Other permissions you will be asked about
| Permission | Why (one line) |
|---|---|
| `ads_read` | Show spend, results and balance per ad account |
| `business_management` | List the ad accounts, pages and WhatsApp accounts in the buyer's Business Manager |
| `pages_show_list`, `pages_read_engagement` | Let the buyer choose which Facebook Page their ads run as |
| `whatsapp_business_management`, `whatsapp_business_messaging` | Create/connect their WhatsApp number (Embedded Signup) and send/receive customer messages on it |
| `leads_retrieval` | Only if lead forms are used |

## Common reasons for rejection
- Screencast does not show the *whole* flow including the login dialog.
- Reviewer cannot log in (give a working test account and say how to get past any 2FA).
- Privacy policy or data-deletion URL missing / not matching what the app does.
- Asking for permissions the video never uses (remove them from the request).
