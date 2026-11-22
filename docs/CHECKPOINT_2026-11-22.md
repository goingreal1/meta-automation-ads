# Checkpoint, 22 Nov 2026 (where we stopped)

Written so work can resume exactly here. Remind the assistant when the OpenAI credits are topped up.

## Blocker
- **OpenAI account has no credits** (API answers 429 "You have no credits remaining"). Every AI feature fails until it is topped up at platform.openai.com, Billing: autopilot, AI team, dashboard chat, picture and video reading, transcription.

## Autopilot (built, live)
- Page `/autopilot` (Settings, Automation, Autopilot; owners and admins). Backend is in `supabase/functions/ai-team/index.ts`, section AUTOPILOT. Table `autopilot_runs` (+ `log`). Actions `ap_start`, `ap_state`, `ap_approve`, `ap_cancel`, `ap_retry`. "Go alone" is switched off by design: the owner's tap is the approval.
- Steps: research, page, tracking, ads, plan, launch (after tap), watch, learn. Budgets are in the ad account's own currency; shoppers' currency is shown beside it. The hard stop becomes an end date on the launch, and a safety net pauses the run's campaign if total spend reaches the stop.
- Page rule (latest, owner's words): a product that already has a page (an address the seller set anywhere, a live Revora site, or a draft site) NEVER gets a second page. The team reads it, only suggests optional improvements, and writes the ads, copy and video scripts to echo it. A page is built only when the product has none, as real HTML files (mcp-code site_new / site_write_file), learned from the seller's own pages.
- The team never guesses what a product is: with no description, benefits or page it stops and asks.
- Offer-card and page pictures use the real product photo when there is one; the price in each offer card is read back and redone once if wrong.
- Last change (deployed as ai-team v52, merged with this checkpoint): the "existing page" rule above. NOT yet verified end to end: the run on Brahmi Shakti Kenya read the page (13 headings, 1 button, 0 prices; prices are probably in images) and did its research, then stopped on the OpenAI credit error. Still to confirm after credits: optional improvements list, ad copy echoing the page, video scripts, approval card.

## Sign-up and currency (live)
- Sign-up asks for the country, sets `companies.currency`; phone numbers from outside Nigeria are accepted. Ad spend always follows Meta's own account currency.

## Other sessions (started from this chat)
- Merged and deployed: Dashboard AI tool bridge, confirm cards, cards instead of links, streaming (PRs #400, #403, #404, #405). Autopilot Watching panel and hard stop (#399, #402). Knowledge base tables, hybrid search, ingest/search actions (#401).
- NOT finished: learning notes (`learn_notes`, branch `claude/autopilot-learn-notes`, not merged, `ai-team` action `learn_notes`); knowledge base document ingestion and accuracy numbers; Dashboard AI requests A (autopilot tools in the chat) and B (chat redesign). The shared 5-hour usage limit stopped all three sessions at 17:01 UTC. The Dashboard AI session did not start A or B from relayed messages and is waiting for the owner to tell it directly.
- Chat redesign mock-up approved ("BUILD IT"): https://claude.ai/artifact/2TDnyWfRcWV52K5WBm2BzU

## Open items
- Madhuara (blood sugar) has no description or photo; add them before a run. It has an unpublished draft page from tests.
- Test runs were cancelled; nothing was launched or published. A draft file-based site for Madhuara and some pictures remain in the vault.
- Yannis integration (how orders are announced), "My Company" has 3 active ad accounts and no owner/admin/buyer, Meta access-tier upgrade submission, Termii/Prembly keys, ANTHROPIC_API_KEY (picture reading falls back to OpenAI).
