# Meta tracking & attribution strategy

Working notes on how Purchase events flow to Meta, known bugs, open research
questions, and the differentiation angle for this CRM vs. generic ones. Add
to this file as decisions get made — don't let it go stale in chat history.

## How it works today (confirmed by reading the code, 2026-09-27)

- `order.html` fires a browser-side pixel per product
  (`initPixel(product.meta_pixel_id)`) and captures `fbclid`/`_fbp`/`_fbc`,
  forwarding them to `receive-order`.
- `receive-order` fires a server-side CAPI `Purchase` event **the instant the
  order form is submitted** — before the AI confirmation call happens, before
  any delivery/payment. This is a legitimate, common pattern for COD
  businesses (Meta needs volume; waiting for cash-on-delivery to clear would
  starve the algorithm of signal).
- `wordpress-meta-pixel.html` is a ready-made pixel snippet for a buyer's
  WordPress landing page (PageView-level signal, separate from the order
  form's own pixel).

## Known bug (not yet fixed — flagged 2026-09-27)

`receive-order` sends every Purchase event to **one hardcoded pixel ID from
an env var**, not `product.meta_pixel_id` (which is already resolved and
available in the same request, same way `get-product-public` uses it). This
means every buyer's Purchase events land in one shared pixel/account —
other buyers never see "Website Purchase" results in their own Ads Manager
from their own campaigns. Fix: resolve pixel ID (and access token, if
per-buyer tokens matter later) from the order's product/ad account, same
resolution path `receive-order` already uses for `company_id` via
`product_id` → `products.company_id`. `meta-capi` has the same
global-pixel-from-env-var issue.

## Why "instant" isn't the lever people think it is

Sending a CAPI event with near-zero latency doesn't make Meta's auction
cheaper — there's no race against Meta's own server. What actually moves
cost per purchase:

1. **Volume/frequency of the optimization signal.** Firing Purchase at
   order-submit (a low-friction action) means more events qualify as
   "purchases," which gives the algorithm more data to optimize against and
   can lower reported CPA — but it's optimizing toward "people who submit a
   form quickly," not "people who pay for and keep the product."
2. **Event Match Quality (EMQ)** — how well fbc/fbp/hashed email/phone/IP/UA
   let Meta match the event to a real ad click. Poor match quality means
   events barely help optimization regardless of speed.
3. **Event freshness matters, but only as a cutoff, not a race.** Meta
   accepts CAPI events up to ~7 days late; delays beyond a few hours reduce
   optimization value. Sub-second vs. a few seconds of latency makes no
   measurable difference.

So the 10-15 second popup and the current "fire Purchase at form-submit"
behavior in `receive-order` are the *same lever* — redefining what counts as
a purchase to something earlier and easier to get. Cheaper CPA, but the
algorithm is chasing a proxy for a sale, not the sale itself.

## Per-buyer pixel/dataset config — UI gap (flagged 2026-09-27)

`ad_accounts.meta_pixel_id` exists in the schema and is already read
correctly by `get-product-public`/`order.html`, but **nothing in the
dashboard ever writes to it** — the "import ad accounts" flow (OAuth →
pick accounts → insert into `ad_accounts`) never asks for or sets a pixel
ID. Today it can only be set by hand in the DB. Since the field already
lives per-`ad_account` (not in a separate shared table), both real-world
patterns are already supported for free without new modeling:
- one pixel shared across several ad accounts → buyer types the same ID
  into each account's field.
- one pixel per ad account → each gets its own value.

**Plan:** add a "Pixel & Tracking" section to the dashboard's Settings tab
— a flat, site-wide table of every ad account the buyer has added (not
scoped to whichever `activeAccountId` is currently selected, so no account
switching needed), with an editable pixel/dataset ID field per row.

**Resolved 2026-09-27 — OAuth scope for per-buyer CAPI is clear to widen.**
Checked the founder's own live token via `diagnose-meta-token` → Meta
`/me/permissions` (routed through Postgres's `http` extension since this
session's own outbound network doesn't reach Supabase directly): `ads_management`
is granted, alongside `ads_read`, `business_management`, `leads_retrieval`,
etc. Since the app is Live (not Development Mode) and this permission is
already granted on a real token, it's at Advanced Access — safe to widen
`meta-oauth-start`/`meta-oauth-callback`'s requested scope from
`ads_read,business_management` to include `ads_management` for buyer
connections, with no new App Review submission needed.

## Open research / testing questions (not yet answered — log results here when they land)

1. **Does the popup-nudge flow produce real sales at the same rate as
   organic form fills?** Pull `orders` joined to call outcome / delivery
   status for popup-driven vs. organic-driven orders, compare real
   completion rate, not just Ads Manager's reported CPA.
2. **Per-buyer EMQ**, once each buyer is actually receiving events on their
   own pixel (blocked on the pixel-ID bug above) — check Events Manager per
   account for match quality score.
3. **Order-submit vs. call-confirmed as the Purchase trigger** — an
   A/B-testable strategy question. More volume now vs. cleaner signal later.
   Needs real revenue/ROAS data on both sides, not just Ads Manager CPA, to
   decide.
4. **Meta Graph API version drift** across functions (v18–v22 mixed) — pin
   to one version deliberately (carried over from `FUNCTIONS.md`).

## Differentiation angle: reconcile Meta's truth against ground truth

Most CRM tools in this space just surface Meta's own reported numbers.
None reconcile "what Meta counted as a Purchase" against "what the call
center/delivery outcome confirms was a real, paid, delivered order," broken
out per buyer/product/creative. That gap is where wasted spend hides, and
we already have the raw data for it (`orders`, call outcomes, delivery
status) — just not connected into one view yet. This is the CRM feature
worth building that a generic Meta-reporting dashboard doesn't have.
