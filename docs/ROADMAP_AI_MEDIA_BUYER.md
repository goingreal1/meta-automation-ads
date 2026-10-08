# Roadmap: the AI media buyer (launch and run ads by chatting)

Saved from the product discussion. Order of work, what already exists, safety rules and open decisions.

## The idea

A user types "launch Lunessa ads, target Lagos and Ibadan, women 25-45, N5,000 a day, 3 ad sets with 3 ads each".
The assistant behaves like a senior personal media buyer. It asks only what it needs, decides the rest, shows a card
for approval, launches, then watches the ads and kills, scales, duplicates and relaunches by the rules it was given.
It is one global brain for the platform, not tied to one person. Each person's own data (their ads, products,
results) is passed in as context on every request.

## Yes, this is function calling

Everything it can do is a tool the model calls. We already have the pieces behind the tools:

| Capability | Already in the codebase |
|---|---|
| Pause, resume, change budget | `ads-manager` actions `set_status`, `set_budget`, chat tools `propose_status_change`, `propose_budget_change` (confirm cards) |
| Audience search, reach estimate, ad preview | `ads-manager` actions `targeting_search`, `reach_estimate`, `ad_preview` |
| Build targeting (states, ages, interests), ad set payloads, create ads | `ai-auto-launch-tests` (`buildTargetingFromConfig`, `launchAdSetGroup`, `createAdCreative`, `createAdWithCTA`) |
| Copy that is on-product and learns from past ads | `ai-chat` `write_ad_copy`, `ad_library`, product lock |
| Live results per ad | `ads-manager` action `list`, chat tool `get_live_ads` |
| Kill rules, auto-kill | `kill_rules`, `ads-manager` `auto_kill` |
| Pixel and CAPI | `meta-capi`, per-ad-account pixel and token |

New tools to add (chat -> existing function, with the same company and buyer scoping the dashboard uses):

1. `plan_campaign` : turns the chat into a structured plan (objective, product, ad sets, audiences, budget, creatives, destination). Stores a draft in `campaign_drafts`.
2. `search_audiences` : wraps `targeting_search` (interests, behaviours, job titles, states, cities).
3. `estimate_reach` : wraps `reach_estimate` so the AI can say "this audience is about 1.2M people, good".
4. `launch_campaign` : only ever called after the person approves the plan card. Uses the existing launch code.
5. `duplicate_ad / duplicate_adset` : copy a winning ad or ad set inside the same campaign (Meta `/copies`), with options: keep original running, pause original, change budget, swap creative.
6. `set_status`, `set_budget` : already exist as proposals, keep them behind cards.
7. `check_pixel` : calls the Meta pixel stats endpoint, answers "is it firing, last event, Purchase count, CAPI match quality", and says what to fix in plain words.
8. `get_creatives` : lists the person's existing creatives (library, vault) with images, for "use existing".
9. `generate_image_creative` : image generation from a product photo and a brief (see Creative section).
10. `research_market` : Ad Library API search for competitor ads in a niche or by keyword (see Research section).

## Cards in the chat (not just text)

The chat gets a small set of interactive cards. The assistant returns structured `cards` next to its text, the dashboard renders them.

- **Question card** : one to four quick questions with tap options (what is the goal, where do people order, which state). Used instead of a wall of questions.
- **Creative card** : "Use an existing creative, upload new ones, or let me generate". Upload button for images and video, primary text, headline and description fields, or "write for me".
- **Plan card** : the campaign as a table: product, objective, audience, locations, budget per day, number of ad sets and ads, rules for kill and scale. Buttons: **Approve and launch**, **Edit**, **Cancel**. Edit opens the same fields inline.
- **Result card** : after launch, what was created with links, and what it will watch.
- **Action cards** (already exist for pause and budget): extend to duplicate and relaunch.

Rule: nothing that spends money, or changes a live ad, happens without an approval tap on a card.
The person can switch on "let the AI act on its own within these limits" per rule later (see autonomy).

## Deciding like an expert (the "brain")

Two layers.

1. **Playbook in the prompt** (ships first): how a senior buyer works. Test structure (one campaign, a few ad sets by audience, 2-3 ads per ad set), how long to wait before judging (spend about 2-3x target cost per result), kill rules, how to scale (raise budget in steps of 20-30%, duplicate winners instead of editing them), when to relaunch, how to read frequency and CTR, WhatsApp versus website objectives, Nigerian audience knowledge (states, cities, buying behaviour).
2. **Learned from our own data** (grows over time): `ad_library`, `kill_rules`, ad kill log, orders and delivery results. A nightly job writes anonymised patterns ("in health and wellness, Lagos women 28-45 with a story hook has a median cost per message of N...") into a `playbook_insights` table, per niche. The assistant reads the insights for the person's niche as context. Only people who opted in to sharing contribute, and nothing identifies a business.

