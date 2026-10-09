import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Revora MCP server (Model Context Protocol, streamable HTTP, stateless JSON).
// Lets the Claude app and ChatGPT use Revora: the person signs in with their own Revora account (Supabase OAuth),
// and every tool runs as THEM, with the same role rules as the dashboard.
//
// - Reads and writes go through the functions the dashboard already uses (ai-chat run_tool, ads-manager), with the
//   person's own token. This function never holds extra power of its own, apart from the audit log and daily limits.
// - Anything that spends money or changes live ads is a write tool: it is logged, capped per day, and marked as such so
//   the client app asks the person before running it. Moving money is not exposed at all.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const VERSION = "1.0.0";
const DIRECT = `${SUPABASE_URL}/functions/v1/mcp`;
// Revora's own address (a Vercel rewrite to this function). It carries the Revora favicon and logo, so Claude and ChatGPT show our brand.
const SITE = "https://metaautomationads.vercel.app";
const BRANDED = `${SITE}/mcp`;
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, accept, x-client-info, apikey",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};
const jres = (obj: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS, ...extra } });
const unauthorized = (resource: string, msg = "Sign in to Revora to use this connector.") =>
  jres({ error: "unauthorized", error_description: msg }, 401, { "WWW-Authenticate": `Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource"` });

// ── playbook handed to any connected assistant ────────────────────────────────────────────────────────────
const PLAYBOOK = `REVORA MEDIA BUYER PLAYBOOK (follow this when running ads for the person)

WHO YOU ARE: their personal senior media buyer for Nigerian online sellers. Explain things in plain words, never dump numbers. Start with a one-sentence answer, then say what the few numbers that matter mean (spend, results, cost per result against their target), then recommend what to do.

PRODUCT FIRST: be completely sure which product ads are for. If the person names one, use exactly that one. If they do not and they sell several, ask. Call get_copy_context before writing any ad copy. If it says product facts are missing, ask what the product is, who it is for and its top 3 benefits, save them with save_product_facts, and only then write. Never write copy for a product from the business type alone, and never borrow another product's claims.

LAUNCHING (always in this order): (1) know the product; (2) ASK, in ONE short message, everything the person has not already told you. Never assume any of these: where ads send people (their WEBSITE to buy, or WHATSAPP chat), the daily budget per ad set, who should see it and where (ages, gender, states), how many ad sets, how many ads per ad set, and IMAGE or VIDEO creatives; (3) write the copy (long-form, hooky, in their language, from their own winning ads); (4) list_creatives and show its table_markdown exactly (creatives only: the product photo is for customers and is never used as an ad creative; if there are unassigned creatives, offer to assign them with assign_creative); say plainly how many images and videos exist (and that there is no video if there is none) and let them pick by number, or by "first / middle / last", or "the ones never used"; (5) turn plain audience wishes into real targeting with search_audiences (interests, job types, cities) and Nigerian state names; (6) plan_campaign with person_confirmed true only when they said all of the above themselves; (7) show the plan to the person in plain words and WAIT for a clear yes to that exact plan; (8) only then launch_plan. Only if they say "you decide" use: 3 ad sets (an interest audience, a broad audience, one more angle), 3 ads per ad set. Approving turns ads on immediately.

CREATIVES AND ADS: an ad is one creative plus one copy. A creative can be REUSED in several ads, so 3 images can make 5 ads: pass ads=[{asset_id, copy_index}, ...] to plan_campaign, one entry per ad, and count the entries to tell the person how many ads each ad set gets. Never duplicate live ads to reach a count (a draft has no Meta ads yet; duplicate_ad only works on ads that already exist). The product photo is NOT a creative: it is what customers see on the order page and WhatsApp, so never use it in an ad unless the person explicitly says so. list_creatives shows what has been used before (used_in_ads) so you can prefer fresh ones or reuse winners.

KILL RULE: it depends on the destination. Website campaigns are judged on cost per PURCHASE, WhatsApp campaigns on cost per MESSAGE. The plan shows the rule that applies. Never judge a website campaign by the WhatsApp message cost.

RUNNING ADS: judge an ad only after it has spent about 2 to 3 times the target cost per result. Winners are never killed: scale them by raising the budget about 20 percent, or duplicate them (the winner keeps running and the copy goes live). Only BAD ads are stopped: relaunch a bad ad as a fresh copy (duplicate_ad with pause_original) so it gets a new chance, and switch the old one off. Test one change at a time.

META RULES FOR COPY: no guaranteed results, no before-and-after claims, no implying you know a person's health, body, finances or identity, no medical cures, no fake urgency. Health and wellness copy talks about support, comfort and experience, not cures. Use only facts from the product record or what the person told you. Never invent testimonials, numbers, discounts or registration numbers.

CREATIVE DESIGN: a good Nigerian direct-response ad has a scroll-stopping hook (3 to 7 words), a real person in the situation, the REAL product pack large, 3 to 4 short benefit ticks, trust badges (pay on delivery, delivery, NAFDAC only if on record) and a clear call-to-action. Match the kind of product: a health seller gets problem-and-relief scenes, a clothes seller gets a model wearing the item, a food seller gets appetising close-ups, and never mix them. Before generate_image call get_creative_brief, ask which style and which 2 to 4 old creatives to copy (list_creatives, then style_reference_urls), keep on-image text SHORT and spelled exactly, and view_image the result: image models often garble small text, so if a word or the pack is wrong, say so and remake with less text.\n\nSEEING: to know whether a product has a product photo, and how many creatives it has, call list_product_photos (never guess from get_product). You can look at pictures with view_image. Before writing copy or image prompts for a product, view its product photo; after generate_image or import_chat_image, view the preview to check it truly matches the product (packaging, colours, text) and tell the person honestly if it does not. Never draw or invent a product's look yourself, and never present a made-up image as the product.\n\nPRODUCT PHOTOS: to give a product a better photo, first ask the person for a photo of the REAL product (they can send it in this chat, or upload it in Revora under Products). Bring it in with import_chat_image, make the new photo with generate_image using reference_url (so the packaging is real), view_image to check it matches, then set_product_photo (confirm first). A product photo is what customers see; it is never an ad creative unless saved separately with approve_generated_image. Never make a product photo without a real sample unless the person insists.\n\nIMAGES: first choice is to make the picture yourself with your own image tool (free for Revora) and pass it to import_chat_image, then approve_generated_image. If you cannot make images, generate_image makes new pictures from the person's own description (use_product_photo keeps the packaging right). They are previews until approve_generated_image saves them as creatives for a product; then plan_campaign can use them. Make what the person asks for; if the tool returns a heads_up, pass it on briefly and let them decide.\n\nADDING THINGS: create_product and set_kill_rules never save on the first call. They return a summary; explain it in plain words and only call again with confirmed true after the person clearly says yes. get_order_form_link gives the product's order page; get_daily_brief and get_alerts answer 'how are we doing' and 'what needs me'.\n\nSAFETY: never say anything is live until a launch tool confirms it. Never move money. If a tool returns needs_info, ask the person that question instead of guessing.`;

// ── tool catalogue ────────────────────────────────────────────────────────────────────────────
type Tool = {
  name: string; title: string; description: string; inputSchema: any;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  meta?: Record<string, unknown>; // client hints, e.g. ChatGPT file inputs
  write?: boolean; // counted against the daily limit and written to the audit log
  heavy?: boolean; // launches ads: tighter daily limit
  run: (a: any, c: Ctx) => Promise<any>;
};
type Ctx = { token: string; userId: string; email: string | null; companyId: string; role: string; mediaBuyerId: string | null; displayName: string };

