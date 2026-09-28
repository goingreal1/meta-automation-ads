# What a modern CRM needs that this one is still missing

Grounded in this actual schema and dashboard (not a generic feature checklist). Ordered by leverage: cheap-and-high-impact first, bigger builds later.

---

## Do next (small, concrete, high leverage)

**1. One customer record, not three separate tables that happen to share a phone number.**
Right now `orders`, `website_leads`, and `beoliv_customers`/`beoliv_conversations` each store their own copy of a customer's name/phone/address, keyed by a raw phone string with no normalization (`"08031234567"` vs `"+2348031234567"` vs `"234 803 123 4567"` are three different strings to Postgres, one person to you). This is the actual root cause behind "orders isn't working like a real CRM order" -- there's no single place that shows *this person's* full history (every order, every WhatsApp chat, every AI call) on one screen. Fix: a `customers` table keyed by normalized E.164 phone (the `toE164NG()` helper already added for voice calls does exactly this normalization -- reuse it), with `orders.customer_id`, `website_leads.customer_id`, `beoliv_conversations.customer_id` all pointing at it. Then a "Customer" detail view becomes possible: total orders, lifetime value, delivery rate, every conversation, every call, in one place.

**2. Consent + NDPR compliance.** You're collecting phone/name/address/health-adjacent product interest from Nigerian consumers with no recorded consent, no visible privacy notice on `order.html`/the sales pages, and no data-retention or deletion policy anywhere in the schema. Nigeria's Data Protection Act (NDPA 2023, enforced by the NDPC) requires a lawful basis and documented consent for exactly this kind of processing, and gives people a right to request deletion. This is a real legal exposure for a wellness business specifically (health-adjacent claims draw regulatory attention). Concrete fix: a `consent_given_at` timestamp + a one-line notice + link on every customer-facing form, and a documented (even manual, at first) process for a deletion request.

**3. Fraud / duplicate-order detection for COD.** Pay-on-delivery is your default payment method, which is exactly the payment method most exposed to fake/duplicate orders (same person spamming an ad's order form, competitors submitting junk orders to waste delivery attempts). There's currently no check for "same phone number, same address, order placed twice in an hour." A same-phone-in-N-hours check on `receive-order` (flag, don't block) is cheap and catches most of it.

**4. Delivery logistics has no second half.** `orders.order_status` goes `pending -> valid -> delivered/returned/cancelled`, but nothing tracks *who* is delivering it, no dispatch rider assignment, no courier tracking number, no delivery-attempt count, no reason code when a delivery fails or a customer refuses at the door. For a COD business this is usually where the real money is lost (failed deliveries, no record of why). Even a simple `delivery_attempts` table (rider, attempt time, outcome, reason) pays for itself fast.

**5. Stuck-order follow-up.** A `pending` order that's had its confirmation call fail, or that a customer never picks up for, currently just sits there. There's no automatic "still pending after 24h -> send a WhatsApp nudge" or "AI call failed twice -> flag for a human to call manually" loop. The AI call system already built gives you the hook (`voice_calls.status = 'failed'`) -- it just isn't followed up automatically yet.

---

## Worth planning for (bigger, but real gaps)

**6. Inventory / stock.** There is no stock-on-hand anywhere in this schema. For a physical herbal-product business, running ads on a product that's actually out of stock (and finding out only when delivery fails) is a completely avoidable, recurring failure mode. Even a single `stock_on_hand` counter per product with a manual decrement on `delivered` and a dashboard low-stock warning would close most of the gap.

**7. Team accountability / audit trail.** Every status change, buyer reassignment, or manual order edit currently just overwrites the row (`updated_at` moves, but who changed it and from what isn't kept). Once more than one person touches this dashboard, "who changed this order to cancelled?" becomes a real question with no answer. A simple `order_events` append-only log (or Postgres audit trigger) fixes this without changing any UI.

**8. Real permissions, not one shared login.** Everyone who has the dashboard password currently sees every buyer's orders, every customer's phone number, and every account's ad spend. The Media Buyers system this round adds attribution but not access control -- a buyer still isn't restricted to their own numbers. Supabase Auth already supports per-user roles; the missing piece is RLS policies keyed off a buyer's own `auth.uid()` instead of the current single-owner model.

**9. A unified inbox/timeline view**, not three separate tabs (Conversations, Orders, and now voice calls) that all describe the same customer. The data already exists to build this (once #1's `customers` table exists) -- it's a UI investment, not a schema one.

**10. Reporting and export.** There's no CSV/Excel export anywhere -- for reconciling COD cash collected against bank deposits, for accounting, or for answering "how many orders did we do last month" without opening the SQL editor. Even a "Download CSV" button on Orders and the ROAS tabs is a cheap, real win.

**11. Statistically-aware creative testing.** The Creative Vault's win/kill thresholds (CTR, CPA, frequency) are fixed cutoffs applied as soon as there's *any* data -- a small sample can swing CTR wildly and get a genuinely good creative killed on noise, or a bad one scaled on a lucky morning. A minimum-sample-size gate (e.g. don't decide before N impressions) or a simple confidence interval would meaningfully reduce false kills/scales.

**12. Post-delivery feedback.** Nothing asks "did this arrive, was it what you expected" after a delivery -- no NPS/CSAT, no review capture. For a wellness product where word-of-mouth and reviews drive repeat/referral sales, this is low-effort, high-value: one WhatsApp message after `delivered_at` with a 1-5 tap and optional comment.

**13. Repeat-customer / LTV view.** Once #1 exists, "which customers have ordered more than once, and what's their total spend" becomes trivial and is one of the higher-value things a CRM does that a spreadsheet doesn't -- it's the foundation for a loyalty/referral program later.

---

## What NOT to prioritize right now

- **A generic CRM feature checklist for its own sake** (custom fields everywhere, pipeline/deal-stage builders, workflow automation UI) -- this business runs one kind of pipeline (ad click -> order -> confirm -> deliver), and building a generic no-code automation layer for a single, well-understood flow is over-engineering. Solve the 13 items above with direct code first.
- **Multi-currency/international CRM depth** unless the USD sales-page pattern (`sales-ginaris-herbal.html`) is actually going to scale beyond one product -- most of this system is deliberately Nigeria/NGN-specific (states list, NDPR, pay-on-delivery, WhatsApp-first), and that focus is a feature, not a gap.
