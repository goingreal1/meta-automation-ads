# Full CRM Architecture Plan

Written before any further building, per your request. This answers every question you asked against what actually exists in the code today, then lays out what still needs deciding and building, in order. Nothing more gets built until you've weighed in on the decisions in Section 6.

**Update after your answers:** "buyer accounts" turned out to be bigger than one CRM getting real logins — you described any e-commerce business signing up, deploying to their own domain, and their media buyers joining under them. That's a multi-tenant SaaS platform, not a per-buyer login on one company's dashboard. Section 8 lays out how that actually works and the real fork inside it (one shared platform with per-company domains, vs. a truly separate deployment per company) before anything gets built on it.

---

## 1. How does the CRM actually collect an order today?

Not from Meta CAPI — CAPI never touches your database at all. CAPI is a one-way, fire-and-forget signal *to Meta* ("this event happened, optimize ads around it") using data your own systems already collected. It cannot create a CRM record; it's not a data source, it's an ad-optimization side channel.

The real order path, as it exists right now:

```
Customer fills the form on the buyer's sales page (order.html)
        │
        ▼
 POST → receive-order  (Supabase edge function)
        │
        ├─→ writes one row into `orders`            ← this IS the CRM record
        ├─→ fires Meta CAPI Purchase event            (side effect, for ad optimization only)
        └─→ triggers place-order-call                 (AI confirmation call)
        │
        ▼
 Order now visible in Orders tab, with buyer attribution + AI call status
```

So **the mechanism you're asking for already exists** — `order.html` is the form, `receive-order` is what lands it in the CRM. What's still open is *how a buyer embeds it* (a link/button vs. a true `<iframe>`), which is a real fork with consequences — see 6a below. Right now the Products tab generates a **link**, not iframe embed code. That's a small change, but which one you actually want changes some technical details (cookies, pixel firing), so it's a decision, not just a build task.

---

## 2. Where does each buyer create their own form / get their own iframe URL, per campaign?

**Today: nowhere. This doesn't exist yet, and I should have flagged this gap explicitly instead of building an admin-only version.**

What exists: a shared admin dashboard (one login) where *whoever's logged in* can open the Products tab and click "Get link" for any product, optionally tagging a buyer's code onto it. The buyer themselves has no login, no self-service screen, and no way to generate their own form.

What you're describing needs:
- **Buyers need their own login** (not the current single shared dashboard account).
- **A "My Forms" or "My Campaigns" screen** scoped to that buyer, where they pick a product, optionally customize it (which package tiers, which fields), and get back a live URL + iframe embed snippet.
- This is a real pivot from "one shared login, buyers are just labels in a `media_buyers` table" to "each buyer is a real authenticated user with their own restricted view." That's Decision 6b below — it's the single biggest architectural fork in this whole plan, because it changes how every table's row-level security works.

---

## 3. Order lifecycle: what does the AI actually update, and what's still manual?

**What the AI call does today, precisely:**
- Places one call per order, asks the customer to confirm the order + address.
- If the customer confirms → order moves `pending → valid`. That is the *only* status transition the AI ever makes, and only ever from `pending`, never overriding a status a human already set.
- If the customer mentions anything medical, asks to cancel, or asks for a human → the call gets flagged in a "needs a human" queue. The order status itself is **not** changed automatically in that case.
- The AI never touches `delivered`, `returned`, `cancelled`, or a "failed" status — those are 100% manual today, via a dropdown on each order row.

**What's genuinely missing** (you asked directly, and the honest answer is: this isn't built):
- No **failed** status distinct from "returned"/"cancelled" — right now a failed delivery attempt has nowhere to go except one of those two, which loses the reason.
- No **delivery agent** concept anywhere in the schema or dashboard. Zero. No table, no assignment logic, no agent-facing view.
- No record of *who* marks an order delivered, or from where — right now "Delivered" is just a dropdown any dashboard user can click.

This needs designing, not just building — see Decision 6c.

---

## 4. Can we work on the CRM research doc?

Yes — that's exactly what Sections 5–7 below do: turn `CRM_GAPS_AND_RECOMMENDATIONS.md` from a list into a sequenced, buildable plan.

---

## 5. New ad accounts: self-serve add, or auto-detect?

**Today:** a buyer's Facebook connection lists their ad accounts once, at the moment they connect. If they later get access to a *new* ad account inside their Business Manager, nothing notices — the CRM's copy of "your ad accounts" is a snapshot from connection time.

