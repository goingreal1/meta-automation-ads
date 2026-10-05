import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Ads Manager inside the dashboard: live campaign / ad set / ad rows straight
// from Meta (real status + WhatsApp messaging metrics), a real pause/resume
// switch, and the scheduled auto-kill that applies each profile's kill_rules.
//
//   POST { action: "list", ad_account_id, range }            -> rows at all 3 levels
//   POST { action: "balances", ad_account_id? }              -> live prepaid balance per ad account
//   POST { action: "set_status", ad_account_id, level, object_id, status, reason? }
//   POST { action: "daily", since, until, ad_account_id? }   -> per ad set per day, every account you can see
//   POST { action: "auto_kill", dry_run? } + header x-cron-secret -> scheduled sweep (dry_run previews, pauses nothing)
//
// Authorization: the caller's JWT is used to read ad_accounts through RLS, so a
// user can only ever touch ad accounts they can already see in the dashboard.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SHARED_META_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";
const MSG_ACTION = "onsite_conversion.messaging_conversation_started_7d";
const PURCHASE_ACTIONS = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];
const MAX_AUTO_PAUSES_PER_RUN = 10;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, x-cron-secret",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

class HttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

// -- Meta helpers --
async function graphGet(path: string, params: Record<string, string>, token: string) {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new HttpError(502, data?.error?.message || `Meta error ${res.status}`);
  return data;
}

async function graphGetAll(path: string, params: Record<string, string>, token: string, maxPages = 6) {
  const out: any[] = [];
  let data = await graphGet(path, { limit: "200", ...params }, token);
  out.push(...(data.data ?? []));
  for (let i = 1; i < maxPages && data.paging?.next; i++) {
    const res = await fetch(data.paging.next);
    data = await res.json();
    if (!res.ok || data.error) throw new HttpError(502, data?.error?.message || `Meta error ${res.status}`);
    out.push(...(data.data ?? []));
  }
  return out;
}

async function resolveToken(admin: any, account: any): Promise<string> {
  if (account.meta_connection_id) {
    const { data: conn } = await admin
      .from("meta_connections").select("access_token, status").eq("id", account.meta_connection_id).maybeSingle();
    if (conn?.status === "active" && conn.access_token) return conn.access_token;
  }
  return SHARED_META_TOKEN;
}

