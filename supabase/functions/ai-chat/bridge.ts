// TOOL BRIDGE: lets the dashboard assistant (ai-chat) use every tool of the connected-assistant (MCP) functions.
//
// Each mcp-* function answers POST { action: "list" } (its tools) and POST { action: "call", tool, args, ctx } when the
// request carries x-internal-key = the service key. This file reads those lists (cached), turns them into OpenAI function
// definitions, picks only the tool groups a message needs (so we never send ~110 schemas per turn), and calls a tool as the
// signed-in person (same ctx shape ai-team and site-ide use), so the functions' own role rules still apply.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Same order the main MCP function uses: where two groups define one name (plan_campaign, update_plan) the first one wins.
import { AP_GROUP, AUTOPILOT_DEFS, autopilotCard, prepAutopilot, runAutopilot } from "./autopilot.ts";
export const MCP_GROUPS = ["mcp-plan", "mcp-ads", "mcp-money", "mcp-studio", "mcp-social", "mcp-code", "mcp-housing"] as const;

export type ToolDef = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, any>;
  annotations?: Record<string, any>;
  write?: boolean;
  heavy?: boolean;
  group: string;
};
export type BridgeCtx = { token: string; userId: string; email: string | null; companyId: string; role: string; mediaBuyerId: string | null; displayName: string };

// ── registry (remembered for a minute; a group that is down keeps its last known tools) ─────────────────────────
const known = new Map<string, { at: number; defs: ToolDef[] }>();
let inflight: Promise<void> | null = null;
async function groupPost(group: string, payload: unknown, ms = 20_000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${group}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": SERVICE_KEY },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
    const txt = await r.text();
    try { return JSON.parse(txt); } catch { throw new Error(`${group} answered ${r.status}`); }
  } finally { clearTimeout(t); }
}
async function refresh() {
  await Promise.all(MCP_GROUPS.map(async (g) => {
    const have = known.get(g);
    if (have && Date.now() - have.at < 60_000) return;
    try {
      const j = await groupPost(g, { action: "list" }, 8000);
      if (Array.isArray(j?.tools) && j.tools.length) known.set(g, { at: Date.now(), defs: j.tools.map((t: any) => ({ ...t, group: g })) });
    } catch (e) { console.error("bridge list", g, (e as Error).message); }
  }));
}
export async function registry(): Promise<Map<string, ToolDef>> {
  const fresh = MCP_GROUPS.every((g) => { const k = known.get(g); return k && Date.now() - k.at < 60_000; });
  if (!fresh) { inflight = inflight ?? refresh().finally(() => { inflight = null; }); await inflight; }
  const out = new Map<string, ToolDef>();
  for (const g of MCP_GROUPS) for (const d of known.get(g)?.defs ?? []) if (!out.has(d.name)) out.set(d.name, d);
  for (const d of AUTOPILOT_DEFS) out.set(d.name, d); // the dashboard assistant's own Autopilot tools (ai-team)
  return out;
}

// ── which tools the assistant does NOT get from the bridge ───────────────────────────────────────────────────────
// 1) names ai-chat already has by hand: their results feed the existing cards, so the hand-written version stays.
// 2) launch_plan: the dashboard launches only through the Approve button on a plan card (the person's own tap).
// 3) links to pages: the dashboard shows a card instead (see CARD_TOOLS).
export const HAND_WRITTEN = new Set([
  "write_ad_copy", "search_audiences", "estimate_reach", "check_pixel", "plan_campaign", "save_product_facts", "get_product",
  "list_ad_accounts", "get_live_ads", "get_wallet_balance", "request_funds", "get_copy_context",
]);
export const NEVER_BRIDGED = new Set(["launch_plan", "get_playbook", "whoami", "get_upload_link", "get_edit_link", "get_ad_copy_link", "get_order_form_link"]);

