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
const resourceFor = (req: Request) => (/(^|\.)metaautomationads\.vercel\.app$/.test((req.headers.get("x-forwarded-host") ?? "").split(",")[0].trim()) ? BRANDED : DIRECT);
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

// ── playbook handed to any connected assistant ─────────────────────────────
const PLAYBOOK = `REVORA MEDIA BUYER PLAYBOOK (follow this when running ads for the person)

WHO YOU ARE: their personal senior media buyer for Nigerian online sellers. Explain things in plain words, never dump numbers. Start with a one-sentence answer, then say what the few numbers that matter mean (spend, results, cost per result against their target), then recommend what to do.

PRODUCT FIRST: be completely sure which product ads are for. If the person names one, use exactly that one. If they do not and they sell several, ask. Call get_copy_context before writing any ad copy. If it says product facts are missing, ask what the product is, who it is for and its top 3 benefits, save them with save_product_facts, and only then write. Never write copy for a product from the business type alone, and never borrow another product's claims.

LAUNCHING (always in this order): (1) know the product; (2) ask only what you cannot decide (where ads send people, how many ad sets, who should see it, daily budget) in ONE short question; (3) write the copy (long-form, hooky, in their language, from their own winning ads); (4) list_creatives and let them pick; (5) turn plain audience wishes into real targeting with search_audiences (interests, job types, cities) and Nigerian state names; (6) plan_campaign; (7) show the plan to the person in plain words and WAIT for a clear yes to that exact plan; (8) only then launch_plan. Default structure when they leave it to you: 3 ad sets (an interest audience, a broad audience, one more angle), 3 ads per ad set. Approving turns ads on immediately.

RUNNING ADS: judge an ad only after it has spent about 2 to 3 times the target cost per result. Winners are never killed: scale them by raising the budget about 20 percent, or duplicate them (the winner keeps running and the copy goes live). Only BAD ads are stopped: relaunch a bad ad as a fresh copy (duplicate_ad with pause_original) so it gets a new chance, and switch the old one off. Test one change at a time.

META RULES FOR COPY: no guaranteed results, no before-and-after claims, no implying you know a person's health, body, finances or identity, no medical cures, no fake urgency. Health and wellness copy talks about support, comfort and experience, not cures. Use only facts from the product record or what the person told you. Never invent testimonials, numbers, discounts or registration numbers.

SAFETY: never say anything is live until a launch tool confirms it. Never move money. If a tool returns needs_info, ask the person that question instead of guessing.`;

// ── tool catalogue ──────────────────────────────────────────────────────────
type Tool = {
  name: string; title: string; description: string; inputSchema: any;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  write?: boolean; // counted against the daily limit and written to the audit log
  heavy?: boolean; // launches ads: tighter daily limit
  run: (a: any, c: Ctx) => Promise<any>;
};
type Ctx = { token: string; userId: string; email: string | null; companyId: string; role: string; mediaBuyerId: string | null; displayName: string };