const str = (d: string) => ({ type: "string", description: d });
const accountProp = { ad_account_id: str("Which ad account (id from list_ad_accounts). Optional when the person has only one.") };
const normName = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Several products can share a name (duplicates). Prefer the one that has a product photo, so the assistant never says "no photo" about the wrong copy.
const pickProd = (prods: any[], name: unknown, loose = false) => { const n = normName(name); let m = prods.filter((p) => normName(p.product_name) === n); if (!m.length && loose) m = prods.filter((p) => normName(p.product_name).includes(n)); return m.find((p) => p.product_image_url) ?? m[0] ?? null; };
// Creative recipes per kind of product, so a health seller never gets clothes-style ads and a food seller never gets pain-scene ads.
const NICHES: Record<string, any> = {
  health: { look: "Dark green/gold or green/yellow, bold painted-brush headline, clean and trustworthy.", human: "A real Nigerian adult in the situation the product helps (holding the stomach, knee, back) plus, if the person wants it, the relieved smiling version. Never a doctor in a white coat, never made-up testimonials.", layout: ["top: scroll-stopping hook, 3-7 words, big", "middle: the person, in the problem moment", "front: the REAL product pack, large, label readable", "3-4 short benefit ticks (comfort, easy to use, natural ingredients)", "bottom bar: delivery / pay on delivery / call to action"], hooks: ["Bloated after every meal?", "Hard to climb stairs?", "Tired of the same pain?", "Stop the struggle. Ease it.", "Your gut deserves the best."], cta: ["Click Order", "Order now, pay on delivery", "Chat us on WhatsApp"], badges: ["Pay on delivery", "Free/fast delivery", "NAFDAC number (only if it is on the product record)"], avoid: ["Do not claim cures, guaranteed results or timeframes you were not given", "Meta often limits before-and-after pictures, body-change claims and 'no side effects': they were asked for, so make them only if the person wants, and tell them the risk", "Never invent a NAFDAC number"] },
  beauty: { look: "Soft, bright, glowing, premium; warm neutrals or the brand colour.", human: "A close, well-lit face or hands showing the product; diverse Nigerian skin tones.", layout: ["hook at top", "glowing model with the product", "2-4 benefit icons", "offer or price strip", "call-to-action"], hooks: ["Glow starts here.", "Your skin, but better.", "Soft, smooth, every day."], cta: ["Order now", "Shop the glow"], badges: ["Pay on delivery", "NAFDAC (if on record)", "Gentle on skin"], avoid: ["No guaranteed skin results", "No before-and-after of skin conditions"] },
  fashion: { look: "Bold, stylish, colourful or editorial; the clothes are the hero.", human: "A model WEARING the item, full or three-quarter body, confident pose, Nigerian street or studio setting. Show the real fabric and colour.", layout: ["short hook or collection name", "model wearing it, large", "price or offer badge", "sizes/colours line", "call-to-action with delivery"], hooks: ["New drop.", "Turn heads today.", "Owambe ready.", "Your size is waiting."], cta: ["Order on WhatsApp", "Shop now, pay on delivery"], badges: ["Delivery nationwide", "Sizes available", "Pay on delivery"], avoid: ["Do not change the item's colour or pattern from the real photo", "No health or body-fix claims"] },
  food: { look: "Warm, appetising, close-up, steam and texture; bright colours.", human: "Hands serving or someone enjoying the food; no pain scenes.", layout: ["mouth-watering hook", "hero food shot, close", "price and what is included", "delivery area and time", "order button"], hooks: ["Hot, fresh, at your door.", "Craving something tasty?", "Weekend special."], cta: ["Order now", "Chat to order"], badges: ["Delivery in your area", "Fresh daily", "Pay on delivery"], avoid: ["Never use pain, bloating or body-problem imagery", "Do not promise health benefits unless the product record says so"] },
  gadgets: { look: "Clean, modern, high contrast, product on a simple background.", human: "Someone using the item happily (earbuds in, phone in hand).", layout: ["feature-led hook", "product large with 3 key specs", "price or discount", "warranty/delivery", "call-to-action"], hooks: ["Power that lasts.", "Upgrade today.", "See the difference."], cta: ["Order now", "Buy now, pay on delivery"], badges: ["Warranty (if on record)", "Fast delivery", "Pay on delivery"], avoid: ["Do not invent specs", "No health claims"] },
  home: { look: "Bright, tidy, aspirational room or kitchen scene.", human: "A person enjoying the space or using the item.", layout: ["problem or benefit hook", "the item in a real room", "3 benefits", "price/offer", "call-to-action"], hooks: ["Make your home feel new.", "Cook faster, stress less."], cta: ["Order now", "Chat to order"], badges: ["Delivery", "Pay on delivery"], avoid: ["Do not invent features"] },
  general: { look: "Clean and bold, brand colours, easy to read on a phone.", human: "A person who matches the buyer, using or enjoying the product.", layout: ["hook at top", "product and person", "3 benefits", "call-to-action"], hooks: ["Meet your new favourite.", "Why wait? Order today."], cta: ["Order now"], badges: ["Delivery", "Pay on delivery"], avoid: ["Do not invent claims"] },
};
const nicheOf = (text: string): string => {
  const t = text.toLowerCase();
  if (/pain|joint|digest|bloat|constipat|capsule|herbal|balm|supplement|wellness|detox|vitamin|immune|diabet|prostate|fibroid|ointment|syrup|health|tingling|neuro/.test(t)) return "health";
  if (/skin|serum|hair|lotion|soap|makeup|beauty|glow|cosmetic|perfume|fragrance|cream/.test(t)) return "beauty";
  if (/cloth|dress|shirt|wear|fashion|gown|shoe|sneaker|\bbags?\b|ankara|senator|jean|fabric|lace|abaya|thrift|native/.test(t)) return "fashion";
  if (/\bfood|rice|jollof|snack|cake|pastry|\bchop|soup|meal|drink|juice|bakery|catering|shawarma|pizza|grill|suya|spice/.test(t)) return "food";
  if (/phone|laptop|gadget|charger|earbud|watch|electronic|speaker|power ?bank|camera/.test(t)) return "gadgets";
  if (/furniture|kitchen|\bhome\b|\bbed\b|decor|appliance|blender|cooker|mattress/.test(t)) return "home";
  return "general";
};
const OBJ = (properties: any, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

async function fn(name: string, body: unknown, c: Ctx) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, { method: "POST", headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { error: `Unexpected reply (${r.status})` }; }
}

// Pick the ad account: the one asked for, or the only one the person has. Always checked against their company and role.
async function pickAccount(a: any, c: Ctx): Promise<{ id: string; name: string } | { error: string }> {
  let q = admin.from("ad_accounts").select("id, name, nickname, media_buyer_id").eq("company_id", c.companyId);
  if (c.role === "buyer") q = q.eq("media_buyer_id", c.mediaBuyerId);
  const { data } = await q;
  const list = data ?? [];
  const want = String(a?.ad_account_id ?? "");
  if (want) {
    const hit = list.find((x: any) => x.id === want);
    return hit ? { id: hit.id, name: hit.nickname || hit.name || hit.id } : { error: "That ad account was not found or is not yours. Call list_ad_accounts." };
  }
  if (list.length === 1) return { id: list[0].id, name: list[0].nickname || list[0].name || list[0].id };
  return { error: list.length ? "More than one ad account. Ask which one, using list_ad_accounts, then pass ad_account_id." : "This person has no ad account connected yet." };
}

async function chatTool(tool: string, args: any, c: Ctx, needAccount: boolean) {
  let ad_account_id: string | undefined;
  if (needAccount) {
    const acct = await pickAccount(args, c);
    if ("error" in acct) return { error: acct.error };
    ad_account_id = acct.id;
  }
  const r = await fn("ai-chat", { action: "run_tool", tool, args, ad_account_id }, c);
  if (r?.error) return { error: r.error };
  return { ...(Array.isArray(r?.result) ? { items: r.result } : r?.result && typeof r.result === "object" ? r.result : { result: r?.result }), ...(r?.cards?.length ? { cards: r.cards } : {}) };
}