**What's needed** — this is actually two separate, complementary features, not an either/or:
- **Manual "Sync accounts now"** — a button that re-calls Facebook's `/me/adaccounts` with the buyer's already-stored token and shows anything new. Cheap, buyer-initiated, no surprises.
- **Scheduled auto-detection** — a nightly job that does the same thing for every active connection, and either (a) auto-imports accounts that are active *and* have real spend/balance, or (b) puts new accounts in a "found, not yet added" queue for a human/buyer to approve. I'd default to **(b)**, flagged not auto-imported — auto-importing an account nobody asked to track means it starts appearing in spend/ROAS numbers without anyone deciding that should happen. This is Decision 6d.
- Either way, "active with ads or funded" is a real filterable signal Meta's API gives us (`account_status`, `amount_spent`/balance) — I'd filter the list down to that by default so a buyer isn't shown every dormant test account in their Business Manager.

---

## 6. Decisions I need from you before building anything else

These are real forks — each one changes the shape of the database and the dashboard, so I'm not picking for you.

**(a) Order form embedding: link/button, or true iframe?**
A plain link (buyer's "Order Now" button navigates to `order.html` in the same tab, or opens it in a new one) is simple and has zero cross-browser cookie issues — the Meta pixel and CAPI dedup both just work. A true `<iframe>` embed keeps the customer on the buyer's own page, which looks more seamless, but modern browsers (Safari ITP, Chrome's third-party cookie phase-out) increasingly block cookies set *inside* an iframe from a different domain — which breaks `_fbp`/`_fbc` capture and weakens CAPI match quality, the same way tracking generally degrades in ads-tech right now. It's fixable (postMessage the order event up to the parent page, track pixel data on the parent instead of inside the iframe) but it's extra work worth doing deliberately, not by accident.

**(b) Do buyers get their own real login, or stay as labels under one shared admin login?**
This is the big one. Your question #2 (each buyer creates their own forms) genuinely requires this. If yes: every buyer becomes a Supabase Auth user, tables get buyer-scoped row-level security (a buyer sees their own orders/forms/ROAS, not everyone's), and the current single-login model changes everywhere. This is a bigger build than everything shipped last round combined — worth sequencing as its own phase, not a bolt-on.

**(c) Delivery agents: how do they get assigned, and how do they mark delivered?**
Three realistic shapes, not mutually exclusive:
  1. **Admin/buyer manually assigns** an agent to an order from the dashboard (simplest, needs an `agents` table + an `assigned_agent_id` on orders).
  2. **Self-claim queue** — agents see a list of unassigned orders in their area and claim one (needs agents to have some kind of access — a login, or a simpler no-login "magic link" per agent).
  3. **WhatsApp-based** — an agent replies `DELIVERED <order-ref>` to a bot number, no separate login/app needed at all, fits the WhatsApp-first pattern the rest of this system already uses.
  I'd lean toward **assignment by admin/buyer + WhatsApp-based delivery confirmation** as the fastest real thing to ship (no new login system, reuses the WhatsApp bot infrastructure that already exists) — but this is your call, especially if you already have real delivery riders with a preferred way of working.

**(d) New ad accounts: silent auto-import, or flagged for approval?**
Covered in Section 5 — I'd default to flagged-for-approval, confirm that's right.

---

## 7. Proposed build order (once 6a–6d are decided)

1. **Buyer accounts + RLS** (if 6b = yes) — foundational; everything else about "each buyer does X themselves" depends on this existing first.
2. **Order form: fix embedding per 6a's answer** (iframe + postMessage, or formalize the link/button as the supported path and stop pretending iframe is equivalent).
3. **Buyer self-service form/campaign builder** (needs #1) — the actual answer to your question #2.
4. **Delivery agents** per 6c's answer — table, assignment, and the confirmation path (WhatsApp command, claim queue, or dashboard action).
5. **Order status: add a real `failed` state** with a reason code, distinct from returned/cancelled.
6. **Ad account sync**: manual "Sync now" button first (cheap, immediate), then the scheduled auto-detect job with the approval queue from 6d.
7. Everything else from `CRM_GAPS_AND_RECOMMENDATIONS.md`, roughly in this order: customer dedup/unification (unlocks a real customer profile view) → NDPR consent capture → COD duplicate-order flagging → audit trail on status changes → inventory → reporting/export.

I'm not starting step 1 until you answer 6a–6d.

---

## 8. Multi-tenant SaaS: how would a media buyer actually get access to their company?

You asked directly: "any e-commerce admin can sign up, but how would their media buyers have access to their company?" Here's exactly how, and the real fork underneath it.

### The access model (same regardless of which deployment shape you pick below)

1. **A company signs up** → creates a `companies` row (name, plan, etc.) and its first user becomes that company's **Owner/Admin**. Every other table that currently has no notion of "whose data is this" (`products`, `orders`, `ad_accounts`, `media_buyers`, `creative_assets`, `daily_metrics`...) gets a `company_id` column, and row-level security is rewritten so a query only ever returns rows for the company the logged-in user belongs to. This is the actual foundational work — not a UI screen, a rewrite of the security model underneath almost every table.
2. **The admin invites a media buyer** — two realistic ways to do this, and they're not mutually exclusive:
   - **Invite link/code**: admin clicks "Invite buyer" in Settings, gets a link like `yourapp.com/join?company=<token>`. Buyer opens it, creates their own login (email+password or magic link), and is automatically attached to that company with a `media_buyer` role. This is the standard SaaS pattern (Slack, Notion, etc. all work this way) — I'd default to this.
   - **Admin creates the account directly** (buyer never self-registers, admin sets an initial password/sends a magic link). Simpler for less tech-savvy teams, more manual work for the admin.
3. **Once inside**, a media buyer's session is scoped to their company (via the `company_id` on their user record) and, within it, further scoped to *their own* data where that matters (their own orders/forms/ROAS) while an Admin/Owner role sees everything across the whole company. This is a standard two-level permission model: `company_id` for tenant isolation, a `role` (`owner`/`admin`/`buyer`) for what they can see *within* their own company.

That part is the same either way. The actual fork is underneath it, in how "their own domain" gets served:

### Fork: one shared platform, or a separate deployment per company?

**Option A — One shared multi-tenant platform (what "SaaS" almost always means in practice).**
One Supabase project, one set of edge functions, one dashboard codebase. Every company is just a row in `companies`, isolated entirely by `company_id` + RLS, not by having their own separate infrastructure. "Their own domain" is handled by **domain mapping**: each company gets a subdomain for free (`acmeherbal.yourplatform.com`), and if they want their *own* domain (`shop.acmeherbal.com`) they point a CNAME at your platform and you register/verify it (Vercel and Cloudflare both have APIs for exactly this — provisioning a custom domain + SSL cert per tenant is a solved, well-trodden problem, not something to build from scratch). One deploy fixes a bug for everyone. This is how essentially every real multi-tenant SaaS product works (Shopify, Notion, etc.) — I'd strongly recommend this over B unless there's a hard requirement I'm not seeing.

**Option B — A truly separate deployment per company (white-label reseller model).**
Every new company means: a new Supabase project, its own secrets (Meta app credentials, WhatsApp number, ElevenLabs agent), its own static site deploy, its own domain configured by hand. Full data isolation by construction (literally different databases), and a company can point any domain at it trivially since it's wholly theirs. The real cost: this doesn't scale past a handful of companies without you building *another* whole layer of automation just to provision new instances (which is itself a non-trivial engineering project), and every bug fix/feature has to be re-deployed everywhere instead of once.

**My recommendation: Option A.** It's what "sign up and get your own CRM" almost always means to an end customer in practice, it's dramatically less operational work per new company, and custom-domain-per-tenant is a solved problem on top of it — you get "their own domain" either way, just without needing to stand up new infrastructure for every signup.

### What this changes about everything already built

To be direct about the size of this: multi-tenancy touches nearly every table in this schema. Right now `ad_accounts` is the only table with any owner concept at all (`user_id`, checked via `auth.uid()`), and every other table (`orders`, `products`, `media_buyers`, `creative_assets`, `daily_metrics`, `voice_calls`...) has no tenant boundary whatsoever — they're all implicitly "the one business running this dashboard." Turning this into a real multi-tenant platform means adding `company_id` and rewriting RLS on all of them, not just the ones from this last round. That's why it's Phase 1 in Section 7's build order, before the self-service form builder or anything else that assumes "a buyer has their own restricted view" — none of that can be built correctly until the tenant boundary exists underneath it.