// ── intent groups ───────────────────────────────────────────────────────────────────────────────────────────────
export type Area = "autopilot" | "plans" | "creatives" | "products" | "pages" | "money" | "orders" | "social" | "housing";
export const AREAS: Area[] = ["autopilot", "plans", "creatives", "products", "pages", "money", "orders", "social", "housing"];
const AREA_TOOLS: Record<Area, string[]> = {
  autopilot: ["autopilot_status", "start_autopilot", "approve_autopilot_launch", "cancel_autopilot", "retry_autopilot"],
  plans: ["list_plans", "get_plan", "update_plan", "add_ad_set", "cancel_plan", "get_ads", "edit_ad", "search_locations", "duplicate_ad", "set_status", "set_budget",
    "get_object", "update_object", "get_account_performance", "get_alerts", "get_daily_brief", "get_kill_rules", "set_kill_rules", "get_lessons", "import_past_ads",
    "list_lead_forms", "create_lead_form", "get_leads", "link_instagram", "list_page_posts", "add_page_post", "add_carousel", "update_carousel", "list_ad_creatives", "list_creatives", "assign_creative"],
  creatives: ["list_creatives", "list_ad_creatives", "assign_creative", "rename_creative", "update_creative", "delete_creative", "generate_image", "approve_generated_image",
    "discard_generated_image", "import_chat_image", "import_media", "view_image", "get_creative_brief", "list_product_photos", "set_product_photo", "list_site_images",
    "rename_site_image", "remove_site_image", "save_ad_copy", "social_import_media"],
  products: ["list_products", "create_product", "list_packages", "save_package", "remove_package", "list_product_photos", "set_product_photo"],
  pages: ["build_sales_page", "edit_sales_page", "get_sales_page", "get_sales_page_brief", "import_html_page", "publish_sales_page", "start_page_draft", "save_page_html",
    "site_new", "site_list_files", "site_read_file", "site_search", "site_write_file", "site_patch_file", "site_delete_file", "site_history", "site_rollback", "site_set_live", "site_import_zip",
    "list_site_images", "import_media", "list_products", "generate_image", "list_creatives"],
  money: ["get_deposit_account", "list_fund_requests", "decide_fund_request", "transfer_money", "top_up_meta"],
  orders: ["query_orders", "get_leads", "list_products"],
  social: ["social_list_posts", "social_import_media", "social_create_post", "social_manage_post", "list_page_posts", "add_page_post", "list_creatives"],
  housing: ["housing_project_save", "housing_property_save", "housing_properties_list", "housing_applications_list", "housing_application_update", "housing_stats", "housing_tours_list", "housing_tour_update"],
};
// a tool the list above does not know yet (someone adds one to an mcp-* function) still reaches the model through its group
const GROUP_AREA: Record<string, Area> = { "mcp-plan": "plans", "mcp-ads": "plans", "mcp-money": "money", "mcp-studio": "creatives", "mcp-social": "social", "mcp-code": "pages", "mcp-housing": "housing" };

const KEYWORDS: Record<Area, RegExp> = {
  autopilot: /auto ?pilot|ai team|media buyer team|run (my )?ads for me|handle (my )?ads|hands.?off/i,
  plans: /\b(plan|draft|campaign|ad ?set|adset|start time|start date|schedul|launch|budget|audience|targeting|placement|ads?\b|creative copy|headline|primary text|carousel|lead form|instagram|pixel|kill rule|scale|pause|duplicate|relaunch)/i,
  creatives: /\b(creative|image|picture|photo|video|banner|upload|vault|generate|design|thumbnail|flyer|logo|assign)/i,
  products: /\b(product|catalog|catalogue|package|bundle|price|pricing|tier|sku)/i,
  pages: /\b(page|site|website|sales page|landing|html|css|file|domain|publish|preview|template|zip)/i,
  money: /\b(money|wallet|transfer|send ₦|send n\d|top ?up|fund|deposit|withdraw|pay(ment)?|naira|balance|bank|pin)/i,
  orders: /\b(order|customer|delivery|deliveries|lead|buyer list|sold|sales today|revenue|cod|cash on delivery)/i,
  social: /\b(social|post|instagram post|facebook post|page post|story|reel|schedule a post|content calendar)/i,
  housing: /\b(housing|propert(y|ies)|tour|tenant|rent|landlord|apartment|estate|viewing)/i,
};