// Nigeria is UTC+1 all year; ranges are cut on Nigerian calendar days.
function wat(offsetDays = 0): string {
  const d = new Date(Date.now() + 3600_000 + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}
function rangeParams(range: string): Record<string, string> {
  switch (range) {
    case "today": return { time_range: JSON.stringify({ since: wat(0), until: wat(0) }) };
    case "yesterday": return { time_range: JSON.stringify({ since: wat(-1), until: wat(-1) }) };
    case "last3": return { time_range: JSON.stringify({ since: wat(-2), until: wat(0) }) };
    case "last7": return { time_range: JSON.stringify({ since: wat(-6), until: wat(0) }) };
    case "last30": return { time_range: JSON.stringify({ since: wat(-29), until: wat(0) }) };
    default: return { date_preset: "maximum" };
  }
}

const num = (v: any) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
function actionValue(actions: any[] | undefined, types: string[]): number {
  for (const t of types) {
    const a = (actions ?? []).find((x) => x.action_type === t);
    if (a) return num(a.value);
  }
  return 0;
}

function insightRow(r: any) {
  const spend = num(r.spend);
  const conversations = actionValue(r.actions, [MSG_ACTION]);
  const purchases = actionValue(r.actions, PURCHASE_ACTIONS);
  return {
    spend,
    impressions: num(r.impressions),
    reach: num(r.reach),
    frequency: num(r.frequency),
    clicks: num(r.inline_link_clicks ?? r.clicks),
    ctr: num(r.ctr),
    cpm: num(r.cpm),
    conversations,
    cost_per_conversation: conversations > 0 ? spend / conversations : null,
    purchases,
    cost_per_purchase: purchases > 0 ? spend / purchases : null,
  };
}

const EMPTY = insightRow({});

async function insightsByLevel(actId: string, level: "campaign" | "adset" | "ad", range: string, token: string) {
  const idField = level === "ad" ? "ad_id" : level === "adset" ? "adset_id" : "campaign_id";
  const rows = await graphGetAll(`act_${actId}/insights`, {
    level,
    fields: `${idField},spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpm,actions`,
    ...rangeParams(range),
  }, token);
  const map: Record<string, ReturnType<typeof insightRow>> = {};
  for (const r of rows) map[r[idField]] = insightRow(r);
  return map;
}

const MESSAGING_GOALS = new Set(["CONVERSATIONS", "REPLIES"]);
function adsetKind(a: any): "messaging" | "purchase" | "other" {
  const dest = String(a.destination_type ?? "").toUpperCase();
  if (MESSAGING_GOALS.has(a.optimization_goal) || /WHATSAPP|MESSENGER|DIRECT|MESSAGING/.test(dest)) return "messaging";
  if (["OFFSITE_CONVERSIONS", "VALUE", "CONVERSIONS"].includes(a.optimization_goal)) return "purchase";
  return "other";
}

function withResults(kind: string, m: ReturnType<typeof insightRow>) {
  if (kind === "messaging") return { results: m.conversations, cost_per_result: m.cost_per_conversation, result_label: "Conversations" };
  if (kind === "purchase") return { results: m.purchases, cost_per_result: m.cost_per_purchase, result_label: "Purchases" };
  return { results: null, cost_per_result: null, result_label: "" };
}

// -- kill-rule evaluation --
interface Rule { kind: string; enabled: boolean; auto_kill: boolean; max_cost_per_result: number; min_spend: number; min_hours: number }

function evaluateRule(rule: Rule | undefined, ad: any, life: ReturnType<typeof insightRow>): { kill: boolean; reason: string } | null {
  if (!rule || !rule.enabled) return null;
  if (ad.status !== "ACTIVE" || ad.effective_status !== "ACTIVE") return null;
  const hours = ad.created_time ? (Date.now() - new Date(ad.created_time).getTime()) / 3600_000 : Infinity;
  if (hours < Number(rule.min_hours)) return null;
  if (life.spend < Number(rule.min_spend)) return null;
  const results = ad.kind === "messaging" ? life.conversations : life.purchases;
  const label = ad.kind === "messaging" ? "conversation" : "purchase";
  const cost = results > 0 ? life.spend / results : null;
  const naira = (n: number) => "₦" + Math.round(n).toLocaleString("en-NG");
  if (results === 0) {
    return { kill: true, reason: `Spent ${naira(life.spend)} over ${Math.round(hours)}h with 0 ${label}s (rule: kill after ${naira(Number(rule.min_spend))}).` };
  }
  if (cost! > Number(rule.max_cost_per_result)) {
    return { kill: true, reason: `${naira(cost!)} per ${label} is above your ${naira(Number(rule.max_cost_per_result))} limit (${results} ${label}${results === 1 ? "" : "s"}, ${naira(life.spend)} spent).` };
  }
  return null;
}

// -- account access --
async function getUserContext(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) throw new HttpError(401, "Not signed in.");
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userRes, error } = await userClient.auth.getUser();
  if (error || !userRes?.user) throw new HttpError(401, "Not signed in.");
  const { data: profile } = await userClient.from("profiles").select("id, company_id, role, media_buyer_id").eq("id", userRes.user.id).maybeSingle();
  if (!profile) throw new HttpError(403, "No profile.");
  if (!["owner", "admin", "buyer"].includes(profile.role)) throw new HttpError(403, "Your role cannot manage ads.");
  return { userClient, profile };
}

async function getAccount(userClient: any, adAccountId: string) {
  if (!adAccountId) throw new HttpError(400, "ad_account_id is required.");
  const { data: account } = await userClient
    .from("ad_accounts").select("id, meta_ad_account_id, nickname, company_id, meta_connection_id, media_buyer_id, user_id")
    .eq("id", adAccountId).maybeSingle();
  if (!account) throw new HttpError(404, "Ad account not found or not yours.");
  const actId = String(account.meta_ad_account_id ?? "").replace(/^act_/, "");
  if (!/^\d+$/.test(actId)) throw new HttpError(400, "This ad account is not connected to Meta.");
  return { account, actId };
}

// -- list --
async function loadAccountObjects(actId: string, token: string, range: string, needLifetimeAds: boolean) {
  const [campaigns, adsets, ads, cIns, sIns, aIns, aLife] = await Promise.all([
    graphGetAll(`act_${actId}/campaigns`, { fields: "id,name,objective,status,effective_status,daily_budget,lifetime_budget,created_time" }, token),
    graphGetAll(`act_${actId}/adsets`, { fields: "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,destination_type,created_time" }, token),
    graphGetAll(`act_${actId}/ads`, { fields: "id,name,adset_id,campaign_id,status,effective_status,created_time,creative{thumbnail_url}" }, token),
    insightsByLevel(actId, "campaign", range, token),
    insightsByLevel(actId, "adset", range, token),
    insightsByLevel(actId, "ad", range, token),
    needLifetimeAds ? insightsByLevel(actId, "ad", "lifetime", token) : Promise.resolve(null),
  ]);
  return { campaigns, adsets, ads, cIns, sIns, aIns, aLife: aLife ?? aIns };
}

