// TOOL BRIDGE: lets the dashboard assistant (ai-chat) use every tool of the connected-assistant (MCP) functions.
//
// Each mcp-* function answers POST { action: "list" } (its tools) and POST { action: "call", tool, args, ctx } when the
// request carries x-internal-key = the service key. This file reads those lists (cached), turns them into OpenAI function
// definitions, picks only the tool groups a message needs (so we never send ~110 schemas per turn), and calls a tool as the
// signed-in person (same ctx shape ai-team and site-ide use), so the functions' own role rules still apply.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Same order the main MCP function uses: where two groups define one name (plan_campaign, update_plan) the first one wins.
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
export type Area = "plans" | "creatives" | "products" | "pages" | "money" | "orders" | "social" | "housing";
export const AREAS: Area[] = ["plans", "creatives", "products", "pages", "money", "orders", "social", "housing"];
const AREA_TOOLS: Record<Area, string[]> = {
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