// Which areas does this message (plus the last couple of turns, so "yes, do that" keeps its tools) need?
export function routeAreas(question: string, history: { role: string; content: string }[] = []): Area[] {
  const own = String(question || "");
  const recent = history.slice(-2).map((m) => String(m.content || "").slice(0, 600)).join(" ");
  const hit = new Set<Area>();
  for (const a of AREAS) if (KEYWORDS[a].test(own)) hit.add(a);
  // a short follow-up ("yes", "do it", "change it to 8am") carries no keywords of its own: keep the areas of the last turn
  if (!hit.size && own.length < 80) for (const a of AREAS) if (KEYWORDS[a].test(recent)) hit.add(a);
  return [...hit];
}

function areasOf(def: ToolDef): Area[] {
  const out = AREAS.filter((a) => AREA_TOOLS[a].includes(def.name));
  return out.length ? out : [GROUP_AREA[def.group] ?? "plans"];
}
export function toolsForAreas(reg: Map<string, ToolDef>, areas: Area[]): ToolDef[] {
  const want = new Set(areas);
  const out: ToolDef[] = [];
  for (const d of reg.values()) {
    if (HAND_WRITTEN.has(d.name) || NEVER_BRIDGED.has(d.name)) continue;
    if (areasOf(d).some((a) => want.has(a))) out.push(d);
  }
  return out;
}

// ── schema conversion ────────────────────────────────────────────────────────────────────────────────────────────
// The model must never be able to say "the person confirmed": these fields are taken out of what it sees, and added by the
// server only after the person's own tap.
export const CONFIRM_FIELDS = ["confirmed", "person_confirmed", "person_approved"] as const;
const SCHEDULE_TOOLS = new Set(["update_plan"]);
const SCHEDULE_PROPS = {
  start_time: { type: "string", description: "Start the campaign at this date and time, like 2026-11-05T08:00:00+01:00. Nigeria time (+01:00) is assumed when no offset is given. Must be at least 10 minutes from now. On update_plan an empty string clears it." },
  end_time: { type: "string", description: "Stop the campaign at this date and time (same format). Must be after start_time. An empty string clears it." },
};
function clean(s: any, depth = 0): any {
  if (!s || typeof s !== "object" || depth > 8) return s;
  if (Array.isArray(s)) return s.map((x) => clean(x, depth + 1));
  const o: Record<string, any> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "additionalProperties" || k === "$schema" || k === "examples") continue;
    o[k] = clean(v, depth + 1);
  }
  if (o.type === "array" && !o.items) o.items = { type: "string" };
  if (o.type === "object" && !o.properties) o.properties = {};
  return o;
}
export function toOpenAI(d: ToolDef) {
  const src = d.inputSchema && typeof d.inputSchema === "object" ? clean(d.inputSchema) : { type: "object", properties: {} };
  const props: Record<string, any> = { ...(src.properties ?? {}) };
  for (const f of CONFIRM_FIELDS) delete props[f];
  if (SCHEDULE_TOOLS.has(d.name)) Object.assign(props, SCHEDULE_PROPS);
  const required = (Array.isArray(src.required) ? src.required : []).filter((r: string) => !(CONFIRM_FIELDS as readonly string[]).includes(r) && r in props);
  let desc = String(d.description ?? d.title ?? d.name).replace(/\s+/g, " ").trim();
  if (desc.length > 1100) desc = desc.slice(0, 1100) + "…";
  return { type: "function", function: { name: d.name, description: desc, parameters: { type: "object", properties: props, ...(required.length ? { required } : {}) } } };
}
export const isReadOnly = (d: ToolDef) => d.annotations?.readOnlyHint === true && d.write !== true;