async function handleList(userClient: any, profile: any, body: any) {
  const { account, actId } = await getAccount(userClient, body.ad_account_id);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const token = await resolveToken(admin, account);
  const range = ["today", "yesterday", "last3", "last7", "last30", "lifetime"].includes(body.range) ? body.range : "last7";

  const { data: ruleRows } = await userClient.from("kill_rules").select("*").eq("profile_id", profile.id);
  const rules: Record<string, Rule> = {};
  for (const r of ruleRows ?? []) rules[r.kind] = r;

  const { campaigns, adsets, ads, cIns, sIns, aIns, aLife } = await loadAccountObjects(actId, token, range, range !== "lifetime");

  const adsetById: Record<string, any> = {};
  const campKinds: Record<string, Set<string>> = {};
  const adsetRows = adsets.map((a: any) => {
    const kind = adsetKind(a);
    adsetById[a.id] = { ...a, kind };
    (campKinds[a.campaign_id] ??= new Set()).add(kind);
    const m = sIns[a.id] ?? EMPTY;
    return {
      id: a.id, name: a.name, campaign_id: a.campaign_id, status: a.status, effective_status: a.effective_status,
      daily_budget: a.daily_budget ? num(a.daily_budget) / 100 : null, kind, created_time: a.created_time,
      ...m, ...withResults(kind, m),
    };
  });
  const campaignRows = campaigns.map((c: any) => {
    const kinds = campKinds[c.id] ?? new Set();
    const kind = kinds.has("messaging") ? "messaging" : kinds.has("purchase") ? "purchase" : "other";
    const m = cIns[c.id] ?? EMPTY;
    return {
      id: c.id, name: c.name, objective: c.objective, status: c.status, effective_status: c.effective_status,
      daily_budget: c.daily_budget ? num(c.daily_budget) / 100 : null, kind, created_time: c.created_time,
      ...m, ...withResults(kind, m),
    };
  });
  const adRows = ads.map((a: any) => {
    const kind = adsetById[a.adset_id]?.kind ?? "other";
    const m = aIns[a.id] ?? EMPTY;
    const life = aLife[a.id] ?? EMPTY;
    const suggestion = evaluateRule(rules[kind], { ...a, kind }, life);
    return {
      id: a.id, name: a.name, adset_id: a.adset_id, campaign_id: a.campaign_id, status: a.status,
      effective_status: a.effective_status, kind, created_time: a.created_time,
      thumbnail_url: a.creative?.thumbnail_url ?? null,
      ...m, ...withResults(kind, m), suggestion,
    };
  });

  return {
    ok: true, range, fetched_at: new Date().toISOString(),
    account: { id: account.id, name: account.nickname },
    campaigns: campaignRows, adsets: adsetRows, ads: adRows,
  };
}

// -- daily (Overview + Ad Spend & ROAS) --
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
async function handleDaily(userClient: any, body: any) {
  const since = String(body.since ?? ""), until = String(body.until ?? "");
  if (!DATE_RE.test(since) || !DATE_RE.test(until) || since > until) throw new HttpError(400, "since/until must be YYYY-MM-DD dates.");
  if ((new Date(until).getTime() - new Date(since).getTime()) / 86400_000 > 92) throw new HttpError(400, "Range is limited to 92 days.");
  let q = userClient.from("ad_accounts").select("id, meta_ad_account_id, nickname, company_id, meta_connection_id, media_buyer_id").eq("status", "active");
  if (body.ad_account_id) q = q.eq("id", body.ad_account_id);
  const { data: accounts } = await q;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const usable = (accounts ?? []).filter((a: any) => /^\d+$/.test(String(a.meta_ad_account_id ?? "").replace(/^act_/, "")));
  const results = await Promise.allSettled(usable.map(async (a: any) => {
    const actId = String(a.meta_ad_account_id).replace(/^act_/, "");
    const token = await resolveToken(admin, a);
    const rows = await graphGetAll(`act_${actId}/insights`, {
      level: "adset", time_increment: "1", time_range: JSON.stringify({ since, until }),
      fields: "adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpc,cpm,actions",
    }, token, 12);
    return rows.map((r: any) => ({
      date: r.date_start, account_id: a.id, media_buyer_id: a.media_buyer_id ?? null,
      campaign_id: r.campaign_id, campaign_name: r.campaign_name, adset_id: r.adset_id, adset_name: r.adset_name,
      ...insightRow(r), cpc: num(r.cpc),
    }));
  }));
  const rows: any[] = [];
  const info = usable.map((a: any, i: number) => {
    const r = results[i];
    if (r.status === "fulfilled") { rows.push(...r.value); return { id: a.id, name: a.nickname, media_buyer_id: a.media_buyer_id ?? null, rows: r.value.length }; }
    return { id: a.id, name: a.nickname, media_buyer_id: a.media_buyer_id ?? null, error: String((r.reason as any)?.message ?? r.reason) };
  });
  return { ok: true, since, until, accounts: info, rows };
}