const TOOLS: Tool[] = [
  { name: "get_playbook", title: "Revora media buyer playbook", description: "Read this FIRST when the person wants to launch, review or scale ads. It is how a senior media buyer works with Revora: the order of steps, the rules, what never to do.", inputSchema: OBJ({}), annotations: { readOnlyHint: true }, run: async () => ({ playbook: PLAYBOOK }) },
  { name: "whoami", title: "Who am I connected as", description: "The signed-in person, their company and role.", inputSchema: OBJ({}), annotations: { readOnlyHint: true },
    run: async (_a, c) => { if (!c.companyId) return { email: c.email, setup_complete: false, next: SETUP_NEEDED }; const { data: co } = await admin.from("companies").select("name, business_types, plan, trial_ends_at, plan_expires_at, copy_language").eq("id", c.companyId).maybeSingle(); return { name: c.displayName, email: c.email, role: c.role, company: co?.name, business_types: co?.business_types, plan: co?.plan, trial_ends_at: co?.trial_ends_at, plan_expires_at: co?.plan_expires_at, copy_language: co?.copy_language }; } },
  { name: "list_ad_accounts", title: "List ad accounts", description: "The person's Meta ad accounts with balance and status.", inputSchema: OBJ({}), annotations: { readOnlyHint: true }, run: (a, c) => chatTool("list_ad_accounts", a, c, false) },
  { name: "get_live_ads", title: "Live ads from Meta", description: "Every campaign, ad set and ad in an ad account with status, spend, messages or purchases, cost per result, CTR, and whether it breaks the person's kill rules. Use for any question about what is working.", inputSchema: OBJ({ ...accountProp, range: { type: "string", enum: ["today", "yesterday", "last3", "last7", "last30", "lifetime"] }, only_active: { type: "boolean" } }), annotations: { readOnlyHint: true, openWorldHint: true }, run: (a, c) => chatTool("get_live_ads", a, c, true) },
  { name: "get_account_performance", title: "Ad account performance", description: "KPIs for an ad account over some days: spend, orders, cost per order, CTR, per ad set.", inputSchema: OBJ({ ad_account_name: str("Name or nickname of the ad account"), days: { type: "number" } }, ["ad_account_name"]), annotations: { readOnlyHint: true }, run: (a, c) => chatTool("get_ad_account_performance", a, c, false) },
  { name: "list_products", title: "List products", description: "The company's products with price, stock and whether they are active.", inputSchema: OBJ({ search: str("Part of a product name") }), annotations: { readOnlyHint: true }, run: (a, c) => chatTool("query_data", { table: "products", search: a?.search, limit: 50 }, c, false) },
  { name: "get_product", title: "Get a product", description: "Full details of a product: description, benefits, safety notes, price, landing page.", inputSchema: OBJ({ product_name: str("Product name or part of it") }, ["product_name"]), annotations: { readOnlyHint: true }, run: (a, c) => chatTool("get_product", a, c, false) },
  { name: "query_orders", title: "Orders", description: "Orders the person is allowed to see. Filter by status (pending, valid, delivered, cancelled, returned), search by customer name or phone, or limit to the last N days.", inputSchema: OBJ({ search: str("Customer name or phone"), status: str("Order status"), days: { type: "number" }, limit: { type: "number" } }), annotations: { readOnlyHint: true },
    run: (a, c) => chatTool("query_data", { table: "orders", search: a?.search, filters: a?.status ? { order_status: String(a.status) } : {}, days: a?.days, limit: a?.limit }, c, false) },
  { name: "get_wallet_balance", title: "Wallet balance", description: "Funding wallet: for an owner or admin the company breakdown, for a buyer their own balance.", inputSchema: OBJ({}), annotations: { readOnlyHint: true }, run: (a, c) => chatTool("get_wallet_balance", a, c, false) },
  { name: "check_pixel", title: "Check the Meta pixel", description: "Is the ad account's pixel connected and firing? Event counts for the last 7 days (PageView, Purchase) and a plain verdict.", inputSchema: OBJ({ ...accountProp }), annotations: { readOnlyHint: true, openWorldHint: true }, run: (a, c) => chatTool("check_pixel", a, c, true) },
  { name: "search_audiences", title: "Find Meta audiences", description: "Real Meta targeting options. kind 'interest' for interests and job types (business owners, students, new mums), 'city' for Nigerian cities. Use the id and name exactly as returned when planning.", inputSchema: OBJ({ ...accountProp, query: str("What to search for"), kind: { type: "string", enum: ["interest", "city"] } }, ["query"]), annotations: { readOnlyHint: true, openWorldHint: true }, run: (a, c) => chatTool("search_audiences", a, c, true) },
  { name: "estimate_reach", title: "Estimate audience size", description: "Ask Meta how many people an audience reaches (states, cities, interests, ages, gender).", inputSchema: OBJ({ ...accountProp, states: { type: "array", items: { type: "string" } }, cities: { type: "array", items: { type: "object" } }, interests: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } } }, age_min: { type: "number" }, age_max: { type: "number" }, gender: { type: "string", enum: ["all", "male", "female"] } }), annotations: { readOnlyHint: true, openWorldHint: true }, run: (a, c) => chatTool("estimate_reach", a, c, true) },
  { name: "list_creatives", title: "List creatives", description: "Clear table of the ad CREATIVES (images and videos) the person has for a product, with format, upload date and whether each was used in ads. The product photo is NOT a creative and is never listed. Show table_markdown exactly as given, say how many images and videos exist, ask image or video, and let them pick by number. Pass the chosen ids to plan_campaign.", inputSchema: OBJ({ ...accountProp, product_name: str("Product these creatives are for"), type: { type: "string", enum: ["image", "video", "any"], description: "Filter. Default any." }, include_unassigned: { type: "boolean", description: "Also list creatives that have no product yet, so the person can say which product they belong to (then call assign_creative)." } }), annotations: { readOnlyHint: true },
    run: async (a, c) => {
      const key = String(a?.product_name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const { data } = await admin.from("creative_library").select("library_id, source, product_key, kind, url, name, times_used, first_uploaded").eq("company_id", c.companyId).limit(500);
      const seen = new Set<string>();
      const all = (data ?? []).filter((r: any) => /^https:\/\//.test(r.url) && !seen.has(r.url) && seen.add(r.url));
      const unassigned = all.filter((r: any) => !r.product_key);
      const mine = key ? all.filter((r: any) => r.product_key === key || (a?.include_unassigned === true && !r.product_key)) : all;
      const want = a?.type === "image" || a?.type === "video" ? a.type : "any";
      const rows = (want === "any" ? mine : mine.filter((r: any) => r.kind === want)).sort((x: any, y: any) => (x.source === "vault" ? 1 : 0) - (y.source === "vault" ? 1 : 0) || String(x.first_uploaded).localeCompare(String(y.first_uploaded))).slice(0, 24);
      const role = (r: any) => r.source === "product_ad_image" ? "SHOP AD IMAGE (product page)" : r.product_key ? "CREATIVE (vault upload)" : "UNASSIGNED creative (no product yet)";
      const ext = (r: any) => (String(r.name).match(/\.(\w{2,5})$/)?.[1] || r.url.match(/\.(\w{2,5})(?:\?|$)/)?.[1] || "?").toLowerCase();
      const items = rows.map((r: any, i: number) => ({ number: i + 1, id: r.library_id, id_end: String(r.library_id).slice(-6), role: role(r), type: r.kind, file: r.name, format: ext(r), uploaded: String(r.first_uploaded).slice(0, 10), used_in_ads: r.times_used || 0, warning: ext(r) === "webp" ? "webp may not display or may be rejected by Meta; prefer png or jpg" : undefined, preview_url: r.url }));
      const table = ["| # | Preview | Role | File | Format | Uploaded | Used in ads |", "|---|---|---|---|---|---|---|", ...items.map((x: any) => `| ${x.number} | ![#${x.number}](${x.preview_url}) [open](${x.preview_url}) | ${x.role} | ${x.file} (…${x.id_end}) | ${x.format}${x.warning ? " ⚠️" : ""} | ${x.uploaded} | ${x.used_in_ads ? x.used_in_ads : "never"} |`)].join("\n");
      return {
        product: a?.product_name || null,
        counts: { images: mine.filter((r: any) => r.kind === "image").length, videos: mine.filter((r: any) => r.kind === "video").length, creatives_for_this_product: mine.filter((r: any) => r.product_key).length, unassigned_creatives_not_shown: a?.include_unassigned === true ? 0 : unassigned.length, other_products_not_shown: key ? all.filter((r: any) => r.product_key && r.product_key !== key).length : 0 },
        rule: "Only creatives are listed. The product photo (what customers see on the order page and WhatsApp) is never used as an ad creative.",
        table_markdown: table, creatives: items,
        note: "Show table_markdown exactly as given (previews, role, format, upload date, usage). The pictures MUST come only from each row's preview_url: never web-search for images, never use stock or lookalike pictures, and if a picture does not display, give that row's open link instead. Then state the counts in plain words (say 'no video yet' if videos is 0). If unassigned_creatives_not_shown is above 0, tell the person and offer to list them (include_unassigned) so they can say which product they belong to, then call assign_creative. Warn about any webp, and ask image or video and which numbers to use. A creative can be reused in several ads. Pass the chosen ids as asset_ids, and build ads[] if they want more ads than creatives.",
      };
    } },
  { name: "assign_creative", title: "Assign a creative to a product", description: "Link an uploaded creative (image or video) to a product so it shows up for that product only. Use the id from list_creatives. Only do this when the person says which product it belongs to.", inputSchema: OBJ({ creative_id: str("The creative id from list_creatives"), product_name: str("The product it belongs to") }, ["creative_id", "product_name"]), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, write: true,
    run: async (a, c) => {
      if (!["owner", "admin", "buyer"].includes(c.role)) return { error: "Only owners, admins and media buyers can do this." };
      if (!/^[0-9a-f-]{36}$/i.test(String(a?.creative_id))) return { error: "Use the creative id from list_creatives (not a product photo)." };
      const norm = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const { data: prods } = await admin.from("products").select("id, product_name").eq("company_id", c.companyId);
      const hits = (prods ?? []).filter((p: any) => norm(p.product_name) === norm(a?.product_name));
      if (!hits.length) return { error: `No product called "${a?.product_name}". Their products: ${[...new Set((prods ?? []).map((p: any) => p.product_name))].join(", ")}.` };
      const { data: src } = await admin.from("creative_assets").select("public_url").eq("id", a.creative_id).eq("company_id", c.companyId).maybeSingle();
      if (!src?.public_url) return { error: "That creative was not found." };
      // The same image can be saved several times; link every copy so the library stays consistent.
      const { error, count } = await admin.from("creative_assets").update({ product_id: hits[0].id }, { count: "exact" }).eq("company_id", c.companyId).eq("public_url", src.public_url);
      return error ? { error: error.message } : { ok: true, product: hits[0].product_name, copies_linked: count };
    } },
  { name: "create_product", title: "Add a product (asks for confirmation)", description: "Add a new product to the person's catalog. ALWAYS call it first WITHOUT confirmed: it returns a summary. Show that summary in plain words and ask. Only after the person clearly says yes, call again with the same details and confirmed true. Use only facts the person gave you; never invent claims, prices or registration numbers.", inputSchema: OBJ({ product_name: str("Product name"), price_naira: { type: "number", description: "Selling price in naira" }, destination: { type: "string", enum: ["website", "whatsapp"], description: "Where buyers order: on a website/order form, or by messaging on WhatsApp" }, description: str("What it is and what it is for"), benefits: str("Main benefits"), safety_notes: str("How to use it, safety, sizes"), nafdac_reg_no: str("NAFDAC number, only if the person gave one"), landing_page_url: str("Website link, for website orders"), whatsapp_number: str("WhatsApp number, for WhatsApp orders"), stock: { type: "number", description: "Units in stock, if known" }, confirmed: { type: "boolean", description: "True ONLY after the person clearly said yes to the summary." } }, ["product_name", "price_naira", "destination"]), annotations: { readOnlyHint: false, destructiveHint: false }, write: true,
    run: async (a, c) => {
      if (!["owner", "admin", "buyer"].includes(c.role)) return { error: "Only owners, admins and media buyers can add products." };
      const norm = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const name = String(a?.product_name ?? "").trim(), price = Number(a?.price_naira);
      if (name.length < 2 || name.length > 120) return { error: "Give the product a name (2 to 120 characters)." };
      if (!Number.isFinite(price) || price <= 0 || price > 100_000_000) return { error: "Give a selling price in naira." };
      const dest = a?.destination === "whatsapp" ? "whatsapp" : a?.destination === "website" ? "website" : null;
      if (!dest) return { error: "Ask whether people order on a WEBSITE/order form or by WHATSAPP." };
      const { data: existing } = await admin.from("products").select("id, product_name").eq("company_id", c.companyId);
      const dup = (existing ?? []).find((p: any) => norm(p.product_name) === norm(name));
      if (dup) return { error: `A product called "${dup.product_name}" already exists. Use save_product_facts to update it, or pick a different name.` };
      const row: any = { company_id: c.companyId, product_name: name, default_order_value_naira: Math.round(price), destination_type: dest, is_active: true, created_by: c.userId, media_buyer_id: c.role === "buyer" ? c.mediaBuyerId : null };
      for (const k of ["description", "benefits", "safety_notes", "nafdac_reg_no", "landing_page_url", "whatsapp_number"]) if (String(a?.[k] ?? "").trim()) row[k] = String(a[k]).trim().slice(0, 2000);
      if (row.landing_page_url && !/^https:\/\//.test(row.landing_page_url)) return { error: "The website link must start with https://" };
      if (Number.isFinite(Number(a?.stock)) && a?.stock !== undefined && a?.stock !== null) row.stock_on_hand = Math.max(0, Math.round(Number(a.stock)));
      const missing = [!row.description && "description", !row.benefits && "benefits", dest === "website" && !row.landing_page_url && "website link (needed before ads can send people there)", dest === "whatsapp" && !row.whatsapp_number && "WhatsApp number"].filter(Boolean);
      if (a?.confirmed !== true) return { needs_confirmation: true, not_saved_yet: true, summary: { name, price_naira: row.default_order_value_naira, orders_via: dest, description: row.description ?? null, benefits: row.benefits ?? null, stock: row.stock_on_hand ?? null, website: row.landing_page_url ?? null, whatsapp: row.whatsapp_number ?? null }, still_missing: missing, next: "NOT saved yet. Show this summary in plain words, mention anything still missing, and ask if you should save it. Call again with confirmed true only after a clear yes." };
      const { data, error } = await admin.from("products").insert(row).select("id, product_name").single();
      return error ? { error: error.message } : { ok: true, saved: true, product_id: data.id, product: data.product_name, still_missing: missing, next: "Saved. To use it in ads the person still needs creatives for it: upload them in Revora under Products, then call list_creatives." };
    } },
  { name: "get_order_form_link", title: "Order form link for a product", description: "The product's order page link to put on a website, WhatsApp status or an ad. Every product already has one. If the person is a media buyer the link carries their buyer code so orders are credited to them.", inputSchema: OBJ({ product_name: str("Product name") }, ["product_name"]), annotations: { readOnlyHint: true },
    run: async (a, c) => {
      const norm = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const { data: prods } = await admin.from("products").select("id, product_name, is_active, order_form_url").eq("company_id", c.companyId);
      const hit = (prods ?? []).filter((p: any) => norm(p.product_name) === norm(a?.product_name))[0] ?? (prods ?? []).filter((p: any) => norm(p.product_name).includes(norm(a?.product_name)))[0];
      if (!hit) return { error: `No product called "${a?.product_name}". Their products: ${[...new Set((prods ?? []).map((p: any) => p.product_name))].join(", ") || "none yet"}.` };
      let code = ""; if (c.role === "buyer" && c.mediaBuyerId) { const { data: b } = await admin.from("media_buyers").select("code").eq("id", c.mediaBuyerId).maybeSingle(); code = b?.code ? `&buyer=${encodeURIComponent(b.code)}` : ""; }
      return { product: hit.product_name, active: hit.is_active !== false, order_form_link: `${SITE}/order.html?product=${hit.id}${code}`, saved_custom_form_link: hit.order_form_url || null, note: hit.is_active === false ? "This product is switched off, so customers may not be able to order it." : "Share this link. Orders arrive in Revora and the AI confirmation call follows." };
    } },
  { name: "get_kill_rules", title: "My kill rules", description: "The person's own rules for when an ad should be flagged or paused, shown separately for WhatsApp message ads and website purchase ads.", inputSchema: OBJ({}), annotations: { readOnlyHint: true },
    run: async (_a, c) => {
      const { data } = await admin.from("kill_rules").select("kind, enabled, auto_kill, max_cost_per_result, min_spend, min_hours").eq("profile_id", c.userId);
      const label = (k: string) => k === "purchase" ? "Website purchase ads (cost per purchase)" : "WhatsApp message ads (cost per message)";
      const rules = (data ?? []).map((r: any) => ({ kind: r.kind, applies_to: label(r.kind), on: r.enabled, pauses_automatically: r.auto_kill, kill_if_cost_per_result_above_naira: Number(r.max_cost_per_result), only_judge_after_spend_naira: Number(r.min_spend), only_judge_after_hours: Number(r.min_hours) }));
      return { rules, missing: ["messaging", "purchase"].filter((k) => !rules.some((r: any) => r.kind === k)).map(label), note: "Website ads must use the purchase rule and WhatsApp ads the message rule. Winners are never paused." };
    } },
  { name: "set_kill_rules", title: "Change a kill rule (asks for confirmation)", description: "Create or change one of the person's kill rules. ALWAYS call first WITHOUT confirmed to get a before/after summary, show it in plain words, and call again with confirmed true only after a clear yes. Turning on pauses_automatically means ads are paused without asking, so say that plainly.", inputSchema: OBJ({ kind: { type: "string", enum: ["messaging", "purchase"], description: "messaging = WhatsApp message ads, purchase = website ads" }, max_cost_per_result: { type: "number", description: "Kill if cost per result is above this (naira)" }, min_spend: { type: "number", description: "Only judge after this much spend (naira)" }, min_hours: { type: "number", description: "Only judge after this many hours live" }, enabled: { type: "boolean" }, pauses_automatically: { type: "boolean", description: "True = ads that break the rule are paused automatically. False = the AI only flags them." }, confirmed: { type: "boolean", description: "True ONLY after the person clearly said yes to the summary." } }, ["kind", "max_cost_per_result"]), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, write: true,
    run: async (a, c) => {
      if (!["owner", "admin", "buyer"].includes(c.role)) return { error: "Only owners, admins and media buyers have kill rules." };
      const kind = a?.kind === "purchase" ? "purchase" : a?.kind === "messaging" ? "messaging" : null;
      const maxCost = Number(a?.max_cost_per_result), minSpend = a?.min_spend == null ? null : Number(a.min_spend), minHours = a?.min_hours == null ? null : Number(a.min_hours);
      if (!kind) return { error: "kind must be messaging (WhatsApp) or purchase (website)." };
      if (!Number.isFinite(maxCost) || maxCost < 50 || maxCost > 10_000_000) return { error: "max_cost_per_result must be between 50 and 10,000,000 naira." };
      if ((minSpend != null && (!Number.isFinite(minSpend) || minSpend < 0)) || (minHours != null && (!Number.isFinite(minHours) || minHours < 0))) return { error: "min_spend and min_hours cannot be negative." };
      const { data: cur } = await admin.from("kill_rules").select("id, enabled, auto_kill, max_cost_per_result, min_spend, min_hours").eq("profile_id", c.userId).eq("kind", kind).maybeSingle();
      const next = { enabled: a?.enabled ?? cur?.enabled ?? true, auto_kill: a?.pauses_automatically ?? cur?.auto_kill ?? false, max_cost_per_result: maxCost, min_spend: minSpend ?? Number(cur?.min_spend ?? 0), min_hours: minHours ?? Number(cur?.min_hours ?? 0) };
      const show = { applies_to: kind === "purchase" ? "website purchase ads" : "WhatsApp message ads", before: cur ? { on: cur.enabled, pauses_automatically: cur.auto_kill, kill_above_naira: Number(cur.max_cost_per_result), judge_after_spend: Number(cur.min_spend), judge_after_hours: Number(cur.min_hours) } : "no rule yet", after: { on: next.enabled, pauses_automatically: next.auto_kill, kill_above_naira: next.max_cost_per_result, judge_after_spend: next.min_spend, judge_after_hours: next.min_hours } };
      if (a?.confirmed !== true) return { needs_confirmation: true, not_saved_yet: true, change: show, next: "NOT saved yet. Explain this change in plain words" + (next.auto_kill ? ", and say clearly that ads breaking this rule will be paused automatically" : "") + ", then ask. Call again with confirmed true only after a clear yes." };
      const { error } = cur ? await admin.from("kill_rules").update({ ...next, updated_at: new Date().toISOString() }).eq("id", cur.id) : await admin.from("kill_rules").insert({ profile_id: c.userId, company_id: c.companyId, kind, ...next });
      return error ? { error: error.message } : { ok: true, saved: true, change: show };
    } },
  { name: "get_alerts", title: "My Revora alerts", description: "The latest alerts Revora raised for the person: low balance, a purchase or messages, money spent with no result, a winner, ads paused or suggested to pause. Newest first.", inputSchema: OBJ({ limit: { type: "number", description: "How many, default 15, max 40" } }), annotations: { readOnlyHint: true },
    run: async (a, c) => {
      const n = Math.min(Math.max(Number(a?.limit) || 15, 1), 40);
      const { data } = await admin.from("ai_inbox").select("kind, title, body, status, created_at, read_at").eq("profile_id", c.userId).order("created_at", { ascending: false }).limit(n);
      return { unread: (data ?? []).filter((r: any) => !r.read_at).length, alerts: (data ?? []).map((r: any) => ({ when: r.created_at, type: r.kind, title: r.title, detail: r.body, status: r.status })) };
    } },
  { name: "get_daily_brief", title: "Today at a glance", description: "One snapshot for today: spend and results per ad account, balances that are low, orders today and pending, and unread alerts. Use for 'how are we doing today?'. Explain it in plain words, then say what needs attention first.", inputSchema: OBJ({}), annotations: { readOnlyHint: true },
    run: async (_a, c) => {
      const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10); // Lagos is UTC+1
      let aq = admin.from("ad_accounts").select("id, name, nickname, balance_naira, low_balance_threshold_naira, status, media_buyer_id").eq("company_id", c.companyId).eq("status", "active");
      if (c.role === "buyer") aq = aq.eq("media_buyer_id", c.mediaBuyerId);
      const { data: accts } = await aq;
      const ids = (accts ?? []).map((x: any) => x.id);
      const { data: m } = ids.length ? await admin.from("daily_metrics").select("ad_account_id, spend_naira, purchases, conversations").in("ad_account_id", ids).eq("metric_date", today).is("ad_set_ad_id", null) : { data: [] as any[] };
      let oq = admin.from("orders").select("order_status", { count: "exact" }).eq("company_id", c.companyId).gte("ordered_at", `${today}T00:00:00+01:00`);
      if (c.role === "buyer") oq = oq.eq("media_buyer_id", c.mediaBuyerId);
      const { data: orders } = await oq;
      const { count: unread } = await admin.from("ai_inbox").select("id", { count: "exact", head: true }).eq("profile_id", c.userId).is("read_at", null);
      const per = (accts ?? []).map((x: any) => {
        const rows = (m ?? []).filter((r: any) => r.ad_account_id === x.id);
        const spend = rows.reduce((t: number, r: any) => t + Number(r.spend_naira || 0), 0), buys = rows.reduce((t: number, r: any) => t + Number(r.purchases || 0), 0), msgs = rows.reduce((t: number, r: any) => t + Number(r.conversations || 0), 0);
        return { account: x.nickname || x.name, spent_today_naira: Math.round(spend), purchases: buys, messages: msgs, balance_naira: x.balance_naira == null ? null : Math.round(Number(x.balance_naira)), low_balance: x.balance_naira != null && Number(x.balance_naira) <= Number(x.low_balance_threshold_naira ?? 0) };
      });
      const by: Record<string, number> = {}; for (const o of orders ?? []) by[o.order_status] = (by[o.order_status] || 0) + 1;
      return { date: today, accounts: per, total_spent_today_naira: per.reduce((t, x) => t + x.spent_today_naira, 0), orders_today: (orders ?? []).length, orders_today_by_status: by, unread_alerts: unread ?? 0, note: "Spend and results come from Revora's synced numbers, which can be up to about 30 minutes behind Meta. Say that if it matters. For exact live numbers use get_live_ads." };
    } },
  { name: "generate_image", title: "Generate ad images", description: "Make 1 to 4 new images (default 1, drafted at low quality to keep cost down; ask for quality high only for the final one) from the person's own description, with Revora's image model. They are NOT saved as creatives yet: show the preview table, ask which they like, then call approve_generated_image for the ones to keep (or discard_generated_image). Generate what the person asks for; the tool adds a short heads-up if Meta tends to reject something, but never refuse for that reason. Set use_product_photo true to base the picture on the product's own photo so the packaging looks right. Call get_creative_brief first for the right look for this kind of product, and pass 2 to 4 of the person's old creatives as style_reference_urls to copy their layout and hooks.", inputSchema: OBJ({ prompt: str("What the picture should show, in the person's own words (style, scene, text on it, colours)"), count: { type: "number", description: "How many options, 1 to 4. Default 1." }, quality: { type: "string", enum: ["low", "medium", "high"], description: "Default low for drafts. Use high only for a final version the person liked." }, size: { type: "string", enum: ["portrait", "square", "landscape"], description: "portrait suits Facebook and Instagram feeds and stories. Default portrait." }, product_name: str("The product this is for. Needed for use_product_photo and to attach the image to it when approved."), use_product_photo: { type: "boolean", description: "Use the product's own photo as the reference." }, reference_url: str("A real photo of the product to base the picture on: the preview_url from import_chat_image. Use this when the person gave you a sample photo of the real product."), style_reference_urls: { type: "array", items: { type: "string" }, description: "2 to 4 of the person's OLD creatives (urls from list_creatives) whose layout, fonts, colours, hook style and call-to-action should be copied for the new picture." } }, ["prompt"]), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, write: true,
    run: async (a, c) => {
      if (!["owner", "admin", "buyer"].includes(c.role)) return { error: "Only owners, admins and media buyers can generate images." };
      const key = Deno.env.get("OPENAI_API_KEY") ?? "";
      if (!key) return { error: "Image generation is not switched on for this workspace yet." };
      const prompt = String(a?.prompt ?? "").trim().slice(0, 3000);
      if (prompt.length < 5) return { error: "Describe the picture you want." };
      const n = Math.min(Math.max(Math.round(Number(a?.count) || 1), 1), 4);
      const cap = Number(Deno.env.get("IMAGE_DAILY_CAP") ?? "40");
      const { data: used } = await admin.from("mcp_audit").select("args").eq("user_id", c.userId).eq("tool", "generate_image").eq("ok", true).gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
      const already = (used ?? []).reduce((t: number, r: any) => t + Math.min(Math.max(Math.round(Number(r.args?.count) || 1), 1), 4), 0);
      if (already + n > cap) return { error: `Daily image limit reached (${cap} a day, ${already} used). It resets 24 hours after each request.` };
      const quality = ["low", "medium", "high"].includes(a?.quality) ? a.quality : "low";
      const size = a?.size === "square" ? "1024x1024" : a?.size === "landscape" ? "1536x1024" : "1024x1536";
      const model = Deno.env.get("IMAGE_MODEL") ?? "gpt-image-1";
      const norm = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      let product: any = null;
      if (a?.product_name) { const { data: prods } = await admin.from("products").select("id, product_name, product_image_url").eq("company_id", c.companyId); product = pickProd(prods ?? [], a.product_name); }
      let res: Response;
      const genBase = `${SUPABASE_URL}/storage/v1/object/public/creative-vault/generated/${c.companyId}/`;
      const refUrl = a?.reference_url ? String(a.reference_url) : a?.use_product_photo === true && product?.product_image_url ? product.product_image_url : "";
      if (a?.reference_url && !refUrl.startsWith(genBase)) return { error: "reference_url must be a preview_url from import_chat_image." };
      const styles: string[] = [...new Set<string>((Array.isArray(a?.style_reference_urls) ? a.style_reference_urls : []).map(String))].slice(0, 4);
      if (styles.length) { // only the company's own creatives (or its generated previews) may be used as style references
        const { data: own } = await admin.from("creative_library").select("url").eq("company_id", c.companyId).in("url", styles);
        const okUrls = new Set((own ?? []).map((r: any) => r.url));
        const bad = styles.filter((u) => !okUrls.has(u) && !u.startsWith(genBase));
        if (bad.length) return { error: "style_reference_urls must be this company's own creatives from list_creatives." };
      }
      if (refUrl || styles.length) {
        const fd = new FormData(); fd.append("model", model); fd.append("n", String(n)); fd.append("size", size); fd.append("quality", quality);
        let count = 0;
        for (const u of [...(refUrl ? [refUrl] : []), ...styles]) {
          const im = await fetch(u); if (!im.ok) return { error: "Could not read one of the reference pictures." };
          const ct = (im.headers.get("content-type") ?? "image/png").split(";")[0];
          fd.append("image[]", new Blob([await im.arrayBuffer()], { type: ct }), `ref${++count}.${ct.includes("jpeg") ? "jpg" : ct.includes("webp") ? "webp" : "png"}`);
        }
        if (refUrl) fd.append("input_fidelity", "high");
        const lead = (refUrl ? "Image 1 is the REAL product pack: keep its shape, colours, logo and label text exactly as they are. " : "") + (styles.length ? `${refUrl ? "The other images are" : "The images are"} past ads from this seller: copy their layout, type style, colour palette, badge and call-to-action style, but make a NEW ad. ` : "");
        fd.append("prompt", lead + prompt);
        res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd });
      } else {
        res = await fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, prompt, n, size, quality }) });
      }
      const j: any = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(j?.data) || !j.data.length) return { error: "The image model could not make that: " + String(j?.error?.message ?? `status ${res.status}`).slice(0, 300) + " (If this says the key has no access to the image model, the workspace owner needs to enable it.)" };
      const out: any[] = [];
      for (const d of j.data) {
        let bytes: Uint8Array | null = null;
        if (d.b64_json) bytes = Uint8Array.from(atob(d.b64_json), (ch) => ch.charCodeAt(0));
        else if (d.url) { const r = await fetch(d.url); if (r.ok) bytes = new Uint8Array(await r.arrayBuffer()); }
        if (!bytes) continue;
        const path = `generated/${c.companyId}/${crypto.randomUUID()}.png`;
        const up = await admin.storage.from("creative-vault").upload(path, bytes, { contentType: "image/png" });
        if (up.error) return { error: "Could not store the image: " + up.error.message };
        out.push({ number: out.length + 1, preview_url: admin.storage.from("creative-vault").getPublicUrl(path).data.publicUrl });
      }
      if (!out.length) return { error: "The image model returned nothing usable. Try again." };
      const heads = /before.{0,6}after|cure|heal(s|ing)?\b|weight.?loss|lose weight|diabet|cancer|belly fat|no side effects?|guarantee/i.test(prompt) ? "Heads-up: Meta often rejects or limits ads with before-and-after pictures, body changes, 'no side effects', guarantees or medical-cure claims. It was made as asked; the person decides." : undefined;
      const table = ["| # | Preview |", "|---|---|", ...out.map((x) => `| ${x.number} | ![#${x.number}](${x.preview_url}) [open](${x.preview_url}) |`)].join("\n");
      return { made: out.length, not_saved_yet: true, for_product: product?.product_name ?? null, table_markdown: table, options: out, heads_up: heads, note: "These are NOT saved as creatives yet. Show table_markdown exactly (pictures only from preview_url, never other images), ask which they like or what to change. To keep one call approve_generated_image with its preview_url; to remake with changes call generate_image again with their feedback; to drop one call discard_generated_image." };
    } },
  { name: "import_chat_image", title: "Use an image from this chat", description: "Bring a picture that is already in this chat (one the person uploaded, or one YOU made with your own image tool) into Revora as a preview. This costs Revora nothing, so prefer it: make the picture yourself, then pass it here. Pass the picture as image; image_url only if you were given a public link. It is NOT saved as a creative yet: show the preview, ask if they want it, then call approve_generated_image with the preview_url and product_name. Do not use it for the product's own packshot; that stays the product photo.", inputSchema: OBJ({ image: { type: "object", description: "The picture from the chat (file input).", properties: { download_url: { type: "string" }, file_id: { type: "string" } } }, image_url: str("A public link to the picture, only if image is not available") }, []), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, write: true, meta: { "openai/fileParams": ["image"] },
    run: async (a, c) => {
      if (!["owner", "admin", "buyer"].includes(c.role)) return { error: "Only owners, admins and media buyers can add images." };
      const src = String(a?.image?.download_url ?? a?.image_url ?? "");
      if (!/^https:\/\//.test(src)) return { error: "I did not receive the picture. Ask the person to upload it, or use generate_image instead." };
      const host = (() => { try { return new URL(src).hostname; } catch { return ""; } })();
      if (!host || host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":") || host.endsWith(".internal") || host.endsWith(".local")) return { error: "That link is not a public picture link." };
      const r = await fetch(src).catch(() => null);
      if (!r?.ok) return { error: "Could not download the picture (the link may have expired). Send it again." };
      const type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as Record<string, string>)[type];
      if (!ext) return { error: "Only png, jpg or webp pictures are supported here." };
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length > 10 * 1024 * 1024) return { error: "That picture is over 10 MB. Send a smaller one." };
      const path = `generated/${c.companyId}/${crypto.randomUUID()}.${ext}`;
      const up = await admin.storage.from("creative-vault").upload(path, bytes, { contentType: type });
      if (up.error) return { error: "Could not store the picture: " + up.error.message };
      const url = admin.storage.from("creative-vault").getPublicUrl(path).data.publicUrl;
      return { not_saved_yet: true, preview_url: url, table_markdown: `| Preview |\n|---|\n| ![preview](${url}) [open](${url}) |`, note: "Not saved as a creative yet. Show table_markdown exactly, ask if they want to keep it and for which product, then call approve_generated_image with preview_url and product_name." };
    } },
  { name: "get_creative_brief", title: "Creative brief for this product's kind of ad", description: "Call this BEFORE generate_image. It works out what kind of product this is (health, beauty, fashion, food, gadgets, home) and returns the layout, hook ideas, human shot, call-to-action, trust badges and what to avoid for THAT kind of product, plus the real product facts you may use. Then ask the person which style they want (problem and relief, before and after, product hero, lifestyle or offer) and which 2 to 4 of their OLD creatives to copy the look from (use list_creatives, then pass those urls as style_reference_urls). Write the image prompt from this brief; use only the facts it lists.", inputSchema: OBJ({ product_name: str("The product"), niche: { type: "string", enum: ["health", "beauty", "fashion", "food", "gadgets", "home", "general"], description: "Only if the automatic guess is wrong." }, style: { type: "string", enum: ["problem_relief", "before_after", "product_hero", "lifestyle", "offer"], description: "The look the person chose." } }, ["product_name"]), annotations: { readOnlyHint: true },
    run: async (a, c) => {
      const [{ data: prods }, { data: co }] = await Promise.all([admin.from("products").select("product_name, product_image_url, default_order_value_naira, description, benefits, nafdac_reg_no, destination_type").eq("company_id", c.companyId), admin.from("companies").select("business_types").eq("id", c.companyId).maybeSingle()]);
      const p = pickProd(prods ?? [], a?.product_name, true);
      if (!p) return { error: `No product called "${a?.product_name}".` };
      const kind = a?.niche && NICHES[a.niche] ? a.niche : nicheOf(`${p.product_name} ${p.description ?? ""} ${p.benefits ?? ""} ${JSON.stringify(co?.business_types ?? "")}`);
      const r = NICHES[kind];
      const facts = { name: p.product_name, price_naira: p.default_order_value_naira ?? null, benefits: p.benefits ?? null, description: p.description ?? null, nafdac_reg_no: p.nafdac_reg_no ?? null, orders_via: p.destination_type ?? null, has_product_photo: !!p.product_image_url };
      const styleNote = a?.style === "before_after" ? "Split layout: BEFORE (problem moment) on the left, AFTER (relieved, smiling) on the right, product in front. Meta often limits before-and-after ads, so tell the person this risk once; it is their call." : a?.style === "problem_relief" ? "One scene showing the problem moment, the product large in front, benefit ticks, no after picture. Usually safer on Meta than before-and-after." : a?.style === "lifestyle" ? "A person enjoying life with the product, minimal text." : a?.style === "offer" ? "Product plus a clear price/discount badge and delivery line." : "Product large and clear, short hook, benefit ticks.";
      return { niche: kind, guessed: !a?.niche, recipe: r, facts_you_may_use: facts, style: a?.style ?? "ask the person", style_note: styleNote, prompt_template: `Square or portrait social ad for ${p.product_name}. Layout, top to bottom: ${r.layout.join("; ")}. Look: ${r.look} People: ${r.human} Hook (exact words, keep short and spelled correctly): "<your hook>". Call to action (exact words): "<cta>". Use only these facts and words, nothing invented. The product pack must match the reference photo exactly (shape, colours, label).`, next: ["Show the person the niche you detected and ask if it is right.", "Ask which style they want and which 2-4 old creatives to copy (list_creatives; pass their urls as style_reference_urls).", "Fill the template with ONE short hook, the facts above, and call generate_image with use_product_photo true.", "view_image the result: check the pack and every word are correct and spelled right. If text is garbled or the pack looks different, say so and regenerate with shorter text.", "Only use claims, numbers and NAFDAC numbers that appear in facts_you_may_use."] };
    } },
  { name: "list_product_photos", title: "Product photos and creatives at a glance", description: "A clear table of every product with its PRODUCT PHOTO (what customers see on the order page and WhatsApp) and how many ad CREATIVES it has. Use it whenever the person asks about product images, before generating anything, and to answer 'does this product have a photo?'. Show table_markdown exactly. Products with the same name are shown as one row.", inputSchema: OBJ({ product_name: str("Only this product (optional)") }, []), annotations: { readOnlyHint: true },
    run: async (a, c) => {
      const [{ data: prods }, { data: lib }] = await Promise.all([admin.from("products").select("id, product_name, product_image_url, is_active").eq("company_id", c.companyId).limit(300), admin.from("creative_library").select("product_key, kind, source").eq("company_id", c.companyId).limit(1000)]);
      const names = [...new Set((prods ?? []).map((p: any) => normName(p.product_name)))].filter((n) => !a?.product_name || n.includes(normName(a.product_name)));
      const rows = names.map((n) => { const same = (prods ?? []).filter((p: any) => normName(p.product_name) === n); const p = pickProd(same, n)!; const cr = (lib ?? []).filter((r: any) => r.product_key === n && r.source === "vault"); return { product: p.product_name, product_photo_url: p.product_image_url ?? null, has_product_photo: !!p.product_image_url, creatives_images: cr.filter((r: any) => r.kind === "image").length, creatives_videos: cr.filter((r: any) => r.kind === "video").length, duplicate_products: same.length > 1 ? same.length : undefined }; }).slice(0, 40);
      const table = ["| Product | Product photo (customers see) | Creatives (for ads) |", "|---|---|---|", ...rows.map((r) => `| ${r.product}${r.duplicate_products ? ` (${r.duplicate_products} copies)` : ""} | ${r.has_product_photo ? `![photo](${r.product_photo_url})` : "none yet"} | ${r.creatives_images} images, ${r.creatives_videos} videos |`)].join("\n");
      return { table_markdown: table, products: rows, note: "Show table_markdown exactly. The product photo and the creatives are different things. If a product has no photo, ask the person for a photo of the real product; do not use pictures from the web." };
    } },
  { name: "view_image", title: "Look at a product photo or creative", description: "Actually SEE a picture, so you never guess or invent what it looks like. Use it before writing copy or prompts for a product (pass product_name for its product photo), before using a creative (pass its url from list_creatives), and right after generate_image or import_chat_image (pass the preview_url) to check the result really matches the product, then describe it honestly. Never draw or imagine a product's packaging yourself. Images only, not videos.", inputSchema: OBJ({ product_name: str("Look at this product's own photo"), url: str("A preview_url / url from list_creatives, generate_image or import_chat_image") }, []), annotations: { readOnlyHint: true },
    run: async (a, c) => {
      const norm = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      let url = String(a?.url ?? "");
      if (!url && a?.product_name) {
        const { data: prods } = await admin.from("products").select("product_name, product_image_url").eq("company_id", c.companyId);
        const hit = pickProd(prods ?? [], a.product_name, true);
        if (!hit) return { error: `No product called "${a.product_name}".` };
        if (!hit.product_image_url) return { error: `${hit.product_name} has no product photo yet (checked every product with that name). Ask the person for a photo of the real product.` };
        url = hit.product_image_url;
      }
      if (!/^https:\/\//.test(url)) return { error: "Pass product_name, or a url from list_creatives / generate_image." };
      if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)) return { error: "That is a video; I can only show pictures. Ask the person to describe it." };
      const gen = `${SUPABASE_URL}/storage/v1/object/public/creative-vault/generated/${c.companyId}/`;
      let ok = url.startsWith(gen);
      if (!ok) { const [{ data: lib }, { data: prods }] = await Promise.all([admin.from("creative_library").select("url").eq("company_id", c.companyId).eq("url", url).limit(1), admin.from("products").select("id").eq("company_id", c.companyId).or(`product_image_url.eq.${url},ad_image_url.eq.${url}`).limit(1)]); ok = !!(lib?.length || prods?.length); }
      if (!ok) return { error: "That picture is not one of this company's products or creatives." };
      const pub = `${SUPABASE_URL}/storage/v1/object/public/`;
      let r: Response | null = url.startsWith(pub) ? await fetch(url.replace("/object/public/", "/render/image/public/") + "?width=768&quality=75").catch(() => null) : null;
      if (!r?.ok) r = await fetch(url).catch(() => null);
      if (!r?.ok) return { error: "Could not load that picture." };
      const mime = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) return { error: "That file is not a picture I can show." };
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length > 3 * 1024 * 1024) return { error: "That picture is too big to show here (over 3 MB). Open it from the link instead.", url };
      let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { __images: [{ data: btoa(bin), mimeType: mime }], viewed: url, note: "This is the real picture. Describe only what you actually see in it." };
    } },
  { name: "set_product_photo", title: "Set the product photo (asks for confirmation)", description: "Make a picture the product's own PHOTO, the one customers see on the order page and WhatsApp (NOT an ad creative; for creatives use approve_generated_image). Pass the preview_url from generate_image or import_chat_image. ALWAYS call first WITHOUT confirmed: it shows the current photo and the new one. Show both, say plainly this replaces what customers see, and call again with confirmed true only after a clear yes. Prefer a photo made from a real sample of the product so it looks real: ask the person for a photo of the real product (they can send it in this chat, or upload it in Revora under Products) before generating.", inputSchema: OBJ({ product_name: str("The product"), preview_url: str("The preview_url from generate_image or import_chat_image"), confirmed: { type: "boolean", description: "True ONLY after the person clearly said yes." } }, ["product_name", "preview_url"]), annotations: { readOnlyHint: false, destructiveHint: false }, write: true,
    run: async (a, c) => {
      if (!["owner", "admin", "buyer"].includes(c.role)) return { error: "Only owners, admins and media buyers can change a product photo." };
      const norm = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const url = String(a?.preview_url ?? "");
      if (!url.startsWith(`${SUPABASE_URL}/storage/v1/object/public/creative-vault/generated/${c.companyId}/`) || !/\.(png|jpe?g|webp)$/i.test(url)) return { error: "Use a preview_url from generate_image or import_chat_image." };
      const { data: prods } = await admin.from("products").select("id, product_name, product_image_url, media_buyer_id").eq("company_id", c.companyId);
      const hit = pickProd(prods ?? [], a?.product_name);
      if (!hit) return { error: `No product called "${a?.product_name}". Their products: ${[...new Set((prods ?? []).map((p: any) => p.product_name))].join(", ")}.` };
      if (c.role === "buyer" && hit.media_buyer_id !== c.mediaBuyerId) return { error: "A media buyer can only change the photo of their own products. Ask the owner." };
      if (a?.confirmed !== true) return { needs_confirmation: true, not_saved_yet: true, product: hit.product_name, current_photo: hit.product_image_url ?? null, new_photo: url, table_markdown: `| Current photo | New photo |\n|---|---|\n| ${hit.product_image_url ? `![current](${hit.product_image_url})` : "none yet"} | ![new](${url}) |`, next: "NOT saved yet. Show table_markdown, say this replaces the photo customers see on the order page and WhatsApp, and ask. Call again with confirmed true only after a clear yes." };
      const { error } = await admin.from("products").update({ product_image_url: url }).eq("id", hit.id).eq("company_id", c.companyId);
      return error ? { error: error.message } : { ok: true, saved: true, product: hit.product_name, product_photo: url, previous_photo: hit.product_image_url ?? null, note: "Saved as the product photo. It is not an ad creative; to use a picture in ads, save it with approve_generated_image." };
    } },
  { name: "approve_generated_image", title: "Keep a generated image as a creative", description: "Save a generated image into the person's creative vault so it can be used in campaigns. Pass the preview_url from generate_image. Pass product_name so it is linked to that product. It becomes a normal creative (use the returned creative_id as an asset_id in plan_campaign).", inputSchema: OBJ({ preview_url: str("The preview_url from generate_image"), product_name: str("Product to link it to") }, ["preview_url"]), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, write: true,
    run: async (a, c) => {
      if (!["owner", "admin", "buyer"].includes(c.role)) return { error: "Only owners, admins and media buyers can do this." };
      const prefix = `${SUPABASE_URL}/storage/v1/object/public/creative-vault/generated/${c.companyId}/`;
      const url = String(a?.preview_url ?? "");
      if (!url.startsWith(prefix) || !/\.(png|jpe?g|webp)$/i.test(url)) return { error: "That is not one of your generated images. Use a preview_url from generate_image." };
      const { data: have } = await admin.from("creative_assets").select("id").eq("company_id", c.companyId).eq("public_url", url).limit(1);
      if (have?.length) return { ok: true, creative_id: have[0].id, note: "Already saved as a creative." };
      const norm = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      let productId: string | null = null, productName: string | null = null;
      if (a?.product_name) { const { data: prods } = await admin.from("products").select("id, product_name").eq("company_id", c.companyId); const hit = (prods ?? []).find((p: any) => norm(p.product_name) === norm(a.product_name)); if (!hit) return { error: `No product called "${a.product_name}".` }; productId = hit.id; productName = hit.product_name; }
      const { data, error } = await admin.from("creative_assets").insert({ company_id: c.companyId, file_name: /\.png$/i.test(url) ? "AI generated image.png" : "Image from chat" + url.slice(url.lastIndexOf(".")), storage_path: url.slice(`${SUPABASE_URL}/storage/v1/object/public/creative-vault/`.length), public_url: url, asset_type: "image", product_id: productId, uploaded_by: "ai_generated", test_status: "untested", uploaded_at: new Date().toISOString() }).select("id").single();
      return error ? { error: error.message } : { ok: true, creative_id: data.id, linked_to_product: productName, note: productId ? "Saved to the creative vault for this product. Use creative_id as an asset_id in plan_campaign." : "Saved, but not linked to a product. Call assign_creative with the creative_id and a product name." };
    } },
  { name: "discard_generated_image", title: "Throw away a generated image", description: "Delete a generated image the person does not want. Pass its preview_url. Only works on images that were not saved as creatives.", inputSchema: OBJ({ preview_url: str("The preview_url from generate_image") }, ["preview_url"]), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }, write: true,
    run: async (a, c) => {
      const base = `${SUPABASE_URL}/storage/v1/object/public/creative-vault/`;
      const url = String(a?.preview_url ?? "");
      if (!url.startsWith(`${base}generated/${c.companyId}/`)) return { error: "That is not one of your generated images." };
      const { data: saved } = await admin.from("creative_assets").select("id").eq("company_id", c.companyId).eq("public_url", url).limit(1);
      if (saved?.length) return { error: "That image is already saved as a creative, so it was not deleted." };
      const { data: asPhoto } = await admin.from("products").select("id").eq("company_id", c.companyId).eq("product_image_url", url).limit(1);
      if (asPhoto?.length) return { error: "That image is a product photo, so it was not deleted." };
      const { error } = await admin.storage.from("creative-vault").remove([url.slice(base.length)]);
      return error ? { error: error.message } : { ok: true, discarded: true };
    } },
  { name: "get_copy_context", title: "Context for writing ad copy", description: "Everything needed to write strong ads for ONE product: its facts, the person's own winning and losing ads, their language preference and the craft rules. Call this before writing any copy, then write it yourself. If it says facts are missing, ask the person instead of writing.", inputSchema: OBJ({ ...accountProp, product_name: str("Product name") }, ["product_name"]), annotations: { readOnlyHint: true }, run: (a, c) => chatTool("get_copy_context", a, c, true).then((r) => r) },
  { name: "write_ad_copy", title: "Write ad copy (Revora engine)", description: "Revora's own two-pass writer: long-form hooky copy in the person's language, learned from their past ads, locked to one product. Slower and uses Revora's AI quota; use get_copy_context and write it yourself if you prefer.", inputSchema: OBJ({ ...accountProp, product_name: str("Product name"), goal: { type: "string", enum: ["whatsapp", "website"] }, count: { type: "number" }, angle: str("A specific angle"), language_note: str("e.g. full Pidgin, or Yoruba and English"), notes: str("Anything else") }, ["product_name"]), annotations: { readOnlyHint: true, openWorldHint: true }, run: (a, c) => chatTool("write_ad_copy", a, c, true) },
  { name: "save_product_facts", title: "Save product facts", description: "Save what the person told you about a product (what it is, benefits, safety notes) onto its record so ad copy is always about the right product. Use only their words.", inputSchema: OBJ({ product_name: str("Product"), description: str("What it is and what it is for"), benefits: str("Main benefits"), safety_notes: str("How to use it, safety, sizes, or other details") }, ["product_name", "description"]), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, write: true, run: (a, c) => chatTool("save_product_facts", a, c, false) },
  { name: "save_ad_copy", title: "Save ad copy to the library", description: "Keep finished ad copy in the person's own library so it can be reused on any ad account. Pass it in the same markdown shape write_ad_copy returns: '### Ad 1: name', then 'Primary text:' in a code block, then 'Headlines:' and 'Description:'.", inputSchema: OBJ({ raw_markdown: str("The ad copy markdown") }, ["raw_markdown"]), annotations: { readOnlyHint: false, destructiveHint: false }, write: true, run: (a, c) => fn("ai-chat", { action: "save_copy", raw_markdown: a?.raw_markdown }, c) },
  { name: "import_past_ads", title: "Import past ads", description: "Read every ad in an ad account (copy and results) into the person's library so the AI learns from what worked.", inputSchema: OBJ({ ...accountProp, share_to_niche: { type: "boolean", description: "Owners only: share winning copy anonymously with the same niche" } }), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, write: true,
    run: async (a, c) => { const acct = await pickAccount(a, c); if ("error" in acct) return acct; return fn("ai-chat", { action: "import_library", ad_account_id: acct.id, share_to_niche: a?.share_to_niche === true }, c); } },
  { name: "plan_campaign", title: "Plan a campaign (does not launch)", description: "Build a campaign plan and save it as a draft. Spends nothing. Needs, all stated by the person: product, destination (website or WhatsApp), 1 to 6 ad sets (who, where, daily budget in naira), the creative ids, the ads (use ads[] to reuse creatives), and the ad copy. Up to 8 copy versions and 12 ads per ad set. Returns a plan_id and a summary. SHOW THE PLAN TO THE PERSON IN PLAIN WORDS and wait for a clear yes before calling launch_plan.", inputSchema: OBJ({
      ...accountProp, product_name: str("Product"), destination: { type: "string", enum: ["whatsapp", "website"] }, landing_url: str("Website link, for website orders"), campaign_name: str("Optional name"),
      asset_ids: { type: "array", items: { type: "string" }, description: "Creative ids from list_creatives (the 'id' field, even for the product photo)" },
      ads: { type: "array", description: "Exactly which ads each ad set gets, one entry per ad: a creative id and which copy (copy_index, starting at 0). A creative may appear in several ads. Example, 3 images and 5 copies: [{asset_id:A,copy_index:0},{asset_id:B,copy_index:1},{asset_id:C,copy_index:2},{asset_id:A,copy_index:3},{asset_id:B,copy_index:4}]. Omit only when each creative should simply get one ad.", items: { type: "object", properties: { asset_id: { type: "string" }, copy_index: { type: "number" } }, required: ["asset_id", "copy_index"] } },
      person_confirmed: { type: "boolean", description: "True ONLY if the person themselves stated the destination (website or WhatsApp), the daily budget per ad set, who/where and which creatives. Never guess these; ask first." },
      copies: { type: "array", items: { type: "object", properties: { primary_text: { type: "string" }, headline: { type: "string" }, description: { type: "string" } }, required: ["primary_text"] } },
      adsets: { type: "array", items: { type: "object", properties: { label: { type: "string" }, budget_naira: { type: "number" }, age_min: { type: "number" }, age_max: { type: "number" }, gender: { type: "string", enum: ["all", "male", "female"] }, states: { type: "array", items: { type: "string" } }, cities: { type: "array", items: { type: "object" } }, interests: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } } } }, required: ["label", "budget_naira"] } },
    }, ["product_name", "destination", "adsets", "asset_ids", "copies", "person_confirmed"]), annotations: { readOnlyHint: false, destructiveHint: false }, write: true,
    run: async (a, c) => { const r: any = await chatTool("plan_campaign", a, c, true); const card = (r?.cards || []).find((x: any) => x.type === "plan"); if (!card) return r; return { plan_id: card.plan_id, title: card.title, summary: card.summary, ad_sets: card.adsets.map((s: any) => ({ name: s.label, who: s.who, where: s.where, daily_budget_naira: s.budget, estimated_reach: s.reach })), creatives: card.creatives, warnings: card.warnings, your_kill_rule: card.rules, next: "Explain this plan to the person in plain words and wait for their clear yes. It is also saved as a draft in Revora under Campaigns > Drafts, where they can review and approve it too. Then call launch_plan with this plan_id." }; } },
  { name: "update_plan", title: "Edit a draft plan", description: "Change a draft plan: campaign name and, per ad set (same order as the plan), budget_naira, age_min, age_max, states, or remove:true.", inputSchema: OBJ({ plan_id: str("Plan id"), campaign_name: str("New name"), adsets: { type: "array", items: { type: "object", properties: { budget_naira: { type: "number" }, age_min: { type: "number" }, age_max: { type: "number" }, states: { type: "array", items: { type: "string" } }, remove: { type: "boolean" } } } } }, ["plan_id"]), annotations: { readOnlyHint: false, destructiveHint: false }, write: true,
    run: async (a, c) => { const r: any = await fn("ai-chat", { action: "update_plan", plan_id: a?.plan_id, edits: { campaign_name: a?.campaign_name, adsets: a?.adsets } }, c); if (r?.card) return { plan_id: r.card.plan_id, summary: r.card.summary, ad_sets: r.card.adsets.map((s: any) => ({ name: s.label, who: s.who, where: s.where, daily_budget_naira: s.budget, estimated_reach: s.reach })) }; return r; } },
  { name: "launch_plan", title: "LAUNCH a planned campaign (spends money)", description: "Creates the campaign on Meta and turns it ON immediately. Real money starts being spent. Only call after the person has clearly said yes to this exact plan in this conversation, then set person_approved to true.", inputSchema: OBJ({ plan_id: str("Plan id from plan_campaign"), person_approved: { type: "boolean", description: "True only if the person clearly approved this exact plan." } }, ["plan_id", "person_approved"]), annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, write: true, heavy: true,
    run: async (a, c) => { if (a?.person_approved !== true) return { error: "Not launched. Ask the person to approve the plan first, then call again with person_approved true." }; return fn("ai-chat", { action: "approve_plan", plan_id: a?.plan_id }, c); } },
  { name: "cancel_plan", title: "Cancel a draft plan", description: "Discard a draft plan.", inputSchema: OBJ({ plan_id: str("Plan id") }, ["plan_id"]), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, write: true, run: (a, c) => fn("ai-chat", { action: "cancel_plan", plan_id: a?.plan_id }, c) },
  { name: "set_status", title: "Pause or resume an ad, ad set or campaign", description: "Switch a campaign, ad set or ad off (PAUSED) or on (ACTIVE) on Meta. Only stop ads that are bad. Winners are never stopped.", inputSchema: OBJ({ ...accountProp, level: { type: "string", enum: ["campaign", "adset", "ad"] }, object_id: str("Meta id from get_live_ads"), status: { type: "string", enum: ["PAUSED", "ACTIVE"] }, reason: str("One short sentence with the numbers behind it") }, ["level", "object_id", "status", "reason"]), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }, write: true,
    run: async (a, c) => { const acct = await pickAccount(a, c); if ("error" in acct) return acct; return fn("ads-manager", { action: "set_status", ad_account_id: acct.id, level: a?.level, object_id: String(a?.object_id), status: a?.status, reason: "Via connected assistant: " + String(a?.reason ?? "").slice(0, 250) }, c); } },
  { name: "set_budget", title: "Change a daily budget", description: "Set the daily budget (naira) of an ad set or campaign. To scale a winner raise it about 20 percent at a time.", inputSchema: OBJ({ ...accountProp, level: { type: "string", enum: ["campaign", "adset"] }, object_id: str("Meta id from get_live_ads"), daily_budget: { type: "number", description: "New daily budget in naira" }, reason: str("Why") }, ["level", "object_id", "daily_budget", "reason"]), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }, write: true,
    run: async (a, c) => { const nb = Number(a?.daily_budget); if (!Number.isFinite(nb) || nb < 500 || nb > 5_000_000) return { error: "daily_budget must be between 500 and 5,000,000 naira." }; const acct = await pickAccount(a, c); if ("error" in acct) return acct; return fn("ads-manager", { action: "set_budget", ad_account_id: acct.id, level: a?.level, object_id: String(a?.object_id), daily_budget: Math.round(nb), reason: "Via connected assistant: " + String(a?.reason ?? "").slice(0, 250) }, c); } },
  { name: "duplicate_ad", title: "Duplicate an ad or ad set", description: "Copy an ad or ad set inside the same campaign. For a WINNER: the original keeps running and the copy goes live (to scale it). For a BAD ad: set pause_original true to relaunch it as a fresh copy and switch the old one off.", inputSchema: OBJ({ ...accountProp, level: { type: "string", enum: ["ad", "adset"] }, object_id: str("Meta id from get_live_ads"), object_name: str("Name, for the log"), pause_original: { type: "boolean", description: "True only for a bad ad being relaunched." } }, ["level", "object_id"]), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, write: true,
    run: async (a, c) => { const acct = await pickAccount(a, c); if ("error" in acct) return acct; const r: any = await fn("ai-chat", { action: "duplicate", ad_account_id: acct.id, level: a?.level, object_id: String(a?.object_id), object_name: a?.object_name, start_paused: false }, c); if (r?.ok && a?.pause_original === true) { const off: any = await fn("ads-manager", { action: "set_status", ad_account_id: acct.id, level: a?.level, object_id: String(a?.object_id), status: "PAUSED", reason: "Relaunched as a fresh copy via connected assistant" }, c); return { ...r, original_paused: !!off?.ok, ...(off?.ok ? {} : { warning: "The fresh copy is live but the old one could not be switched off: " + (off?.error || "Meta refused") }) }; } return r; } },
];
const SETUP_NEEDED = `This Revora login has not finished setting up yet. Tell the person to open ${SITE}/setup-company.html and choose Personal or Company (it takes a minute), then come back and ask again.`;
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
const LIMITS = { write_per_day: 80, launch_per_day: 5 };