// ── calling a tool ───────────────────────────────────────────────────────────────────────────────────────────────
// The 10 minutes rule and the Nigeria-time default are the same ones the main MCP function applies to start_time and end_time.
function parseWhen(v: unknown, label: string): { iso: string | null } | { error: string } {
  const raw = String(v ?? "").trim();
  if (!raw) return { iso: null };
  const withZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : raw.replace(" ", "T") + "+01:00";
  const ms = Date.parse(withZone);
  if (!Number.isFinite(ms)) return { error: `${label} is not a valid date and time. Use a form like 2026-11-05T08:00:00+01:00.` };
  return { iso: new Date(ms).toISOString() };
}
export function readSchedule(args: Record<string, any>): { start?: string | null; end?: string | null; error?: string; rest: Record<string, any> } {
  const rest = { ...args };
  let start: string | null | undefined, end: string | null | undefined;
  if ("start_time" in rest) {
    const r = parseWhen(rest.start_time, "start_time");
    if ("error" in r) return { error: r.error, rest };
    start = r.iso;
    if (r.iso && Date.parse(r.iso) < Date.now() + 10 * 60_000) return { error: "start_time must be at least 10 minutes from now. Pick a later time, or leave it out to start straight away.", rest };
  }
  if ("end_time" in rest) {
    const r = parseWhen(rest.end_time, "end_time");
    if ("error" in r) return { error: r.error, rest };
    end = r.iso;
  }
  if (end && start && Date.parse(end) <= Date.parse(start)) return { error: "end_time must be after start_time.", rest };
  delete rest.start_time; delete rest.end_time;
  return { start, end, rest };
}