// -- balances (prepaid wallet left in each ad account) --
// funding_source_details.display_string is what Meta's own UI shows, e.g.
// "Available balance (NGN2,323.94)". The plain `balance` field is spend not
// yet billed, NOT money left, so it is only reported separately as "owed".
function parseAvailable(display: string | undefined): number | null {
  const m = String(display ?? "").match(/([\d,]+\.\d{2})/);
  return m ? parseFloat(m[1].replace(/,/g, "")) : null;
}
async function handleBalances(userClient: any, body: any) {
  let q = userClient.from("ad_accounts").select("id, meta_ad_account_id, nickname, meta_connection_id, low_balance_threshold_naira").eq("status", "active");
  if (body.ad_account_id) q = q.eq("id", body.ad_account_id);
  const { data: accounts } = await q;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const usable = (accounts ?? []).filter((a: any) => /^\d+$/.test(String(a.meta_ad_account_id ?? "").replace(/^act_/, "")));
  const results = await Promise.allSettled(usable.map(async (a: any) => {
    const actId = String(a.meta_ad_account_id).replace(/^act_/, "");
    const token = await resolveToken(admin, a);
    const d = await graphGet(`act_${actId}`, { fields: "account_status,currency,balance,amount_spent,spend_cap,is_prepay_account,funding_source_details" }, token);
    const available = parseAvailable(d.funding_source_details?.display_string);
    if (available !== null) {
      await admin.from("ad_accounts").update({ balance_naira: available, balance_updated_at: new Date().toISOString() }).eq("id", a.id);
    }
    return {
      id: a.id, name: a.nickname, currency: d.currency ?? "NGN",
      available, is_prepay: d.is_prepay_account === true,
      owed: d.balance !== undefined ? num(d.balance) / 100 : null,
      funding_label: d.funding_source_details?.display_string ?? null,
      account_status: d.account_status ?? null,
      low_threshold: a.low_balance_threshold_naira != null ? num(a.low_balance_threshold_naira) : null,
    };
  }));
  const rows = usable.map((a: any, i: number) => {
    const r = results[i];
    return r.status === "fulfilled" ? r.value : { id: a.id, name: a.nickname, error: String((r.reason as any)?.message ?? r.reason) };
  });
  return { ok: true, fetched_at: new Date().toISOString(), accounts: rows };
}