async function overLimit(t: Tool, c: Ctx): Promise<string | null> {
  if (!t.write) return null;
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await admin.from("mcp_audit").select("tool, ok").eq("user_id", c.userId).gte("created_at", since).limit(500);
  const rows = (data ?? []).filter((r: any) => r.ok);
  const names = new Set(TOOLS.filter((x) => x.write).map((x) => x.name));
  if (t.heavy && rows.filter((r: any) => r.tool === t.name).length >= LIMITS.launch_per_day) return `Daily limit reached: at most ${LIMITS.launch_per_day} launches a day through connected assistants. The dashboard has no such limit.`;
  if (rows.filter((r: any) => names.has(r.tool)).length >= LIMITS.write_per_day) return `Daily limit reached: at most ${LIMITS.write_per_day} changes a day through connected assistants.`;
  return null;
}
function clip(args: any) { try { const s = JSON.stringify(args ?? {}); return s.length > 1500 ? { truncated: s.slice(0, 1500) } : args; } catch { return {}; } }

async function callTool(name: string, args: any, c: Ctx, client: string) {
  const t = BY_NAME.get(name);
  if (!t) return { isError: true, content: [{ type: "text", text: `Unknown tool ${name}.` }] };
  if (!c.companyId && name !== "get_playbook" && name !== "whoami") return { isError: true, content: [{ type: "text", text: SETUP_NEEDED }] };
  const lim = await overLimit(t, c);
  if (lim) return { isError: true, content: [{ type: "text", text: lim }] };
  let out: any, ok = true;
  try { out = await t.run(args && typeof args === "object" ? args : {}, c); }
  catch (e) { out = { error: (e as Error).message }; }
  if (out?.error) ok = false;
  if (t.write) await admin.from("mcp_audit").insert({ company_id: c.companyId, user_id: c.userId, tool: name, args: clip(args), ok, client }).then(() => {}, () => {});
  const imgs: any[] = out?.__images ?? []; if (imgs.length) { out = { ...out }; delete out.__images; }
  const text = typeof out === "string" ? out : JSON.stringify(out, null, 1);
  return { isError: !ok, content: [{ type: "text", text: text.length > 60000 ? text.slice(0, 60000) + "\n…(shortened)" : text }, ...imgs.map((m) => ({ type: "image", data: m.data, mimeType: m.mimeType }))], ...(ok && out && typeof out === "object" && !Array.isArray(out) ? { structuredContent: out } : {}) };
}