Fine-tuning a model on user data is a later option. First we use retrieval (examples and insights in context), which is cheaper, safer and improves immediately.

## Explaining things properly (fix now, small)

Today the assistant dumps metrics. New response rules, added to the system prompt and checked by a small answer reviewer:

- Start with the answer in one sentence ("Two ads are costing too much, one is doing well").
- Then explain what each number means in plain words, only the ones that matter.
- Group by what to do: **Keep**, **Watch**, **Stop**, with the reason and the number behind it.
- End with the next step, offered as a card button when it is an action.
- No raw lists of every ad unless asked. Use small tables only for comparisons.

## Using the internet safely

Allowed, with limits:

- **Meta Ad Library API** : official, read-only, public ads. Safe. Needs the app's Ad Library access (separate approval from Meta for some regions; Nigeria ads are available through the API for ads about social issues only, so commercial ad research may need the public Ad Library page instead, to be checked).
- **Web search for research** : only through a fixed search tool run on the server, returning titles and short snippets. The model never opens arbitrary links with the user's credentials, and never follows instructions found in pages (prompt injection). Results are labelled as untrusted data in the prompt.
- Never send customer data, tokens or private numbers to a search query.
- Per-user rate limit and cost cap on research calls.

## Seeing images and video

- **Images** : yes. The model can look at product photos and existing creatives (vision input). Used to check the creative matches the product, describe it in the copy brief, and to rate and choose between creatives.
- **Image generation** : yes for static creatives, first version: product photo plus brief -> several variants, saved to the creative library, shown on a creative card for approval. Needs an image model key (OpenAI images or similar); the current OpenAI key may not have access, to check.
- **Video** : not generated yet. We start collecting the data now: every uploaded video creative gets stored with its results (hook type, length, cost per result) in `creative_training_data`. When there are enough examples we can evaluate a video model. Video understanding (describing a video, scoring hooks) can come before generation.

## Autonomy levels

1. **Ask first** (default): every launch and every change is a card.
2. **Act within limits**: the person sets limits (max daily budget, max loss per ad, which actions are allowed) and the AI acts and reports.
3. **Fully autonomous launcher**: runs on a schedule using the library of past copy, creatives and results; still bound by the same limits and by the account's balance.

Hard limits applied in code, whatever the model says: per-account daily spend cap, budget change step limit, no deleting, everything logged with who or what did it and why.

## Dashboard unification (Products, Shop, Creative Vault)

Problem: three tabs that overlap, each with many fields that came from the WhatsApp flow (NAFDAC, warm-up message, and so on), and too many buttons.

Proposal: one **Catalog** area.

- **Products** (the heart): name, photos, price, one short description. Everything else (benefits, safety notes, NAFDAC number, variants, stock, delivery) is under "More details" and only shows the fields that fit the business type chosen at onboarding (health shows NAFDAC and usage, fashion shows sizes and colours, food shows allergens and expiry).
- Each product has tabs: **Details**, **Creatives** (images, videos, saved copy, results), **Page** (its sales page or store page).
- **Shop** becomes a view of the same products as a storefront ("Store"), not a separate list.
- **Creative Vault** becomes the Creatives tab inside each product, plus one global creative library view for browsing everything.
- Same data, one place, fewer buttons: one primary button per screen ("Add product", "Add creative", "Publish").
- Reuse the Mac-style design language from Campaigns and Settings.

## Order of work

1. **Explain better + product-aware chat** (small): response rules above, plus `check_pixel`, `get_creatives`.
2. **Question and creative cards** (frontend card renderer, structured card payloads from `ai-chat`).
3. **Plan card + `plan_campaign` + `launch_campaign`** using the existing launch code, with approval. Start with one objective (WhatsApp messages) and one structure (campaign, N ad sets, M ads).
4. **Duplicate and relaunch tools**, kill and scale rules explained in chat.
5. **Catalog unification** (Products, Shop, Creative Vault).
6. **Ad Library research and web research**, with the safety rules above.
7. **Image generation**, then video data collection and scoring.
8. **Insights job** (global learning across users who opted in), then autonomy levels.

## Open decisions

- Image model provider and key.
- Whether Ad Library API access covers commercial ads in Nigeria, or we use another source.
- Default autonomy limits and who may raise them.
- Whether to ship the Catalog unification before or after the launch-by-chat work.
