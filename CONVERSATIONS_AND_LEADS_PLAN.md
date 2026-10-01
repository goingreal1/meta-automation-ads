# Conversations (WhatsApp) + Website Leads: cleanup and multi-tenancy plan

Written before touching any code, per your request. Covers what's actually in the
database today, what's wrong with it, and the build order to fix it.

---

## 1. What's actually there right now

**The WhatsApp conversations system is one single-tenant system wearing two names.**
`beoliv_conversations` / `beoliv_messages` / `beoliv_customers` hold every WhatsApp
lead conversation that's ever come in — 140 rows today. The dashboard's "Lunessa" tab
isn't a separate system; it's the exact same table, client-side filtered down to rows
whose `ad_id` matches a couple of hardcoded Lunessa ad set IDs. There's no real
distinction in the schema between "your business" and "Lunessa" — it's one table that
happens to hold two different real businesses' customer conversations, split apart
only by a filter in the dashboard JS.

**All 140 of those rows are currently tagged to your own company.** The Phase 1
multi-tenancy migration backfilled every table's `company_id` with a single
`companies` row ("My Company") before Lunessa was understood to be a different
business. So right now, a former employer's customer conversations live inside your
company's data. That's worth fixing before anything else here, not just for
cleanliness — if you ever need to prove data boundaries to a client or hand off
Lunessa's data, "it's mixed into my own company's table" is the wrong answer to be
able to give.

**The WhatsApp send functions are hardcoded to one WhatsApp Business number**
(`BEOLIV_WHATSAPP_ACCESS_TOKEN`/`BEOLIV_WHATSAPP_PHONE_NUMBER_ID` env vars). There's
no per-company number, and `company_settings` already has `whatsapp_phone_number_id`/
`whatsapp_access_token` columns sitting unused — nothing in the dashboard even has a
form to fill them in yet.

**Website Leads is a real, separate, non-confusing pipeline — just needs the same
company-scoping everything else needs.** To confirm your question directly: no, having
both Order Forms (→ `orders`, a committed sale) and Website Leads (→ `website_leads`, a
softer top-of-funnel capture from your externally-built website's form) is not
confusing. They're genuinely different funnel stages — a checkout vs. an inquiry — and
keeping them as separate tables is correct. `submit-website-lead` just needs the same
"resolve company_id, tag the row" fix every other function in this list needs. The one
real future improvement (not urgent) is CRM gap #1 from `CRM_GAPS_AND_RECOMMENDATIONS.md` —
a unified `customers` table so one person's order, lead, and WhatsApp history show up
in one place instead of three.

---

## 2. The model you described, confirmed

One shared WhatsApp number **per company** (not per buyer) — any media buyer at that
company can run a WhatsApp lead-gen campaign for any product, and every resulting
conversation lands in one company-wide Conversations tab, attributed to whichever
buyer's ad drove it (same pattern orders already use: the ad set tells you the buyer,
not the phone number). An owner/admin adds the number once in Settings; every buyer's
lead campaigns use it automatically.

---

## 3. Build order

**Step 0 — Separate Lunessa out, before anything else touches this data.**
Create a real second `companies` row for it, backfill all 140 `beoliv_*` rows (plus
whatever Lunessa ad accounts/campaigns/ad sets exist) to that `company_id` instead of
yours. This is a data migration, not a code change — I'll confirm the exact row counts
with you before running it, same as I would for any destructive-feeling operation.

**Step 1 — Generalize the schema.** Rename away from the Beoliv-specific names
(`beoliv_conversations` → `conversations`, etc. — or keep the table names and just stop
treating them as Beoliv-only, your call) and add two columns that don't exist today:
`media_buyer_id` (who gets attribution, resolved from the ad the lead came from, same
as `orders.media_buyer_id`) and `product_id` (which product/campaign this conversation
is about, replacing the current hardcoded-ad-id filter hack with a real column).

**Step 2 — Settings UI for the company's WhatsApp number.** A form next to where Pixel
& Tracking already lives, writing to `company_settings.whatsapp_phone_number_id` /
`whatsapp_access_token`. Two ways to get those values in:
- **Manual entry** (simplest): owner pastes the phone number ID + token from their own
  Meta Business dashboard. Works today, zero new OAuth scope.
- **Via the existing "Connect Meta" OAuth flow**: add `whatsapp_business_management` to
  `meta-oauth-start`'s scope, and have `meta-oauth-callback` list the connected
  Business Manager's WhatsApp Business Accounts/numbers so the owner picks one instead
  of copy-pasting IDs. Nicer, but it's new OAuth surface to get right — I'd ship manual
  entry first and upgrade to this after, not block on it.

**Step 3 — Rewrite the 6 WhatsApp functions** (`send-whatsapp-message`,
`-media`, `-flow`, `-buttons`, `-template`, `handle-whatsapp-reply`) to resolve
`company_id` from the conversation/order context and pull that company's own
WhatsApp credentials from `company_settings` instead of the hardcoded Beoliv env vars
— same `resolveCallConfig`-style fallback pattern `place-order-call` already uses for
ElevenLabs, so the one company already running this keeps working with zero config
changes.

**Step 4 — `submit-website-lead`**: same company_id-resolution fix as `receive-order`
got, much smaller since it's one table, no CAPI/call-triggering side effects.

**Step 5 — `meta-capi`, `send-leads-to-meta-capi`, `meta-lead-webhook`,
`meta-lead-campaign-creator`, `sync-meta-audiences`, `upload-product-image`**: the
remaining small/generic functions from the original audit, same treatment.

Deliberately **not** in this pass: `ai-auto-launch-tests` (1082 lines),
`auto-launch-tests` (490), `auto-duplicate-adsets` (311), `sync-meta-structure` (195) —
the ad-launch automation pipeline. These are large, they actively create/modify live
Meta campaigns, and they deserve their own careful pass rather than being swept in
here. Flagging that as the next phase after this one.

---

## 4. What I need from you before starting

1. **Confirm Step 0** — OK to create a separate company for Lunessa and move its 140
   conversations (+ any Lunessa ad accounts/campaigns I find) out of your company?
2. **Table naming** — rename `beoliv_*` to generic names, or keep the names and just
   stop treating them as Beoliv-only?
3. **Settings UI for WhatsApp number** — manual entry now (fast), or wait and build the
   OAuth-driven picker from the start?

Say go and I'll start at Step 0.