// ── JSON-RPC ────────────────────────────────────────────────────────────────────────────────
const INSTRUCTIONS = "Revora runs Facebook and Instagram ads and orders for Nigerian online sellers. You act for the signed-in person with their own permissions. For anything about launching, reviewing or scaling ads, call get_playbook first and follow it. Never launch or spend without the person's clear yes. Explain results in plain words, never as a dump of numbers.";

async function handleRpc(msg: any, c: Ctx, client: string): Promise<any | null> {
  const id = msg?.id;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (msg?.jsonrpc !== "2.0" || typeof msg?.method !== "string") return err(-32600, "Invalid request");
  if (id === undefined || id === null) return null; // notification
  switch (msg.method) {
    case "initialize": {
      const want = String(msg?.params?.protocolVersion ?? "");
      return reply({ protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0], capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } }, serverInfo: { name: "revora", title: "Revora", version: VERSION, websiteUrl: SITE, icons: [{ src: `${SITE}/icons/icon-512.png`, mimeType: "image/png", sizes: ["512x512"] }, { src: `${SITE}/icons/icon.svg`, mimeType: "image/svg+xml", sizes: ["any"] }] }, instructions: INSTRUCTIONS });
    }
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations, ...(t.meta ? { _meta: t.meta } : {}) })) });
    case "tools/call": return reply(await callTool(String(msg?.params?.name ?? ""), msg?.params?.arguments, c, client));
    case "prompts/list": return reply({ prompts: [{ name: "run_my_ads", title: "Run my ads", description: "Review how the ads are doing and recommend what to do, like a senior media buyer." }, { name: "launch_ads", title: "Launch ads for a product", description: "Plan and launch a campaign for one product, step by step.", arguments: [{ name: "product", description: "Which product", required: true }] }] });
    case "prompts/get": {
      const n = msg?.params?.name;
      if (n === "run_my_ads") return reply({ messages: [{ role: "user", content: { type: "text", text: "Act as my Revora media buyer. Call get_playbook, then get_live_ads for my ad account, and tell me in plain words how my ads are doing: what to keep and scale, what to watch, and which bad ads to relaunch. Do not change anything until I say yes." } }] });
      if (n === "launch_ads") return reply({ messages: [{ role: "user", content: { type: "text", text: `Act as my Revora media buyer and launch ads for ${msg?.params?.arguments?.product ?? "my product"}. Call get_playbook first and follow it exactly. Ask me only what you cannot decide. Do not launch until I clearly approve the plan.` } }] });
      return err(-32602, "Unknown prompt");
    }
    case "resources/list": return reply({ resources: [] });
    default: return err(-32601, `Method not found: ${msg.method}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  let path = url.pathname.replace(/^.*?\/mcp(?=\/|$)/, "") || "/";
  // The Vercel rewrite adds /_site, which tells us the person came in through Revora's own address.
  const viaSite = path === "/_site" || path.startsWith("/_site/");
  if (viaSite) path = path.slice(6) || "/";
  const RESOURCE = viaSite ? BRANDED : DIRECT;

  if (path === "/.well-known/oauth-protected-resource" || path.startsWith("/.well-known/oauth-protected-resource/")) {
    return jres({ resource: RESOURCE, authorization_servers: [`${SUPABASE_URL}/auth/v1`], bearer_methods_supported: ["header"], resource_name: "Revora", scopes_supported: ["openid", "email", "profile"] });
  }
  if (path === "/health" || (req.method === "GET" && path === "/")) {
    if (url.searchParams.get("probe") === "image") { // free check: does the image model key work? (asks OpenAI for the model, makes no image)
      const k = Deno.env.get("OPENAI_API_KEY") ?? "", m = Deno.env.get("IMAGE_MODEL") ?? "gpt-image-1";
      const r = k ? await fetch(`https://api.openai.com/v1/models/${m}`, { headers: { Authorization: `Bearer ${k}` } }) : null;
      const j: any = r ? await r.json().catch(() => null) : null;
      return jres({ model: m, key_set: !!k, accessible: !!r?.ok, status: r?.status ?? null, error: r && !r.ok ? String(j?.error?.message ?? "").slice(0, 200) : null });
    }
    return jres({ ok: true, service: "revora-mcp", version: VERSION, tools: TOOLS.length, resource: RESOURCE });
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return unauthorized(RESOURCE);
  const { data: ud, error: ue } = await admin.auth.getUser(token);
  if (ue || !ud?.user) return unauthorized(RESOURCE, "Your sign-in expired. Reconnect Revora.");
  const { data: p } = await admin.from("profiles").select("company_id, role, display_name, media_buyer_id").eq("id", ud.user.id).maybeSingle();
  // Anyone with a Revora login can connect. An account that has not finished onboarding connects fine; its tools explain what is left to do.
  const c: Ctx = { token, userId: ud.user.id, email: ud.user.email ?? null, companyId: p?.company_id ?? "", role: p?.role ?? "", mediaBuyerId: p?.media_buyer_id ?? null, displayName: p?.display_name || "" };

  if (req.method === "GET") return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
  if (req.method === "DELETE") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return jres({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return jres({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  const client = String(req.headers.get("user-agent") ?? "").slice(0, 80);
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleRpc(m, c, client)))).filter((x) => x !== null);
    return out.length ? jres(out) : new Response(null, { status: 202, headers: CORS });
  }
  const out = await handleRpc(body, c, client);
  return out === null ? new Response(null, { status: 202, headers: CORS }) : jres(out);
});