export async function callTool(d: ToolDef, args: Record<string, any>, ctx: BridgeCtx): Promise<any> {
  if (d.group === AP_GROUP) return await runAutopilot(d, args, ctx).catch((e) => ({ error: (e as Error).message }));
  try {
    const r = await groupPost(d.group, { action: "call", tool: d.name, args: args && typeof args === "object" ? args : {}, ctx }, 140_000);
    return r?.out ?? { error: r?.error ?? "The tool did not answer." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// What the model sees: no pictures, no private helper fields, and a size cap so one big answer cannot slow the next step.
export function forModel(out: any, cap = 14_000): string {
  let o = out;
  if (o && typeof o === "object" && !Array.isArray(o)) {
    o = { ...o };
    if (o.__images) { o.pictures_attached = o.__images.length; delete o.__images; }
    delete o.__meta;
  }
  const s = typeof o === "string" ? o : JSON.stringify(o);
  return s.length > cap ? s.slice(0, cap) + ' …(shortened; ask for one item or narrow the question to see more)"' : s;
}

// ── hook for the knowledge base (built by another session) ───────────────────────────────────────────────────────
// KNOWLEDGE_TOOL_HOOK: when the knowledge base is ready, add a search_knowledge tool here. It should call the ads-manager
// action kb_search { query, k } and return { results: [{ doc_title, url, kind, scope, content, score }] }. Add its OpenAI
// definition to the list returned by extraTools() and answer it in runExtra(). Nothing calls it yet.
export function extraTools(): any[] { return []; }
export async function runExtra(_name: string, _args: Record<string, any>, _ctx: BridgeCtx): Promise<any | undefined> { return undefined; }

// ══ SAFETY: nothing that changes, spends, publishes or moves money runs when the model asks ═══════════════════════════
// The model's call is stored (ai_chat_pending) and a confirm card with the exact settings goes to the person. Only their tap
// on that card (action confirm_tool, signed in as them) runs it, and only then does the server add the confirmed flags.
const MONEY_TOOLS = new Set(["transfer_money", "top_up_meta", "request_funds", "decide_fund_request", "get_deposit_account"]);
const SPEND_TOOLS = new Set(["set_budget", "set_status", "duplicate_ad", "add_ad_set", "edit_ad", "update_object", "social_create_post"]);
const LIVE_TOOLS = new Set(["publish_sales_page", "site_set_live", "social_manage_post", "social_create_post", "edit_ad"]);
export type Risk = "money" | "spend" | "live" | "delete" | "edit";
export function riskOf(d: ToolDef): Risk {
  if (d.group === "mcp-money" || MONEY_TOOLS.has(d.name)) return "money";
  if (LIVE_TOOLS.has(d.name)) return "live";
  if (SPEND_TOOLS.has(d.name)) return "spend";
  if (d.annotations?.destructiveHint === true) return "delete";
  return "edit";
}
const RISK_WARN: Record<Risk, string> = {
  money: "This moves real money. Nothing is sent until you tap Confirm.",
  spend: "This can change what your ads spend. Nothing changes until you tap Confirm.",
  live: "This changes what the public can see. Nothing changes until you tap Confirm.",
  delete: "This removes something and may not be undoable.",
  edit: "Nothing changes until you tap Confirm.",
};
const words = (k: string) => k.replace(/_/g, " ").replace(/\bid\b/i, "").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());
function shortVal(v: any): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.length > 220 ? v.slice(0, 220) + "…" : v;
  if (Array.isArray(v)) return v.length ? v.slice(0, 6).map(shortVal).join("; ") + (v.length > 6 ? ` … (${v.length} in all)` : "") : "";
  try { const s = JSON.stringify(v); return s.length > 220 ? s.slice(0, 220) + "…" : s; } catch { return ""; }
}
const UUID = /^[0-9a-f-]{36}$/i;
type Db = any;
async function friendly(db: Db, key: string, val: string, ctx: BridgeCtx): Promise<string | null> {
  try {
    if (key === "plan_id") { const { data } = await db.from("ai_plans").select("plan").eq("id", val).eq("company_id", ctx.companyId).maybeSingle(); return data?.plan?.campaign_name ? `${data.plan.campaign_name} (draft plan)` : null; }
    if (key === "site_id") { const { data } = await db.from("sites").select("name").eq("id", val).eq("company_id", ctx.companyId).maybeSingle(); return data?.name ? `${data.name} (site)` : null; }
    if (key === "product_id") { const { data } = await db.from("products").select("product_name").eq("id", val).eq("company_id", ctx.companyId).maybeSingle(); return data?.product_name ?? null; }
  } catch { /* fall back to the raw value */ }
  return null;
}
export async function confirmCard(db: Db, id: string, d: ToolDef, args: Record<string, any>, ctx: BridgeCtx) {
  const lines: { k: string; v: string }[] = [];
  for (const [k, v] of Object.entries(args)) {
    let s = shortVal(v);
    if (k === "start_time" || k === "end_time") s = v === "" ? "cleared" : new Date(Date.parse(String(v).includes("T") ? String(v) : String(v).replace(" ", "T") + "+01:00")).toLocaleString("en-NG", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + " (Nigeria time)";
    else if (typeof v === "string" && UUID.test(v)) s = (await friendly(db, k, v, ctx)) ?? s;
    if (s !== "") lines.push({ k: k === "start_time" ? "Starts" : k === "end_time" ? "Stops" : words(k), v: s });
  }
  const risk = riskOf(d);
  return { type: "confirm", pending_id: id, tool: d.name, title: d.title || words(d.name), risk, warn: RISK_WARN[risk], lines: lines.slice(0, 14) };
}

// Called when the model asks for a tool that is not read-only.
export async function queueWrite(db: Db, d: ToolDef, rawArgs: Record<string, any>, ctx: BridgeCtx) {
  const args: Record<string, any> = { ...(rawArgs ?? {}) };
  for (const f of CONFIRM_FIELDS) delete args[f];
  let apPrep: Awaited<ReturnType<typeof prepAutopilot>> | null = null;
  if (d.group === AP_GROUP) {
    apPrep = await prepAutopilot(d, args, ctx);
    if (apPrep.error) return { result: { error: apPrep.error } };
    Object.keys(args).forEach((k) => delete args[k]);
    Object.assign(args, apPrep.args);
  }
  if (SCHEDULE_TOOLS.has(d.name)) { const sc = readSchedule(args); if (sc.error) return { result: { error: sc.error } }; }
  // pending asks for the same thing twice (model retried) are one card
  const { data: row, error } = await db.from("ai_chat_pending").insert({ user_id: ctx.userId, company_id: ctx.companyId, tool: d.name, args }).select("id").single();
  if (error || !row) return { result: { error: "Could not prepare the confirm card: " + (error?.message ?? "unknown") } };
  const card: any = apPrep ? { type: "confirm", pending_id: row.id, tool: d.name, title: d.title || words(d.name), risk: apPrep.risk, warn: apPrep.warn, lines: apPrep.lines } : await confirmCard(db, row.id, d, args, ctx);
  await db.from("ai_chat_pending").update({ summary: card }).eq("id", row.id);
  return {
    card,
    result: { status: "waiting_for_the_persons_tap", note: "NOTHING HAS RUN. A confirm card with these settings is now showing for the person. Tell them in one or two plain sentences what you asked them to confirm. Do not say it is done, and do not call this tool again." },
  };
}

// The person tapped Confirm (or Cancel) on a card. Only their own, still-open, not-yet-used card can run.
export async function runPending(db: Db, id: string, ctx: BridgeCtx, reg: Map<string, ToolDef>) {
  if (!UUID.test(id)) return { ok: false, error: "That confirm card is not valid." };
  const { data: row } = await db.from("ai_chat_pending").select("*").eq("id", id).maybeSingle();
  if (!row || row.user_id !== ctx.userId || row.company_id !== ctx.companyId) return { ok: false, error: "That confirm card was not found on your account." };
  if (row.status !== "pending") return { ok: false, error: row.status === "done" ? "You already confirmed this one." : `This card is ${row.status} and can no longer be used.` };
  if (Date.parse(row.expires_at) < Date.now()) { await db.from("ai_chat_pending").update({ status: "expired" }).eq("id", id).eq("status", "pending"); return { ok: false, error: "This card ran out of time (30 minutes). Ask me again." }; }
  const d = reg.get(row.tool);
  if (!d || NEVER_BRIDGED.has(d.name) || isReadOnly(d)) return { ok: false, error: "That action is not available any more." };
  // take it once: a double tap cannot run it twice
  const { data: took } = await db.from("ai_chat_pending").update({ status: "running" }).eq("id", id).eq("status", "pending").select("id");
  if (!took?.length) return { ok: false, error: "This card was already used." };
  let args: Record<string, any> = { ...row.args };
  let sched: { start?: string | null; end?: string | null } = {};
  if (SCHEDULE_TOOLS.has(d.name)) {
    const sc = readSchedule(args);
    if (sc.error) { await db.from("ai_chat_pending").update({ status: "failed", result: { error: sc.error }, done_at: new Date().toISOString() }).eq("id", id); return { ok: false, error: sc.error }; }
    args = sc.rest; sched = { start: sc.start, end: sc.end };
  }
  for (const f of CONFIRM_FIELDS) args[f] = true; // added here, only after the tap
  let out = await callTool(d, args, ctx);
  const failed = !!out?.error;
  if (!failed && (sched.start !== undefined || sched.end !== undefined)) {
    try {
      const pid = String(args.plan_id ?? "");
      const { data: pl } = pid ? await db.from("ai_plans").select("id").eq("id", pid).eq("company_id", ctx.companyId).maybeSingle() : { data: null };
      if (pl) {
        const { data: cur } = await db.from("ai_plan_options").select("start_time, end_time").eq("plan_id", pid).maybeSingle();
        await db.from("ai_plan_options").upsert({ plan_id: pid, company_id: ctx.companyId, start_time: sched.start === undefined ? cur?.start_time ?? null : sched.start, end_time: sched.end === undefined ? cur?.end_time ?? null : sched.end, updated_at: new Date().toISOString() });
        out = typeof out === "object" && out ? { ...out, schedule_saved: { start_time: sched.start ?? "unchanged", end_time: sched.end ?? "unchanged" } } : out;
      }
    } catch (e) { console.error("schedule save", (e as Error).message); }
  }
  await db.from("ai_chat_pending").update({ status: failed ? "failed" : "done", result: { text: forModel(out, 6000) }, done_at: new Date().toISOString() }).eq("id", id);
  const keep = Object.fromEntries(Object.entries(args).filter(([k]) => !(CONFIRM_FIELDS as readonly string[]).includes(k)).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 200) : v]));
  await db.from("mcp_audit").insert({ company_id: ctx.companyId, user_id: ctx.userId, tool: d.name, args: keep, ok: !failed, client: "dashboard-ai" }).then(() => {}, () => {});
  return failed ? { ok: false, error: String(out.error), tool: d.name } : { ok: true, tool: d.name, title: d.title || words(d.name), out, args };
}
export async function cancelPending(db: Db, id: string, ctx: BridgeCtx) {
  if (!UUID.test(id)) return { ok: false };
  const { data } = await db.from("ai_chat_pending").update({ status: "cancelled", done_at: new Date().toISOString() }).eq("id", id).eq("user_id", ctx.userId).eq("status", "pending").select("id");
  return { ok: !!data?.length };
}

