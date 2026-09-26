# CRM Upgrade: Order Forms, Leaderboard, Ad Spend & ROAS, Meta OAuth

What changed and how to finish setting each piece up. Voice-call setup (ElevenLabs/LiveKit, red-flag handoff) is unchanged and documented separately in `VOICE_AGENT_AND_BUYER_ROAS.md` -- this doc covers everything from this round.

---

## 1. Real order forms (no more hand-built sales pages)

**Problem this fixes:** every product used to need a fully hand-coded HTML page like `sales-ginaris-herbal.html` before a buyer could actually take an order -- there was no generic "order now" page, so `orders` only ever got real, well-formed rows for the one or two products someone had built a page for.

**What's new:**
- `order.html` -- one generic order form, driven entirely by a `?product=<id>` query param. Shows the product's real photo/description/benefits/safety notes/price (pulled live from the `products` table), collects name/phone/address/city/state/payment method, and posts straight into `receive-order` -- the same order pipeline, CAPI firing, and now the AI confirmation call, that every other order already goes through.
- `get-product-public` -- a new public edge function `order.html` calls to read that product data. `products` is normally locked to the signed-in dashboard user (RLS), so this exists to expose only the safe, public fields a stranger's browser is allowed to see.
- **Products tab -> "🔗 Get link"** button per product: generates the order.html link, lets you optionally tag it with a media buyer (for ROAS attribution), and copies it. That's the link a buyer puts as the "Order Now" button on their own sales page or ad.
- The Meta pixel fires automatically on the order form too -- it's read from `ad_accounts.meta_pixel_id` for that product's account, no hardcoding needed.

**Nothing to configure** -- deploy `get-product-public` and `order.html` is live. If a product needs a genuinely custom page (different layout, upsells, etc.), the existing `order_form_url` field on Products still works exactly as before -- `order.html` is the default now, not the only option.

---

## 2. Leaderboard tab

Ranks every named media buyer by order revenue over a selectable range (Today / 7 days / 30 days / All time), with spend, orders, ROAS and delivered-ROAS (cash actually collected on delivery) per buyer, and medals for the top 3. Attribution works the same way as before: put `[CODE]` in an ad set or campaign name, or pass `?buyer=CODE` through the order link.

## 3. Ad Spend & ROAS tab (was "Performance")

The old Performance tab (spend/CTR/CPA/daily metrics) now also shows, for the same date range you're already looking at:
- Overall ROAS and delivered-ROAS across every buyer combined.
- A "Spend & ROAS by media buyer" breakdown table -- so ad spend and ROAS finally live in one place instead of spend on one tab and ROAS somewhere else.

"AI calls needing a human" (medical questions, cancel requests, "let me talk to someone") moved to the **Orders** tab, since that's fundamentally about a specific order/customer, not about buyer performance -- there's now a badge on the Orders tab that lights up whenever one is open, and every order row shows its AI call's outcome with a manual "Call now" / "retry" button.

---

## 4. Meta OAuth (each buyer connects their own Business Manager)

**Before:** every ad account had to be added by hand -- name, `act_...` ID, page ID -- and metrics were pulled with one single shared `META_ACCESS_TOKEN` for every account. That token has to be an admin on every single ad account, which doesn't scale past a handful of buyers and means you're trusting one token with access to everyone's spend.

**Now:** Settings -> **Media buyers & Meta connections** has a "Connect Meta" button per buyer. It sends their browser to a real Facebook login/consent screen; once they approve, their ad accounts are listed and you tick which ones to start tracking. From then on, `pull-meta-metrics` uses *that buyer's own token* for *their* accounts (falling back to the old shared token for any account still added manually) -- and refreshes it automatically as it nears expiry.

### ⚠️ You must do a Meta App Review before this works for real buyers

This is the one piece of this whole slice that isn't just a deploy-and-go. Facebook Login for the `ads_read` and `business_management` permissions requires **App Review (Advanced Access)** -- until your Meta App passes that review, **only people added as Admins/Developers/Testers on the app in Meta's dashboard can complete the OAuth flow at all**; everyone else gets an error from Facebook before they even reach your callback. This is Meta's rule, not something in this code to fix.

Practically:
- **To test with 1-3 buyers right now:** add them as Testers on your Meta App (App Roles -> Roles), and the flow works today, no review needed.
- **To roll this out to all your buyers:** submit the app for App Review requesting `ads_read` and `business_management`, with a screen-recording and use-case description ("a buyer connects their own ad accounts so we can read their spend for a shared dashboard"). Expect this to take Meta some real review time; it is not instant.
- Until that's approved, keep adding accounts manually in Settings for buyers who aren't Test users yet -- the manual flow still works exactly as it always has, unaffected by any of this.

### Setup

1. **Create a Meta App** (developers.facebook.com) of type "Business", add the **Facebook Login** product.
2. **Valid OAuth Redirect URIs** (Facebook Login -> Settings): add exactly
   `https://<project-ref>.supabase.co/functions/v1/meta-oauth-callback`
3. Copy the **App ID** and **App Secret**.
4. Set secrets and deploy:
   ```bash
   supabase secrets set \
     META_APP_ID=... \
     META_APP_SECRET=... \
     META_OAUTH_STATE_SECRET=$(openssl rand -hex 32) \
     DASHBOARD_URL="https://yourdomain.com/dashboard_new.html"   # optional but recommended

   supabase db push   # applies 20260926130000_meta_oauth_connections.sql
   supabase functions deploy meta-oauth-start --no-verify-jwt
   supabase functions deploy meta-oauth-callback --no-verify-jwt
   supabase functions deploy pull-meta-metrics
   ```
   `DASHBOARD_URL` is where a buyer's browser lands after connecting (or failing to). Without it, they just see a plain "connected, go back to your dashboard" page instead of bouncing straight back into Settings.
5. Add each buyer as a Tester on the app (App Roles -> Roles -> Add People) until App Review is done.

### What's actually stored, and what isn't

`meta_connections` holds the OAuth token. The dashboard **cannot read it, ever** -- row-level security on that table has no policy at all for the `authenticated` role, so any attempt to query it directly (not just through the UI) is flatly denied. The dashboard reads `meta_connections_public`, a view that simply never selects the token column. Only the two OAuth edge functions and `pull-meta-metrics` (both running as the service role, which bypasses RLS) ever touch the real token.

---

## Still not done (flagging honestly, not building silently)

- **Meta OAuth token refresh has a real ceiling.** Long-lived tokens last ~60 days and can be silently re-extended *while still valid* -- this repo does that automatically. But if a buyer doesn't open the dashboard (or `pull-meta-metrics` doesn't run) for 60+ days straight, the token actually expires and there's no way to refresh an expired token -- they have to click "Reconnect". Settings shows "(expires in Nd)" in red under 7 days so this is visible before it happens.
- **Pagination on `/me/adaccounts`** is capped at 200 accounts per connection. Fine for any individual buyer; would need real pagination for someone managing an unusually large Business Manager.
- `order.html`'s payment options are Pay on Delivery / Bank Transfer (Nigeria-only, matching the rest of this CRM). If a buyer needs card/PayPal-style international payment collection like the existing `sales-ginaris-herbal.html`, that's a separate page still, same as before.
