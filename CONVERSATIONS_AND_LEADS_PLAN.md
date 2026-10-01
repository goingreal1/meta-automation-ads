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

## 2. The model, corrected

Not a shared company number — **each media buyer has their own WhatsApp number**,
same as each buyer already has their own Meta ad account connection. A conversation's
buyer attribution comes from whose number received it, not from parsing the ad.
`media_buyers` gets its own `whatsapp_phone_number_id`/`whatsapp_access_token`
columns (not `company_settings` — that was the wrong table for a per-buyer value).

**Solo owner, no separate buyers — the real gap this exposes.** Today, `media_buyers`
rows only get created when someone joins via a buyer invite (`complete-signup`'s
`ensureMediaBuyer`, only called for `invite.role === "buyer"`). A solo owner who signs
up and runs their own ads never gets a `media_buyers` row at all — meaning right now a
solo owner has nowhere to attach their own WhatsApp number, and their own orders
already silently fall into "Unattributed" on the Leaderboard for the same reason. Fix:
`complete-signup`'s `create` mode (new company) calls the same `ensureMediaBuyer` the
owner's own account gets, same as any buyer would. An owner is then just a buyer with
elevated permissions, not a separate concept with no buyer identity.

**Widen the existing Meta OAuth connection to cover WhatsApp (and page comments) too**
— one buyer's single "Connect Meta" token covering ad accounts, their WhatsApp number,
and replying to comments on their own ads, instead of three separate connections.
Concretely: `meta-oauth-start`'s scope grows from `ads_read,business_management` to
add `whatsapp_business_management`, `whatsapp_business_messaging`,
`pages_show_list`, `pages_read_engagement`, `pages_manage_engagement` (comment
replies need the last one). `meta-oauth-callback` additionally looks up the
connected Business's WhatsApp Business Account + phone number and saves it straight
to that buyer's `media_buyers` row — no separate manual-entry step needed for buyers
who connect this way.

**One real constraint to flag before building this:** `whatsapp_business_management`
and `pages_manage_engagement` are Meta "Advanced Access" scopes — they work fine for
you and anyone added as a tester/admin on your Meta app today, but once a real
outside company tries to connect their own Business Manager, Meta requires an **App
Review** submission (use-case description, screen recordings, business verification)
before it'll grant those scopes to a non-tester. This doesn't block building it now —
it blocks a *stranger* from completing the OAuth flow until that review is done. Worth
knowing going in, not a surprise later.

---

## 3. Build order

**Step 0 — Separate Lunessa out, before anything else touches this data.**
Create a real second `companies` row for it, backfill all 140 `beoliv_*` rows (plus
whatever Lunessa ad accounts/campaigns/ad sets exist) to that `company_id` instead of
yours. This is a data migration, not a code change — I'll confirm the exact row counts
with you before running it, same as I would for any destructive-feeling operation.

**Step 1 — Rename and de-Beoliv the schema, keep it purely a message thread.**
`beoliv_conversations`/`beoliv_messages`/`beoliv_customers` → `conversations`/
`messages`/`conversation_customers` (or similar). This stays a read+reply message
thread with a simple state (`NEW`/`ENGAGED`/`IN_QA`/`COMPLETED`, already exists) — it
does **not** grow an order-style status workflow (pending → valid → delivered). A
WhatsApp lead is a conversation, not a transaction; if it turns into a sale, that's a
separate `orders` row, same as it would be from any other channel. Add `media_buyer_id`
(set directly from which buyer's number the message arrived on — no ad-parsing needed
once numbers are per-buyer) and `product_id` (which product this lead is about,
replacing the current hardcoded-ad-id filter hack).

**Step 2 — `media_buyers` gets its own WhatsApp fields**, filled in either by the
widened OAuth connect flow or manually in Settings (under each buyer's own row, not a
company-wide form) as a fallback for a buyer who connects a WhatsApp number Meta's
OAuth can't yet see. Also: `complete-signup`'s `create` mode gives a new company's
owner their own `media_buyers` row (the solo-owner fix from Section 2).

**Step 3 — Rewrite the 6 WhatsApp functions** (`send-whatsapp-message`,
`-media`, `-flow`, `-buttons`, `-template`, `handle-whatsapp-reply`) to resolve which
*buyer's* number a conversation belongs to and pull that buyer's own WhatsApp
credentials from `media_buyers` instead of the hardcoded Beoliv env vars — same
`resolveCallConfig`-style fallback pattern `place-order-call` already uses for
ElevenLabs, so the one buyer already running this keeps working with zero config
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
2. **OAuth scope widening, now or after?** Adding `whatsapp_business_management` +
   `pages_manage_engagement` to the Connect Meta flow is the "one token for
   everything" version you want, but real non-tester companies can't complete it
   until Meta's App Review approves those scopes for your app. I'd build the schema
   (Steps 1–2) and manual per-buyer entry now so the feature works today, then widen
   OAuth once App Review is in motion — rather than blocking this whole phase on a
   review that can take days-to-weeks. OK with that split, or do you want to kick off
   App Review first and sequence around it?

Say go and I'll start at Step 0.