// ══ CARDS, NOT LINKS ═════════════════════════════════════════════════════════════════════════════════════════════════
// A tool answer becomes a card in the chat (the person is already in the dashboard). Links to other pages are never shown;
// pictures become thumbnails.
const QUIET = new Set(["get_creative_brief", "get_sales_page_brief", "view_image", "site_read_file", "site_search", "get_sales_page", "get_lessons", "search_locations", "get_object"]);
const PLAN_TOOLS = new Set(["get_plan", "update_plan", "add_ad_set"]);
const SECRETISH = /token|secret|password|key|signature|link|url|html|content/i;
const scalar = (v: any) => v !== null && v !== undefined && typeof v !== "object";
const pretty = (v: any) => typeof v === "boolean" ? (v ? "yes" : "no") : String(v).length > 90 ? String(v).slice(0, 90) + "…" : String(v);
const isImg = (v: any) => typeof v === "string" && /^https?:\/\/.+\.(png|jpe?g|webp|gif)(\?|$)/i.test(v) || (typeof v === "string" && /\/storage\/v1\/object\/public\//.test(v));

export function cardFor(d: ToolDef, args: Record<string, any>, out: any): any | null {
  if (!out || typeof out !== "object" || out.error) return null;
  if (PLAN_TOOLS.has(d.name)) {
    const pid = String(out.plan_id ?? args.plan_id ?? "");
    return UUID.test(pid) ? { type: "plan_ref", plan_id: pid } : null;
  }
  if (d.name === "site_list_files" && Array.isArray(out.files)) {
    return {
      type: "site", site_id: String(out.site_id ?? args.site_id ?? ""), name: String(out.name ?? "Website"), status: String(out.status ?? ""),
      files: out.files.slice(0, 60).map((f: any) => ({ path: String(f.path), lines: f.lines ?? null, version: f.version ?? null })),
      preview: typeof out.test_link === "string" ? out.test_link : null, live: typeof out.live_link === "string" ? out.live_link : null,
    };
  }
  if (d.name === "autopilot_status") return autopilotCard(out);
  if (QUIET.has(d.name)) return null;
  const title = d.title || words(d.name);
  // the first list of items in the answer becomes a small table (with thumbnails when the items have pictures)
  const listKey = Object.keys(out).find((k) => Array.isArray(out[k]) && out[k].length && typeof out[k][0] === "object");
  if (listKey) {
    const items: any[] = out[listKey];
    const first = items[0];
    const img = Object.keys(first).find((k) => isImg(first[k]) && /preview|image|thumb|photo|url/i.test(k));
    const cols = Object.keys(first).filter((k) => scalar(first[k]) && k !== img && !SECRETISH.test(k) && !/(^id$|_id$|uuid)/i.test(k)).slice(0, 4);
    if (!cols.length && !img) return null;
    return {
      type: "result", title, count: items.length,
      cols: cols.map(words),
      rows: items.slice(0, 8).map((it) => ({ img: img && isImg(it[img]) ? it[img] : null, cells: cols.map((k) => (scalar(it[k]) ? pretty(it[k]) : "")) })),
      more: Math.max(0, items.length - 8),
    };
  }
  const kv = Object.entries(out).filter(([k, v]) => scalar(v) && v !== "" && !SECRETISH.test(k) && !/(^id$|_id$|uuid)/i.test(k)).slice(0, 10).map(([k, v]) => ({ k: words(k), v: pretty(v) }));
  return kv.length ? { type: "result", title, kv } : null;
}