const str = (d: string) => ({ type: "string", description: d });
const accountProp = { ad_account_id: str("Which ad account (id from list_ad_accounts). Optional when the person has only one.") };
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
    run: async (_a, c) => { const { data: co } = await admin.from("companies").select("name, business_types, plan, trial_ends_at, plan_expires_at, copy_language").eq("id", c.companyId).maybeSingle(); return { name: c.displayName, email: c.email, role: c.role, company: co?.name, business_types: co?.business_types, plan: co?.plan, trial_ends_at: co?.trial_ends_at, plan_expires_at: co?.plan_expires_at, copy_language: co?.copy_language }; } },
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
  { name: "list_creatives", title: "List creatives", description: "The person's saved images and videos for a product, ready to use in a campaign. Returns ids to pass to plan_campaign.", inputSchema: OBJ({ ...accountProp, product_name: str("Product to prefer") }), annotations: { readOnlyHint: true },
    run: async (a, c) => { const r: any = await chatTool("show_creatives", a, c, false); const card = (r?.cards || []).find((x: any) => x.type === "creatives"); return { creatives: card?.assets || [], note: "Pass the ids you want as asset_ids to plan_campaign." }; } },
  { name: "get_copy_context", title: "Context for writing ad copy", description: "Everything needed to write strong ads for ONE product: its facts, the person's own winning and losing ads, their language preference and the craft rules. Call this before writing any copy, then write it yourself. If it says facts are missing, ask the person instead of writing.", inputSchema: OBJ({ ...accountProp, product_name: str("Product name") }, ["product_name"]), annotations: { readOnlyHint: true }, run: (a, c) => chatTool("get_copy_context", a, c, true).then((r) => r) },
  { name: "write_ad_copy", title: "Write ad copy (Revora engine)", description: "Revora's own two-pass writer: long-form hooky copy in the person's language, learned from their past ads, locked to one product. Slower and uses Revora's AI quota; use get_copy_context and write it yourself if you prefer.", inputSchema: OBJ({ ...accountProp, product_name: str("Product name"), goal: { type: "string", enum: ["whatsapp", "website"] }, count: { type: "number" }, angle: str("A specific angle"), language_note: str("e.g. full Pidgin, or Yoruba and English"), notes: str("Anything else") }, ["product_name"]), annotations: { readOnlyHint: true, openWorldHint: true }, run: (a, c) => chatTool("write_ad_copy", a, c, true) },
  { name: "save_product_facts", title: "Save product facts", description: "Save what the person told you about a product (what it is, benefits, safety notes) onto its record so ad copy is always about the right product. Use only their words.", inputSchema: OBJ({ product_name: str("Product"), description: str("What it is and what it is for"), benefits: str("Main benefits"), safety_notes: str("How to use it, safety, sizes, or other details") }, ["product_name", "description"]), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, write: true, run: (a, c) => chatTool("save_product_facts", a, c, false) },
  { name: "save_ad_copy", title: "Save ad copy to the library", description: "Keep finished ad copy in the person's own library so it can be reused on any ad account. Pass it in the same markdown shape write_ad_copy returns: '### Ad 1: name', then 'Primary text:' in a code block, then 'Headlines:' and 'Description:'.", inputSchema: OBJ({ raw_markdown: str("The ad copy markdown") }, ["raw_markdown"]), annotations: { readOnlyHint: false, destructiveHint: false }, write: true, run: (a, c) => fn("ai-chat", { action: "save_copy", raw_markdown: a?.raw_markdown }, c) },
  { name: "import_past_ads", title: "Import past ads", description: "Read every ad in an ad account (copy and results) into the person's library so the AI learns from what worked.", inputSchema: OBJ({ ...accountProp, share_to_niche: { type: "boolean", description: "Owners only: share winning copy anonymously with the same niche" } }), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, write: true,
    run: async (a, c) => { const acct = await pickAccount(a, c); if ("error" in acct) return acct; return fn("ai-chat", { action: "import_library", ad_account_id: acct.id, share_to_niche: a?.share_to_niche === true }, c); } },
  { name: "plan_campaign", title: "Plan a campaign (does not launch)", description: "Build a campaign plan and save it as a draft. Spends nothing. Needs the product, destination, 1 to 6 ad sets (who, where, daily budget in naira), the creative ids and the ad copy. Returns a plan_id and a summary. SHOW THE PLAN TO THE PERSON IN PLAIN WORDS and wait for a clear yes before calling launch_plan.", inputSchema: OBJ({
      ...accountProp, product_name: str("Product"), destination: { type: "string", enum: ["whatsapp", "website"] }, landing_url: str("Website link, for website orders"), campaign_name: str("Optional name"),
      asset_ids: { type: "array", items: { type: "string" }, description: "Creative ids from list_creatives" },
      copies: { type: "array", items: { type: "object", properties: { primary_text: { type: "string" }, headline: { type: "string" }, description: { type: "string" } }, required: ["primary_text"] } },
      adsets: { type: "array", items: { type: "object", properties: { label: { type: "string" }, budget_naira: { type: "number" }, age_min: { type: "number" }, age_max: { type: "number" }, gender: { type: "string", enum: ["all", "male", "female"] }, states: { type: "array", items: { type: "string" } }, cities: { type: "array", items: { type: "object" } }, interests: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } } } }, required: ["label", "budget_naira"] } },
    }, ["product_name", "adsets", "asset_ids", "copies"]), annotations: { readOnlyHint: false, destructiveHint: false }, write: true,
    run: async (a, c) => { const r: any = await chatTool("plan_campaign", a, c, true); const card = (r?.cards || []).find((x: any) => x.type === "plan"); if (!card) return r; return { plan_id: card.plan_id, title: card.title, summary: card.summary, ad_sets: card.adsets.map((s: any) => ({ name: s.label, who: s.who, where: s.where, daily_budget_naira: s.budget, estimated_reach: s.reach })), creatives: card.creatives, warnings: card.warnings, your_kill_rule: card.rules, next: "Explain this plan to the person in plain words and wait for their clear yes. Then call launch_plan with this plan_id." }; } },
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
  const lim = await overLimit(t, c);
  if (lim) return { isError: true, content: [{ type: "text", text: lim }] };
  let out: any, ok = true;
  try { out = await t.run(args && typeof args === "object" ? args : {}, c); }
  catch (e) { out = { error: (e as Error).message }; }
  if (out?.error) ok = false;
  if (t.write) await admin.from("mcp_audit").insert({ company_id: c.companyId, user_id: c.userId, tool: name, args: clip(args), ok, client }).then(() => {}, () => {});
  const text = typeof out === "string" ? out : JSON.stringify(out, null, 1);
  return { isError: !ok, content: [{ type: "text", text: text.length > 60000 ? text.slice(0, 60000) + "\n…(shortened)" : text }], ...(ok && out && typeof out === "object" && !Array.isArray(out) ? { structuredContent: out } : {}) };
}

// ── JSON-RPC ────────────────────────────────────────────────────────────────
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
    case "tools/list": return reply({ tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })) });
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
  const path = url.pathname.replace(/^.*?\/mcp(?=\/|$)/, "") || "/";
  const RESOURCE = resourceFor(req);

  if (path === "/.well-known/oauth-protected-resource" || path.startsWith("/.well-known/oauth-protected-resource/")) {
    return jres({ resource: RESOURCE, authorization_servers: [`${SUPABASE_URL}/auth/v1`], bearer_methods_supported: ["header"], resource_name: "Revora", scopes_supported: ["openid", "email", "profile"] });
  }
  if (path === "/health" || (req.method === "GET" && path === "/")) return jres({ ok: true, service: "revora-mcp", version: VERSION, tools: TOOLS.length, resource: RESOURCE });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return unauthorized(RESOURCE);
  const { data: ud, error: ue } = await admin.auth.getUser(token);
  if (ue || !ud?.user) return unauthorized(RESOURCE, "Your sign-in expired. Reconnect Revora.");
  const { data: p } = await admin.from("profiles").select("company_id, role, display_name, media_buyer_id").eq("id", ud.user.id).maybeSingle();
  if (!p?.company_id) return jres({ error: "no_company", error_description: "This account has no Revora company yet. Finish sign-up at the dashboard first." }, 403);
  const c: Ctx = { token, userId: ud.user.id, email: ud.user.email ?? null, companyId: p.company_id, role: p.role, mediaBuyerId: p.media_buyer_id, displayName: p.display_name || "" };

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