// -- set_status --
async function pauseOrResume(admin: any, account: any, actId: string, token: string, level: string, objectId: string, status: string) {
  // The object must belong to this ad account -- never trust the id alone.
  const obj = await graphGet(objectId, { fields: "account_id,name,status,effective_status" }, token);
  if (String(obj.account_id ?? "").replace(/^act_/, "") !== actId) throw new HttpError(403, "That item is not in this ad account.");

  const form = new URLSearchParams({ status, access_token: token });
  const res = await fetch(`${GRAPH}/${objectId}`, { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok || data.error || data.success === false) throw new HttpError(502, data?.error?.message || "Meta refused the change.");

  // Report what Meta says now, not what we asked for.
  const after = await graphGet(objectId, { fields: "status,effective_status" }, token);

  const table = level === "campaign" ? "campaigns" : level === "adset" ? "ad_sets" : null;
  if (table) {
    const col = level === "campaign" ? "meta_campaign_id" : "meta_adset_id";
    const local = after.status === "ACTIVE" ? "active" : after.status === "PAUSED" ? "paused" : "ended";
    await admin.from(table).update({ status: local }).eq(col, objectId);
  }
  return { name: obj.name as string, status: after.status as string, effective_status: after.effective_status as string };
}

async function handleSetStatus(userClient: any, profile: any, body: any) {
  const level = String(body.level);
  const status = String(body.status);
  const objectId = String(body.object_id ?? "");
  if (!["campaign", "adset", "ad"].includes(level)) throw new HttpError(400, "level must be campaign, adset or ad.");
  if (!["ACTIVE", "PAUSED"].includes(status)) throw new HttpError(400, "status must be ACTIVE or PAUSED.");
  if (!/^\d+$/.test(objectId)) throw new HttpError(400, "Invalid object_id.");
  const { account, actId } = await getAccount(userClient, body.ad_account_id);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const token = await resolveToken(admin, account);

  const result = await pauseOrResume(admin, account, actId, token, level, objectId, status);
  await admin.from("ad_kill_log").insert({
    company_id: account.company_id, ad_account_id: account.id, level, meta_object_id: objectId,
    object_name: result.name, action: status === "PAUSED" ? "paused" : "resumed", source: "manual",
    actor_profile_id: profile.id, reason: typeof body.reason === "string" ? body.reason.slice(0, 300) : null,
  });
  return { ok: true, ...result };
}

// -- scheduled auto-kill --
async function handleAutoKill(dryRun = false) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: ruleRows } = await admin.from("kill_rules").select("*").eq("enabled", true);
  const byProfile: Record<string, Rule[]> = {};
  for (const r of ruleRows ?? []) {
    if (!dryRun && !r.auto_kill) continue; // a dry run previews every enabled rule
    (byProfile[r.profile_id] ??= []).push(r);
  }

  const summary: any[] = [];
  let pauses = 0;
  for (const [profileId, list] of Object.entries(byProfile)) {
    const { data: profile } = await admin.from("profiles").select("id, media_buyer_id, company_id").eq("id", profileId).maybeSingle();
    if (!profile) continue;
    const filters = [`user_id.eq.${profile.id}`];
    if (profile.media_buyer_id) filters.push(`media_buyer_id.eq.${profile.media_buyer_id}`);
    const { data: accounts } = await admin.from("ad_accounts").select("id, meta_ad_account_id, nickname, company_id, meta_connection_id")
      .eq("company_id", profile.company_id).eq("status", "active").or(filters.join(","));
    const rules: Record<string, Rule> = {};
    for (const r of list) rules[r.kind] = r;

    for (const account of accounts ?? []) {
      const actId = String(account.meta_ad_account_id ?? "").replace(/^act_/, "");
      if (!/^\d+$/.test(actId)) continue;
      try {
        const token = await resolveToken(admin, account);
        const [adsets, ads, life] = await Promise.all([
          graphGetAll(`act_${actId}/adsets`, { fields: "id,optimization_goal,destination_type" }, token),
          graphGetAll(`act_${actId}/ads`, { fields: "id,name,adset_id,status,effective_status,created_time", effective_status: JSON.stringify(["ACTIVE"]) }, token),
          insightsByLevel(actId, "ad", "lifetime", token),
        ]);
        const kindBySet: Record<string, string> = {};
        for (const s of adsets) kindBySet[s.id] = adsetKind(s);
        for (const ad of ads) {
          if (pauses >= MAX_AUTO_PAUSES_PER_RUN) break;
          const kind = kindBySet[ad.adset_id] ?? "other";
          const m = life[ad.id] ?? EMPTY;
          const verdict = evaluateRule(rules[kind], { ...ad, kind }, m);
          if (dryRun) {
            summary.push({ account: account.nickname, ad: ad.name, kind, ...m, would_pause: verdict?.reason ?? null });
            continue;
          }
          if (!verdict?.kill) continue;
          const result = await pauseOrResume(admin, account, actId, token, "ad", ad.id, "PAUSED");
          pauses++;
          await admin.from("ad_kill_log").insert({
            company_id: account.company_id, ad_account_id: account.id, level: "ad", meta_object_id: ad.id,
            object_name: result.name, action: "paused", source: "auto", actor_profile_id: profileId,
            reason: verdict.reason, metrics: m,
          });
          summary.push({ account: account.nickname, ad: result.name, reason: verdict.reason });
        }
      } catch (e: any) {
        console.error(`auto_kill ${account.nickname}:`, e.message);
        summary.push({ account: account.nickname, error: e.message });
      }
    }
  }
  return { ok: true, paused: pauses, summary };
}

// -- entrypoint --
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));

    if (body.action === "auto_kill") {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: secret } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
      const given = req.headers.get("x-cron-secret") ?? "";
      if (!secret?.value || given !== secret.value) throw new HttpError(401, "Not allowed.");
      return json(await handleAutoKill(body.dry_run === true));
    }

    const { userClient, profile } = await getUserContext(req);
    if (body.action === "list") return json(await handleList(userClient, profile, body));
    if (body.action === "daily") return json(await handleDaily(userClient, body));
    if (body.action === "balances") return json(await handleBalances(userClient, body));
    if (body.action === "set_status") return json(await handleSetStatus(userClient, profile, body));
    throw new HttpError(400, "Unknown action.");
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error("ads-manager error:", e);
    return json({ ok: false, error: e.message ?? String(e) }, status);
  }
});
