import { planCascade, planCaps } from "../_shared/autooff.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Ads Manager inside the dashboard: live campaign / ad set / ad rows straight
// from Meta (real status + WhatsApp messaging metrics), a real pause/resume
// switch, and the scheduled auto-kill that applies each profile's kill_rules.
//
//   POST { action: "list", ad_account_id, range }            -> rows at all 3 levels
//   POST { action: "reach", since, until, ad_account_id? }   -> people reached + frequency (asked of Meta at account level)
//   POST { action: "balances", ad_account_id? }              -> live prepaid balance per ad account
//   POST { action: "set_ad_message", ad_account_id, ad_ids, greeting, prefill } -> change the WhatsApp greeting + pre-filled message on live ads
//   POST { action: "set_status", ad_account_id, level, object_id, status, reason? }
//   POST { action: "set_budget", ad_account_id, level: "adset"|"campaign", object_id, daily_budget (Naira), reason? } -> scale a daily budget
//   POST { action: "targeting_search", ad_account_id, kind: "interest"|"city", q } -> interests / Nigerian cities to target (builder search box)
//   POST { action: "reach_estimate", ad_account_id, states?, cities?, age_min, age_max, gender, interests?, behaviors?, placements?, devices?, optimization_goal? } -> Meta's potential-audience estimate for a draft ad set
//   POST { action: "ad_preview", ad_account_id, ad_id? | spec: { image_url, message, headline, description, destination, link?, cta? } } -> Meta's own previews (mobile feed, desktop feed, Instagram, Reels, Stories)
//   POST { action: "set_ad_image", ad_account_id, ad_ids, image_url } -> point live ads at a re-fitted copy of their image
//   POST { action: "daily", since, until, ad_account_id? }   -> per ad set per day, every account you can see
//   POST { action: "auto_kill", dry_run? } + header x-cron-secret -> scheduled sweep every 5 min: auto-pauses where the owner turned auto-pause on,
//        otherwise drops a kill suggestion into the AI inbox (+ push), and announces campaigns that just went live (dry_run previews, changes nothing)
//
// Authorization: the caller's JWT is used to read ad_accounts through RLS, so a
// user can only ever touch ad accounts they can already see in the dashboard.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SHARED_META_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";
const MSG_ACTION = "onsite_conversion.messaging_conversation_started_7d";
const PURCHASE_ACTIONS = [
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase"
];
const LPV_ACTIONS = [
  "landing_page_view",
  "omni_landing_page_view"
]; // people whose browser actually loaded the page after clicking
const MAX_AUTO_PAUSES_PER_RUN = 10;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, x-cron-secret"
};
const json = (obj, status = 200)=>new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json"
    }
  });
class HttpError extends Error {
  status;
  constructor(status, msg){
    super(msg);
    this.status = status;
  }
}
// -- Meta helpers --
async function graphGet(path, params, token) {
  const qs = new URLSearchParams({
    ...params,
    access_token: token
  });
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new HttpError(502, data?.error?.message || `Meta error ${res.status}`);
  return data;
}
// Meta answers "Please reduce the amount of data you're asking for" when one page is too big (accounts with hundreds of ads and picture details).
// So a page that is refused is retried with a smaller page size, and the number of pages grows to still cover about 1,200 objects.
async function graphGetAll(path, params, token, maxPages = 6) {
  const sizes = [200, 100, 50, 25, 10];
  let lastErr = null;
  for (const size of sizes) {
    const pages = Math.max(maxPages, Math.ceil(1200 / size));
    try {
      const out = [];
      let data = await graphGet(path, {
        limit: String(size),
        ...params
      }, token);
      out.push(...data.data ?? []);
      for(let i = 1; i < pages && data.paging?.next; i++){
        const res = await fetch(data.paging.next);
        data = await res.json();
        if (!res.ok || data.error) throw new HttpError(502, data?.error?.message || `Meta error ${res.status}`);
        out.push(...data.data ?? []);
      }
      return out;
    } catch (e) {
      lastErr = e;
      if (!/reduce the amount of data|too much data|request too large/i.test(String(e?.message ?? e))) throw e;
    }
  }
  throw lastErr;
}
async function resolveToken(admin, account) {
  if (account.meta_connection_id) {
    const { data: conn } = await admin.from("meta_connections").select("access_token, status").eq("id", account.meta_connection_id).maybeSingle();
    if (conn?.status === "active" && conn.access_token) return conn.access_token;
  }
  return SHARED_META_TOKEN;
}
// Nigeria is UTC+1 all year; ranges are cut on Nigerian calendar days.
function wat(offsetDays = 0) {
  const d = new Date(Date.now() + 3600_000 + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}
function rangeParams(range) {
  switch(range){
    case "today":
      return {
        time_range: JSON.stringify({
          since: wat(0),
          until: wat(0)
        })
      };
    case "yesterday":
      return {
        time_range: JSON.stringify({
          since: wat(-1),
          until: wat(-1)
        })
      };
    case "last3":
      return {
        time_range: JSON.stringify({
          since: wat(-2),
          until: wat(0)
        })
      };
    case "last7":
      return {
        time_range: JSON.stringify({
          since: wat(-6),
          until: wat(0)
        })
      };
    case "last30":
      return {
        time_range: JSON.stringify({
          since: wat(-29),
          until: wat(0)
        })
      };
    default:
      return {
        date_preset: "maximum"
      };
  }
}
const num = (v)=>{
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
function actionValue(actions, types) {
  for (const t of types){
    const a = (actions ?? []).find((x)=>x.action_type === t);
    if (a) return num(a.value);
  }
  return 0;
}
// factor > 1 on a Revora-managed ad account: every money figure is shown with Revora's markup, so numbers, kill rules and balances agree.
const factorOf = (a)=>a?.billing_mode === "managed" ? 1 + num(a?.markup_pct) / 100 : 1;
function insightRow(r, factor = 1) {
  const spend = num(r.spend) * factor;
  const conversations = actionValue(r.actions, [
    MSG_ACTION
  ]);
  const purchases = actionValue(r.actions, PURCHASE_ACTIONS);
  const landingPageViews = actionValue(r.actions, LPV_ACTIONS);
  return {
    spend,
    impressions: num(r.impressions),
    reach: num(r.reach),
    frequency: num(r.frequency),
    clicks: num(r.inline_link_clicks ?? r.clicks),
    ctr: num(r.ctr),
    cpm: num(r.cpm) * factor,
    conversations,
    cost_per_conversation: conversations > 0 ? spend / conversations : null,
    purchases,
    cost_per_purchase: purchases > 0 ? spend / purchases : null,
    landing_page_views: landingPageViews,
    cost_per_landing_page_view: landingPageViews > 0 ? spend / landingPageViews : null
  };
}
const EMPTY = insightRow({});
function latestTime(a, b) {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}
// Which statuses the list asks Meta for. "live" = everything running or about to run (active, in review, preparing, with problems);
// "paused" = switched off; anything else = everything. Asking Meta for only what is needed keeps big accounts fast.
const STATUS_SETS = {
  live: {
    campaign: ["ACTIVE", "IN_PROCESS", "WITH_ISSUES"],
    adset: ["ACTIVE", "IN_PROCESS", "WITH_ISSUES"],
    ad: ["ACTIVE", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "PREAPPROVED", "PENDING_BILLING_INFO", "DISAPPROVED"]
  },
  paused: {
    campaign: ["PAUSED"],
    adset: ["PAUSED", "CAMPAIGN_PAUSED"],
    ad: ["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"]
  }
};
const statusSet = (status, level) => STATUS_SETS[status]?.[level] ?? null;
async function insightsByLevel(actId, level, range, token, factor = 1, status = "all") {
  const idField = level === "ad" ? "ad_id" : level === "adset" ? "adset_id" : "campaign_id";
  const set = statusSet(status, level);
  const rows = await graphGetAll(`act_${actId}/insights`, {
    level,
    fields: `${idField},spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpm,actions`,
    ...rangeParams(range),
    ...(set ? { filtering: JSON.stringify([{ field: `${level === "campaign" ? "campaign" : level}.effective_status`, operator: "IN", value: set }]) } : {})
  }, token);
  const map = {};
  for (const r of rows)map[r[idField]] = insightRow(r, factor);
  return map;
}
const MESSAGING_GOALS = new Set([
  "CONVERSATIONS",
  "REPLIES"
]);
function adsetKind(a) {
  const dest = String(a.destination_type ?? "").toUpperCase();
  if (MESSAGING_GOALS.has(a.optimization_goal) || /WHATSAPP|MESSENGER|DIRECT|MESSAGING/.test(dest)) return "messaging";
  if ([
    "OFFSITE_CONVERSIONS",
    "VALUE",
    "CONVERSIONS"
  ].includes(a.optimization_goal)) return "purchase";
  return "other";
}
function withResults(kind, m) {
  if (kind === "messaging") return {
    results: m.conversations,
    cost_per_result: m.cost_per_conversation,
    result_label: "Conversations"
  };
  if (kind === "purchase") return {
    results: m.purchases,
    cost_per_result: m.cost_per_purchase,
    result_label: "Purchases"
  };
  return {
    results: null,
    cost_per_result: null,
    result_label: ""
  };
}
function evaluateRule(rule, ad, life) {
  if (!rule || !rule.enabled) return null;
  if (ad.status !== "ACTIVE" || ad.effective_status !== "ACTIVE") return null;
  // A scheduled ad set exists on Meta long before it starts delivering: the clock starts at go-live.
  const since = ad.live_since ?? ad.created_time;
  const hours = since ? (Date.now() - new Date(since).getTime()) / 3600_000 : Infinity;
  if (hours < 0 || hours < Number(rule.min_hours)) return null;
  if (life.spend < Number(rule.min_spend)) return null;
  // Landing page views (website ads only): kill when each view costs more than the limit, or when money was spent and nobody landed on the page.
  const lpvLimit = Number(rule.max_cost_per_lpv);
  if (lpvLimit > 0 && ad.kind !== "messaging") {
    const lpv = Number(life.landing_page_views ?? 0), n = (v)=>"₦" + Math.round(v).toLocaleString("en-NG");
    if (lpv === 0) return {
      kill: true,
      reason: `Spent ${n(life.spend)} over ${Math.round(hours)}h with 0 landing page views (rule: kill after ${n(Number(rule.min_spend))}).`
    };
    if (life.spend / lpv > lpvLimit) return {
      kill: true,
      reason: `${n(life.spend / lpv)} per landing page view is above your ${n(lpvLimit)} limit (${lpv} view${lpv === 1 ? "" : "s"}, ${n(life.spend)} spent).`
    };
  }
  const results = ad.kind === "messaging" ? life.conversations : life.purchases;
  const label = ad.kind === "messaging" ? "conversation" : "purchase";
  const cost = results > 0 ? life.spend / results : null;
  const naira = (n)=>"₦" + Math.round(n).toLocaleString("en-NG");
  if (results === 0) {
    return {
      kill: true,
      reason: `Spent ${naira(life.spend)} over ${Math.round(hours)}h with 0 ${label}s (rule: kill after ${naira(Number(rule.min_spend))}).`
    };
  }
  if (cost > Number(rule.max_cost_per_result)) {
    return {
      kill: true,
      reason: `${naira(cost)} per ${label} is above your ${naira(Number(rule.max_cost_per_result))} limit (${results} ${label}${results === 1 ? "" : "s"}, ${naira(life.spend)} spent).`
    };
  }
  return null;
}
// -- account access --
async function getUserContext(req) {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) throw new HttpError(401, "Not signed in.");
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });
  const { data: userRes, error } = await userClient.auth.getUser();
  if (error || !userRes?.user) throw new HttpError(401, "Not signed in.");
  const { data: profile } = await userClient.from("profiles").select("id, company_id, role, media_buyer_id").eq("id", userRes.user.id).maybeSingle();
  if (!profile) throw new HttpError(403, "No profile.");
  if (![
    "owner",
    "admin",
    "buyer"
  ].includes(profile.role)) throw new HttpError(403, "Your role cannot manage ads.");
  return {
    userClient,
    profile
  };
}
async function getAccount(userClient, adAccountId) {
  if (!adAccountId) throw new HttpError(400, "ad_account_id is required.");
  const { data: account } = await userClient.from("ad_accounts").select("id, meta_ad_account_id, nickname, company_id, meta_connection_id, media_buyer_id, user_id, billing_mode, markup_pct").eq("id", adAccountId).maybeSingle();
  if (!account) throw new HttpError(404, "Ad account not found or not yours.");
  const actId = String(account.meta_ad_account_id ?? "").replace(/^act_/, "");
  if (!/^\d+$/.test(actId)) throw new HttpError(400, "This ad account is not connected to Meta.");
  return {
    account,
    actId,
    factor: factorOf(account)
  };
}
// -- WhatsApp greeting + pre-filled message of a Click-to-WhatsApp ad --
// Meta returns page_welcome_message as a JSON string.
function readWaMessage(creative) {
  const raw = creative?.object_story_spec?.link_data?.page_welcome_message;
  if (!raw) return null;
  try {
    const p = typeof raw === "string" ? JSON.parse(raw) : raw;
    const m = p?.text_format?.message;
    return {
      greeting: String(m?.text ?? ""),
      prefill: String(m?.autofill_message?.content ?? "")
    };
  } catch  {
    return null;
  }
}
// -- list --
async function loadAccountObjects(actId, token, range, needLifetimeAds, factor = 1, status = "all") {
  const eff = (level) => { const set = statusSet(status, level); return set ? { effective_status: JSON.stringify(set) } : {}; };
  // In the "Live" view an ad that was paused (by you or the kill rules) after it earned results must still show up under its ad set,
  // otherwise the ad set says "1 purchase" and no ad shows where it came from. So for ads we read insights for every status,
  // and add the paused ads that actually have spend in this range.
  const adInsStatus = status === "live" ? "all" : status;
  const [campaigns, adsets, liveAds, cIns, sIns, aIns, aLife, pausedAds] = await Promise.all([
    graphGetAll(`act_${actId}/campaigns`, {
      fields: "id,name,objective,status,effective_status,daily_budget,lifetime_budget,created_time",
      ...eff("campaign")
    }, token),
    graphGetAll(`act_${actId}/adsets`, {
      fields: "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,destination_type,created_time,start_time",
      ...eff("adset")
    }, token),
    graphGetAll(`act_${actId}/ads`, {
      fields: "id,name,adset_id,campaign_id,status,effective_status,created_time,creative{id,thumbnail_url,object_story_spec}",
      ...eff("ad")
    }, token),
    insightsByLevel(actId, "campaign", range, token, factor, status),
    insightsByLevel(actId, "adset", range, token, factor, status),
    insightsByLevel(actId, "ad", range, token, factor, adInsStatus),
    needLifetimeAds ? insightsByLevel(actId, "ad", "lifetime", token, factor, adInsStatus) : Promise.resolve(null),
    status === "live" ? graphGetAll(`act_${actId}/ads`, {
      fields: "id,name,adset_id,campaign_id,status,effective_status,created_time,creative{id,thumbnail_url,object_story_spec}",
      effective_status: JSON.stringify(STATUS_SETS.paused.ad)
    }, token) : Promise.resolve([])
  ]);
  const liveAdIds = new Set(liveAds.map((a) => a.id));
  const ads = [...liveAds, ...pausedAds.filter((a) => !liveAdIds.has(a.id) && (aIns[a.id]?.spend ?? 0) > 0)];
  return {
    campaigns,
    adsets,
    ads,
    cIns,
    sIns,
    aIns,
    aLife: aLife ?? aIns
  };
}
async function handleList(userClient, profile, body) {
  const { account, actId, factor } = await getAccount(userClient, body.ad_account_id);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const token = await resolveToken(admin, account);
  const range = [
    "today",
    "yesterday",
    "last3",
    "last7",
    "last30",
    "lifetime"
  ].includes(body.range) ? body.range : "last7";
  const { data: ruleRows } = await userClient.from("kill_rules").select("*").eq("profile_id", profile.id);
  const rules = {};
  for (const r of ruleRows ?? [])rules[r.kind] = r;
  const { campaigns, adsets, ads, cIns, sIns, aIns, aLife } = await loadAccountObjects(actId, token, range, range !== "lifetime", factor, ["live", "paused"].includes(String(body.status)) ? String(body.status) : "all");
  const adsetById = {};
  const campKinds = {};
  const adsetRows = adsets.map((a)=>{
    const kind = adsetKind(a);
    adsetById[a.id] = {
      ...a,
      kind
    };
    (campKinds[a.campaign_id] ??= new Set()).add(kind);
    const m = sIns[a.id] ?? EMPTY;
    return {
      id: a.id,
      name: a.name,
      campaign_id: a.campaign_id,
      status: a.status,
      effective_status: a.effective_status,
      daily_budget: a.daily_budget ? Math.round(num(a.daily_budget) * factor) / 100 : null,
      kind,
      created_time: a.created_time,
      start_time: a.start_time ?? null,
      ...m,
      ...withResults(kind, m)
    };
  });
  const campaignRows = campaigns.map((c)=>{
    const kinds = campKinds[c.id] ?? new Set();
    const kind = kinds.has("messaging") ? "messaging" : kinds.has("purchase") ? "purchase" : "other";
    const m = cIns[c.id] ?? EMPTY;
    return {
      id: c.id,
      name: c.name,
      objective: c.objective,
      status: c.status,
      effective_status: c.effective_status,
      daily_budget: c.daily_budget ? Math.round(num(c.daily_budget) * factor) / 100 : null,
      kind,
      created_time: c.created_time,
      ...m,
      ...withResults(kind, m)
    };
  });
  const adRows = ads.map((a)=>{
    const kind = adsetById[a.adset_id]?.kind ?? "other";
    const m = aIns[a.id] ?? EMPTY;
    const life = aLife[a.id] ?? EMPTY;
    const set = adsetById[a.adset_id];
    const liveSince = latestTime(a.created_time, set?.start_time);
    const suggestion = evaluateRule(rules[kind], {
      ...a,
      kind,
      live_since: liveSince
    }, life);
    return {
      id: a.id,
      name: a.name,
      adset_id: a.adset_id,
      campaign_id: a.campaign_id,
      status: a.status,
      effective_status: a.effective_status,
      kind,
      created_time: a.created_time,
      thumbnail_url: a.creative?.thumbnail_url ?? null,
      picture_url: a.creative?.object_story_spec?.link_data?.picture ?? null,
      wa_greeting: readWaMessage(a.creative)?.greeting ?? null,
      wa_prefill: readWaMessage(a.creative)?.prefill ?? null,
      ...m,
      ...withResults(kind, m),
      suggestion
    };
  });
  return {
    ok: true,
    range,
    fetched_at: new Date().toISOString(),
    account: {
      id: account.id,
      name: account.nickname
    },
    campaigns: campaignRows,
    adsets: adsetRows,
    ads: adRows
  };
}
// -- daily (Overview + Ad Spend & ROAS) --
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
async function handleDaily(userClient, body) {
  const since = String(body.since ?? ""), until = String(body.until ?? "");
  if (!DATE_RE.test(since) || !DATE_RE.test(until) || since > until) throw new HttpError(400, "since/until must be YYYY-MM-DD dates.");
  if ((new Date(until).getTime() - new Date(since).getTime()) / 86400_000 > 92) throw new HttpError(400, "Range is limited to 92 days.");
  let q = userClient.from("ad_accounts").select("id, meta_ad_account_id, nickname, company_id, meta_connection_id, media_buyer_id, billing_mode, markup_pct").eq("status", "active");
  if (body.ad_account_id) q = q.eq("id", body.ad_account_id);
  const { data: accounts } = await q;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const usable = (accounts ?? []).filter((a)=>/^\d+$/.test(String(a.meta_ad_account_id ?? "").replace(/^act_/, "")));
  const results = await Promise.allSettled(usable.map(async (a)=>{
    const actId = String(a.meta_ad_account_id).replace(/^act_/, "");
    const factor = factorOf(a);
    const token = await resolveToken(admin, a);
    const rows = await graphGetAll(`act_${actId}/insights`, {
      level: "adset",
      time_increment: "1",
      time_range: JSON.stringify({
        since,
        until
      }),
      fields: "adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpc,cpm,actions"
    }, token, 12);
    // which ad sets are website-purchase vs messaging, so the dashboard can total website numbers on their own
    const adsetRows = await graphGetAll(`act_${actId}/adsets`, {
      fields: "id,optimization_goal,destination_type"
    }, token, 10).catch(()=>[]);
    const kindById = new Map(adsetRows.map((x)=>[
        String(x.id),
        adsetKind(x)
      ]));
    return rows.map((r)=>({
        kind: kindById.get(String(r.adset_id)) ?? "other",
        date: r.date_start,
        account_id: a.id,
        media_buyer_id: a.media_buyer_id ?? null,
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        adset_id: r.adset_id,
        adset_name: r.adset_name,
        ...insightRow(r, factor),
        cpc: num(r.cpc) * factor
      }));
  }));
  const rows = [];
  const info = usable.map((a, i)=>{
    const r = results[i];
    if (r.status === "fulfilled") {
      rows.push(...r.value);
      return {
        id: a.id,
        name: a.nickname,
        media_buyer_id: a.media_buyer_id ?? null,
        rows: r.value.length
      };
    }
    return {
      id: a.id,
      name: a.nickname,
      media_buyer_id: a.media_buyer_id ?? null,
      error: String(r.reason?.message ?? r.reason)
    };
  });
  return {
    ok: true,
    since,
    until,
    accounts: info,
    rows
  };
}
// -- balances (prepaid wallet left in each ad account) --
// funding_source_details.display_string is what Meta's own UI shows, e.g.
// "Available balance (NGN2,323.94)". The plain `balance` field is spend not
// yet billed, NOT money left, so it is only reported separately as "owed".
function parseAvailable(display) {
  const m = String(display ?? "").match(/([\d,]+\.\d{2})/);
  return m ? parseFloat(m[1].replace(/,/g, "")) : null;
}
async function handleBalances(userClient, body) {
  let q = userClient.from("ad_accounts").select("id, meta_ad_account_id, nickname, meta_connection_id, low_balance_threshold_naira, billing_mode, company_id").eq("status", "active");
  if (body.ad_account_id) q = q.eq("id", body.ad_account_id);
  const { data: accounts } = await q;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const usable = (accounts ?? []).filter((a)=>/^\d+$/.test(String(a.meta_ad_account_id ?? "").replace(/^act_/, "")));
  const results = await Promise.allSettled(usable.map(async (a)=>{
    const actId = String(a.meta_ad_account_id).replace(/^act_/, "");
    const token = await resolveToken(admin, a);
    if (a.billing_mode === "managed") {
      // A Revora-managed account is paid by Revora's card: what the customer has left is their Revora wallet, not anything Meta shows.
      const { data: w } = await admin.rpc("company_wallet_balance", {
        p_company: a.company_id
      });
      const avail = Math.max(0, Number(w ?? 0));
      return {
        id: a.id,
        name: a.nickname,
        currency: "NGN",
        available: avail,
        is_prepay: true,
        owed: null,
        funding_label: "Revora wallet",
        account_status: 1,
        low_threshold: a.low_balance_threshold_naira != null ? num(a.low_balance_threshold_naira) : null
      };
    }
    const d = await graphGet(`act_${actId}`, {
      fields: "account_status,currency,balance,amount_spent,spend_cap,is_prepay_account,funding_source_details"
    }, token);
    const available = parseAvailable(d.funding_source_details?.display_string);
    if (available !== null) {
      await admin.from("ad_accounts").update({
        balance_naira: available,
        balance_updated_at: new Date().toISOString()
      }).eq("id", a.id);
    }
    return {
      id: a.id,
      name: a.nickname,
      currency: d.currency ?? "NGN",
      available,
      is_prepay: d.is_prepay_account === true,
      owed: d.balance !== undefined ? num(d.balance) / 100 : null,
      funding_label: d.funding_source_details?.display_string ?? null,
      account_status: d.account_status ?? null,
      low_threshold: a.low_balance_threshold_naira != null ? num(a.low_balance_threshold_naira) : null
    };
  }));
  const rows = usable.map((a, i)=>{
    const r = results[i];
    return r.status === "fulfilled" ? r.value : {
      id: a.id,
      name: a.nickname,
      error: String(r.reason?.message ?? r.reason)
    };
  });
  return {
    ok: true,
    fetched_at: new Date().toISOString(),
    accounts: rows
  };
}
// -- set_ad_message --
// A live ad's creative can't be edited in place, so each ad gets a fresh creative that is an exact copy of
// its current one with only the WhatsApp greeting + pre-filled message replaced, then the ad is pointed at it.
// Meta may re-review the ad afterwards (usually minutes). Verified against Meta with validate_only first.
const MAX_ADS_PER_MESSAGE_EDIT = 20;
async function handleSetAdMessage(userClient, body) {
  const greeting = String(body.greeting ?? "").trim();
  const prefill = String(body.prefill ?? "").trim();
  if (!greeting || !prefill) throw new HttpError(400, "Type both the greeting and the pre-filled message.");
  if (greeting.length > 300) throw new HttpError(400, "The greeting can be at most 300 characters (Meta's limit).");
  if (prefill.length > 1000) throw new HttpError(400, "The pre-filled message can be at most 1000 characters.");
  const adIds = Array.isArray(body.ad_ids) ? [
    ...new Set(body.ad_ids.map(String))
  ] : [];
  if (!adIds.length || adIds.some((i)=>!/^\d+$/.test(i))) throw new HttpError(400, "ad_ids must be a list of ad ids.");
  if (adIds.length > MAX_ADS_PER_MESSAGE_EDIT) throw new HttpError(400, `Change at most ${MAX_ADS_PER_MESSAGE_EDIT} ads at a time.`);
  const { account, actId } = await getAccount(userClient, body.ad_account_id);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const token = await resolveToken(admin, account);
  const welcome = {
    type: "VISUAL_EDITOR",
    version: 2,
    landing_screen_type: "welcome_message",
    media_type: "text",
    text_format: {
      customer_action_type: "autofill_message",
      message: {
        text: greeting,
        autofill_message: {
          content: prefill
        }
      }
    }
  };
  const results = await Promise.allSettled(adIds.map(async (adId)=>{
    const ad = await graphGet(adId, {
      fields: "account_id,name,creative{id,name,object_story_spec}"
    }, token);
    if (String(ad.account_id ?? "").replace(/^act_/, "") !== actId) throw new HttpError(403, "That ad is not in this ad account.");
    const spec = ad.creative?.object_story_spec;
    if (!spec?.link_data || !spec.link_data.page_welcome_message) throw new HttpError(400, "This is not a Click-to-WhatsApp ad, so it has no WhatsApp message to change.");
    const newSpec = structuredClone(spec);
    delete newSpec.link_data.picture; // Meta rejects picture together with image_hash
    newSpec.link_data.page_welcome_message = welcome;
    const cRes = await fetch(`${GRAPH}/act_${actId}/adcreatives`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: `${String(ad.creative?.name ?? ad.name).slice(0, 150)}-msg-${Date.now()}`,
        object_story_spec: newSpec,
        contextual_multi_ads: {
          enroll_status: "OPT_OUT"
        },
        access_token: token
      })
    });
    const cData = await cRes.json();
    if (!cData.id) throw new HttpError(502, cData?.error?.error_user_msg || cData?.error?.message || "Meta could not create the new message.");
    const uRes = await fetch(`${GRAPH}/${adId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        creative: {
          creative_id: cData.id
        },
        access_token: token
      })
    });
    const uData = await uRes.json();
    if (!uRes.ok || uData.error || uData.success === false) throw new HttpError(502, uData?.error?.error_user_msg || uData?.error?.message || "Meta refused to update the ad.");
    // Report what Meta says now.
    const after = await graphGet(adId, {
      fields: "effective_status,creative{id,object_story_spec}"
    }, token);
    const msg = readWaMessage(after.creative);
    return {
      id: adId,
      name: ad.name,
      effective_status: after.effective_status,
      wa_greeting: msg?.greeting ?? null,
      wa_prefill: msg?.prefill ?? null
    };
  }));
  const out = results.map((r, i)=>r.status === "fulfilled" ? {
      ok: true,
      ...r.value
    } : {
      ok: false,
      id: adIds[i],
      error: String(r.reason?.message ?? r.reason)
    });
  return {
    ok: out.every((x)=>x.ok),
    results: out
  };
}
const AD_STATES = ["ACTIVE", "PAUSED", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES"];
// After something is switched off by hand: if it was the last live ad in its ad set, switch the ad set off; if that was the last live
// ad set in its campaign, switch the campaign off. An ad set with other live ads, or a campaign with other live ad sets, is left alone.
async function cascadeUp(admin, account, actId, token, level, objectId, actorId) {
  const done = [];
  const just = new Set([objectId]);
  let adsetId = null, campId = null;
  if (level === "ad") {
    const o = await graphGet(objectId, { fields: "adset_id,campaign_id" }, token);
    adsetId = o.adset_id ?? null; campId = o.campaign_id ?? null;
  } else if (level === "adset") {
    const o = await graphGet(objectId, { fields: "campaign_id" }, token);
    campId = o.campaign_id ?? null;
  }
  const off = async (lvl, id, reason) => {
    const r = await pauseOrResume(admin, account, actId, token, lvl, id, "PAUSED");
    just.add(id);
    await admin.from("ad_kill_log").insert({ company_id: account.company_id, ad_account_id: account.id, level: lvl, meta_object_id: id, object_name: r.name, action: "paused", source: "auto", actor_profile_id: actorId ?? null, reason });
    done.push({ level: lvl, id, name: r.name });
  };
  if (adsetId) {
    const kids = await graphGetAll(`${adsetId}/ads`, { fields: "id,status", effective_status: JSON.stringify(AD_STATES) }, token);
    if (kids.length && !kids.some((k) => k.status === "ACTIVE" && !just.has(k.id))) {
      const me = await graphGet(adsetId, { fields: "status" }, token);
      if (me.status === "ACTIVE") await off("adset", adsetId, "Every ad in it is off, so I switched it off too.");
    }
  }
  if (campId) {
    const kids = await graphGetAll(`${campId}/adsets`, { fields: "id,status", effective_status: JSON.stringify(["ACTIVE", "PAUSED", "WITH_ISSUES", "IN_PROCESS", "CAMPAIGN_PAUSED"]) }, token);
    if (kids.length && !kids.some((k) => k.status === "ACTIVE" && !just.has(k.id))) {
      const me = await graphGet(campId, { fields: "status" }, token);
      if (me.status === "ACTIVE") await off("campaign", campId, "Every ad set in it is off, so I switched it off too.");
    }
  }
  return done;
}
// -- reach: people reached and how often they saw the ads, for a date range. Meta counts each person once per account, so this is asked
// of Meta at account level (adding up campaigns or days would count the same person many times). Accounts are added together. --
async function handleReach(userClient, body) {
  const since = String(body.since ?? ""), until = String(body.until ?? "");
  if (!DATE_RE.test(since) || !DATE_RE.test(until) || since > until) throw new HttpError(400, "since/until must be YYYY-MM-DD dates.");
  let q = userClient.from("ad_accounts").select("id, meta_ad_account_id, nickname, company_id, meta_connection_id, media_buyer_id, billing_mode, markup_pct").eq("status", "active");
  if (body.ad_account_id) q = q.eq("id", body.ad_account_id);
  const { data: accounts } = await q;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const usable = (accounts ?? []).filter((a)=>/^\d+$/.test(String(a.meta_ad_account_id ?? "").replace(/^act_/, "")));
  const res = await Promise.allSettled(usable.map(async (a)=>{
    const token = await resolveToken(admin, a);
    const rows = await graphGetAll(`act_${String(a.meta_ad_account_id).replace(/^act_/, "")}/insights`, {
      level: "account",
      time_range: JSON.stringify({ since, until }),
      fields: "reach,impressions,frequency"
    }, token);
    const r = rows[0] ?? {};
    return { id: a.id, name: a.nickname, reach: num(r.reach), impressions: num(r.impressions) };
  }));
  const accountsOut = res.map((r, i)=>r.status === "fulfilled" ? r.value : { id: usable[i].id, name: usable[i].nickname, error: String(r.reason?.message ?? r.reason) });
  const ok = accountsOut.filter((x)=>!x.error);
  const reach = ok.reduce((t, x)=>t + x.reach, 0), impressions = ok.reduce((t, x)=>t + x.impressions, 0);
  return { ok: true, reach, impressions, frequency: reach > 0 ? impressions / reach : null, accounts: accountsOut };
}
// -- set_status --
async function pauseOrResume(admin, account, actId, token, level, objectId, status) {
  // The object must belong to this ad account -- never trust the id alone.
  const obj = await graphGet(objectId, {
    fields: "account_id,name,status,effective_status"
  }, token);
  if (String(obj.account_id ?? "").replace(/^act_/, "") !== actId) throw new HttpError(403, "That item is not in this ad account.");
  const form = new URLSearchParams({
    status,
    access_token: token
  });
  const res = await fetch(`${GRAPH}/${objectId}`, {
    method: "POST",
    body: form
  });
  const data = await res.json();
  if (!res.ok || data.error || data.success === false) throw new HttpError(502, data?.error?.message || "Meta refused the change.");
  // Report what Meta says now, not what we asked for.
  const after = await graphGet(objectId, {
    fields: "status,effective_status"
  }, token);
  const table = level === "campaign" ? "campaigns" : level === "adset" ? "ad_sets" : null;
  if (table) {
    const col = level === "campaign" ? "meta_campaign_id" : "meta_adset_id";
    const local = after.status === "ACTIVE" ? "active" : after.status === "PAUSED" ? "paused" : "ended";
    await admin.from(table).update({
      status: local
    }).eq(col, objectId);
  }
  return {
    name: obj.name,
    status: after.status,
    effective_status: after.effective_status
  };
}
async function handleSetStatus(userClient, profile, body) {
  const level = String(body.level);
  const status = String(body.status);
  const objectId = String(body.object_id ?? "");
  if (![
    "campaign",
    "adset",
    "ad"
  ].includes(level)) throw new HttpError(400, "level must be campaign, adset or ad.");
  if (![
    "ACTIVE",
    "PAUSED"
  ].includes(status)) throw new HttpError(400, "status must be ACTIVE or PAUSED.");
  if (!/^\d+$/.test(objectId)) throw new HttpError(400, "Invalid object_id.");
  const { account, actId } = await getAccount(userClient, body.ad_account_id);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const token = await resolveToken(admin, account);
  const result = await pauseOrResume(admin, account, actId, token, level, objectId, status);
  await admin.from("ad_kill_log").insert({
    company_id: account.company_id,
    ad_account_id: account.id,
    level,
    meta_object_id: objectId,
    object_name: result.name,
    action: status === "PAUSED" ? "paused" : "resumed",
    source: "manual",
    actor_profile_id: profile.id,
    reason: typeof body.reason === "string" ? body.reason.slice(0, 300) : null
  });
  // Switching the last live ad off must not leave its ad set and campaign running (see cascadeUp).
  let cascaded = [];
  if (status === "PAUSED" && body.cascade !== false) cascaded = await cascadeUp(admin, account, actId, token, level, objectId, profile.id).catch((e)=>{ console.error("cascade:", e.message); return []; });
  return {
    ok: true,
    ...result,
    cascaded
  };
}
// -- set_budget (scale) --
async function handleSetBudget(userClient, profile, body) {
  const level = String(body.level);
  const objectId = String(body.object_id ?? "");
  const naira = Number(body.daily_budget);
  if (![
    "campaign",
    "adset"
  ].includes(level)) throw new HttpError(400, "level must be campaign or adset.");
  if (!/^\d+$/.test(objectId)) throw new HttpError(400, "Invalid object_id.");
  if (!Number.isFinite(naira) || naira < 500 || naira > 5_000_000) throw new HttpError(400, "daily_budget must be between ₦500 and ₦5,000,000.");
  const { account, actId, factor } = await getAccount(userClient, body.ad_account_id);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const token = await resolveToken(admin, account);
  const obj = await graphGet(objectId, {
    fields: "account_id,name,daily_budget,lifetime_budget"
  }, token);
  if (String(obj.account_id ?? "").replace(/^act_/, "") !== actId) throw new HttpError(403, "That item is not in this ad account.");
  if (!obj.daily_budget) throw new HttpError(400, "This item has no daily budget (it may use a lifetime budget or the budget sits on the campaign).");
  // On a Revora-managed account the person works in marked-up naira; Meta gets the real (smaller) amount.
  const before = Math.round(num(obj.daily_budget) * factor) / 100;
  const res = await fetch(`${GRAPH}/${objectId}`, {
    method: "POST",
    body: new URLSearchParams({
      daily_budget: String(Math.round(naira / factor * 100)),
      access_token: token
    })
  });
  const data = await res.json();
  if (!res.ok || data.error || data.success === false) throw new HttpError(502, data?.error?.error_user_msg || data?.error?.message || "Meta refused the budget change.");
  const after = await graphGet(objectId, {
    fields: "daily_budget"
  }, token);
  await admin.from("ad_kill_log").insert({
    company_id: account.company_id,
    ad_account_id: account.id,
    level,
    meta_object_id: objectId,
    object_name: obj.name,
    action: "scaled",
    source: "manual",
    actor_profile_id: profile.id,
    reason: `Budget ₦${before.toLocaleString("en-NG")} → ₦${naira.toLocaleString("en-NG")}${body.reason ? " · " + String(body.reason).slice(0, 200) : ""}`
  });
  return {
    ok: true,
    name: obj.name,
    previous_daily_budget: before,
    daily_budget: Math.round(num(after.daily_budget) * factor) / 100
  };
}
// -- previews + image swap (so a creative is shown whole, not cropped) --
const PREVIEW_FORMATS = [
  "MOBILE_FEED_STANDARD",
  "DESKTOP_FEED_STANDARD",
  "INSTAGRAM_STANDARD",
  "INSTAGRAM_REELS",
  "INSTAGRAM_STORY"
];
function readIframe(html) {
  const src = String(html ?? "").match(/src="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  if (!src) return null;
  return {
    src,
    width: Number(String(html).match(/width="(\d+)"/)?.[1]) || 340,
    height: Number(String(html).match(/height="(\d+)"/)?.[1]) || 600
  };
}
const isOurImage = (u)=>u.startsWith(`${SUPABASE_URL}/storage/v1/object/public/`);
async function handleAdPreview(userClient, body) {
  const { account, actId } = await getAccount(userClient, body.ad_account_id);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const token = await resolveToken(admin, account);
  const formats = (Array.isArray(body.formats) && body.formats.length ? body.formats : PREVIEW_FORMATS).filter((f)=>PREVIEW_FORMATS.includes(f));
  let creativeParam = null;
  if (!body.ad_id) {
    const sp = body.spec ?? {};
    const image = String(sp.image_url ?? "");
    if (!isOurImage(image)) throw new HttpError(400, "Preview needs an image uploaded from the dashboard.");
    const { data: acc } = await admin.from("ad_accounts").select("fb_page_id, ig_user_id").eq("id", account.id).maybeSingle();
    if (!acc?.fb_page_id) throw new HttpError(400, "This ad account has no Facebook Page connected yet.");
    const wa = sp.destination !== "website";
    creativeParam = JSON.stringify({
      object_story_spec: {
        page_id: acc.fb_page_id,
        ...acc.ig_user_id ? {
          instagram_user_id: acc.ig_user_id
        } : {},
        link_data: {
          picture: image,
          link: wa ? "https://api.whatsapp.com/send" : String(sp.link || "https://example.com"),
          message: String(sp.message ?? "").slice(0, 2000),
          name: String(sp.headline ?? "").slice(0, 100) || undefined,
          description: String(sp.description ?? "").slice(0, 150) || undefined,
          call_to_action: wa ? {
            type: "WHATSAPP_MESSAGE",
            value: {
              app_destination: "WHATSAPP"
            }
          } : {
            type: String(sp.cta || "SHOP_NOW"),
            value: {
              link: String(sp.link || "https://example.com")
            }
          }
        }
      }
    });
  } else if (!/^\d+$/.test(String(body.ad_id))) throw new HttpError(400, "Invalid ad_id.");
  const results = await Promise.allSettled(formats.map(async (f)=>{
    const d = body.ad_id ? await graphGet(`${body.ad_id}/previews`, {
      ad_format: f
    }, token) : await graphGet(`act_${actId}/generatepreviews`, {
      ad_format: f,
      creative: creativeParam
    }, token);
    const it = readIframe(d?.data?.[0]?.body);
    if (!it) throw new HttpError(502, "Meta did not return a preview for this placement.");
    return {
      format: f,
      ...it
    };
  }));
  return {
    ok: true,
    previews: results.map((r, i)=>r.status === "fulfilled" ? r.value : {
        format: formats[i],
        error: String(r.reason?.message ?? r.reason)
      })
  };
}
async function handleSetAdImage(userClient, body) {
  const imageUrl = String(body.image_url ?? "");
  if (!isOurImage(imageUrl)) throw new HttpError(400, "image_url must be an image uploaded from the dashboard.");
  const adIds = Array.isArray(body.ad_ids) ? [
    ...new Set(body.ad_ids.map(String))
  ] : [];
  if (!adIds.length || adIds.some((i)=>!/^\d+$/.test(i))) throw new HttpError(400, "ad_ids must be a list of ad ids.");
  if (adIds.length > MAX_ADS_PER_MESSAGE_EDIT) throw new HttpError(400, `Change at most ${MAX_ADS_PER_MESSAGE_EDIT} ads at a time.`);
  const { account, actId } = await getAccount(userClient, body.ad_account_id);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const token = await resolveToken(admin, account);
  // ads that share one creative get one new creative, not one each
  const made = {};
  const results = await Promise.allSettled(adIds.map(async (adId)=>{
    const ad = await graphGet(adId, {
      fields: "account_id,name,creative{id,name,object_story_spec}"
    }, token);
    if (String(ad.account_id ?? "").replace(/^act_/, "") !== actId) throw new HttpError(403, "That ad is not in this ad account.");
    const spec = ad.creative?.object_story_spec;
    if (!spec?.link_data) throw new HttpError(400, "This ad is not a single-image ad (videos and carousels can't be re-fitted here).");
    const key = String(ad.creative?.id);
    made[key] ??= (async ()=>{
      const newSpec = structuredClone(spec);
      delete newSpec.link_data.image_hash; // Meta rejects image_hash together with picture; the new picture replaces it
      newSpec.link_data.picture = imageUrl;
      const cRes = await fetch(`${GRAPH}/act_${actId}/adcreatives`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: `${String(ad.creative?.name ?? ad.name).slice(0, 150)}-fit-${Date.now()}`,
          object_story_spec: newSpec,
          contextual_multi_ads: {
            enroll_status: "OPT_OUT"
          },
          access_token: token
        })
      });
      const cData = await cRes.json();
      if (!cData.id) throw new HttpError(502, cData?.error?.error_user_msg || cData?.error?.message || "Meta could not create the new creative.");
      return String(cData.id);
    })();
    const creativeId = await made[key];
    const uRes = await fetch(`${GRAPH}/${adId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        creative: {
          creative_id: creativeId
        },
        access_token: token
      })
    });
    const uData = await uRes.json();
    if (!uRes.ok || uData.error || uData.success === false) throw new HttpError(502, uData?.error?.error_user_msg || uData?.error?.message || "Meta refused to update the ad.");
    const after = await graphGet(adId, {
      fields: "effective_status,creative{object_story_spec}"
    }, token);
    return {
      id: adId,
      name: ad.name,
      effective_status: after.effective_status,
      picture_url: after.creative?.object_story_spec?.link_data?.picture ?? null
    };
  }));
  const out = results.map((r, i)=>r.status === "fulfilled" ? {
      ok: true,
      ...r.value
    } : {
      ok: false,
      id: adIds[i],
      error: String(r.reason?.message ?? r.reason)
    });
  return {
    ok: out.every((x)=>x.ok),
    results: out
  };
}
// -- targeting helpers (builder search box + live potential reach) --
// Same targeting shape ai-auto-launch-tests sends, so the estimate matches what will really launch.
async function resolveRegionKeys(names, token) {
  const keys = await Promise.all(names.slice(0, 40).map(async (name)=>{
    try {
      const d = await graphGet("search", {
        type: "adgeolocation",
        location_types: JSON.stringify([
          "region"
        ]),
        country_code: "NG",
        q: name,
        limit: "1"
      }, token);
      return d?.data?.[0]?.key ? String(d.data[0].key) : null;
    } catch  {
      return null;
    }
  }));
  return keys.filter(Boolean);
}
async function handleTargetingSearch(userClient, body) {
  const q = String(body.q ?? "").trim().slice(0, 60);
  if (q.length < 2) return {
    ok: true,
    results: []
  };
  const { account } = await getAccount(userClient, body.ad_account_id);
  const token = await resolveToken(createClient(SUPABASE_URL, SERVICE_KEY), account);
  if (body.kind === "city") {
    const d = await graphGet("search", {
      type: "adgeolocation",
      location_types: JSON.stringify([
        "city"
      ]),
      country_code: "NG",
      q,
      limit: "8"
    }, token);
    return {
      ok: true,
      results: (d.data ?? []).filter((x)=>x.type === "city").map((x)=>({
          key: String(x.key ?? x.id),
          name: x.name,
          region: x.region ?? ""
        }))
    };
  }
  const d = await graphGet("search", {
    type: "adinterest",
    q,
    limit: "10",
    locale: "en_US"
  }, token);
  return {
    ok: true,
    results: (d.data ?? []).map((x)=>({
        id: String(x.id),
        name: x.name,
        size_lower: x.audience_size_lower_bound ?? null,
        size_upper: x.audience_size_upper_bound ?? null,
        path: (x.path ?? []).join(" > ")
      }))
  };
}
// Where the ad may show. Each choice is a Meta publisher platform + position; Meta's own rules
// (checked live with validate_only) say some need a partner placement, so those are added.
const PLACEMENTS = {
  fb_feed: {
    p: "facebook",
    k: "facebook_positions",
    pos: [
      "feed"
    ]
  },
  fb_reels: {
    p: "facebook",
    k: "facebook_positions",
    pos: [
      "facebook_reels"
    ]
  },
  fb_stories: {
    p: "facebook",
    k: "facebook_positions",
    pos: [
      "story"
    ]
  },
  fb_marketplace: {
    p: "facebook",
    k: "facebook_positions",
    pos: [
      "marketplace"
    ]
  },
  fb_search: {
    p: "facebook",
    k: "facebook_positions",
    pos: [
      "search"
    ]
  },
  fb_profile: {
    p: "facebook",
    k: "facebook_positions",
    pos: [
      "profile_feed"
    ]
  },
  ig_feed: {
    p: "instagram",
    k: "instagram_positions",
    pos: [
      "stream"
    ]
  },
  ig_reels: {
    p: "instagram",
    k: "instagram_positions",
    pos: [
      "reels"
    ]
  },
  ig_stories: {
    p: "instagram",
    k: "instagram_positions",
    pos: [
      "story"
    ]
  },
  ig_explore: {
    p: "instagram",
    k: "instagram_positions",
    pos: [
      "explore",
      "explore_home"
    ]
  },
  ig_profile: {
    p: "instagram",
    k: "instagram_positions",
    pos: [
      "profile_feed"
    ]
  },
  threads: {
    p: "threads",
    k: "threads_positions",
    pos: [
      "threads_stream"
    ]
  },
  wa_status: {
    p: "whatsapp",
    k: "whatsapp_positions",
    pos: [
      "status"
    ]
  },
  an: {
    p: "audience_network",
    k: "audience_network_positions",
    pos: [
      "classic",
      "rewarded_video"
    ]
  }
};
function placementSpec(keys) {
  const set = new Set((Array.isArray(keys) ? keys : []).map(String).filter((k)=>PLACEMENTS[k]));
  if (!set.size) return null;
  if ([
    "fb_marketplace",
    "fb_search",
    "fb_profile"
  ].some((k)=>set.has(k))) set.add("fb_feed");
  if (set.has("fb_stories") && !set.has("fb_feed") && !set.has("ig_stories")) set.add("fb_feed");
  if ([
    "ig_explore",
    "ig_profile"
  ].some((k)=>set.has(k))) set.add("ig_feed");
  if (set.has("wa_status")) set.add("ig_stories");
  if (set.has("threads") && !set.has("fb_feed") && !set.has("ig_feed")) set.add("fb_feed");
  if (set.has("an") && !set.has("fb_feed")) set.add("fb_feed"); // Audience Network alone isn't accepted; with Facebook feed it is
  const out = {
    publisher_platforms: []
  };
  for (const key of set){
    const m = PLACEMENTS[key];
    if (!out.publisher_platforms.includes(m.p)) out.publisher_platforms.push(m.p);
    out[m.k] = [
      ...out[m.k] ?? [],
      ...m.pos
    ];
  }
  return out;
}
const GENDER_CODES = {
  all: [
    1,
    2
  ],
  male: [
    1
  ],
  female: [
    2
  ]
};
const REACH_GOALS = [
  "CONVERSATIONS",
  "OFFSITE_CONVERSIONS",
  "LINK_CLICKS",
  "LANDING_PAGE_VIEWS"
];
async function handleReachEstimate(userClient, body) {
  const { account, actId } = await getAccount(userClient, body.ad_account_id);
  const token = await resolveToken(createClient(SUPABASE_URL, SERVICE_KEY), account);
  const states = Array.isArray(body.states) ? body.states.map(String) : [];
  const cities = Array.isArray(body.cities) ? body.cities : [];
  const geo = {
    location_types: [
      "frequently_in",
      "home",
      "recent"
    ]
  };
  const regionKeys = states.length ? await resolveRegionKeys(states, token) : [];
  if (regionKeys.length) geo.regions = regionKeys.map((key)=>({
      key
    }));
  const cityList = cities.filter((c)=>/^\d+$/.test(String(c?.key))).slice(0, 30).map((c)=>({
      key: String(c.key),
      radius: Math.min(Math.max(Number(c.radius) || 17, 10), 80),
      distance_unit: "kilometer"
    }));
  if (cityList.length) geo.cities = cityList;
  if (!geo.regions && !geo.cities) geo.countries = [
    "NG"
  ];
  const ints = (Array.isArray(body.interests) ? body.interests : []).filter((x)=>/^\d+$/.test(String(x?.id))).map((x)=>({
      id: String(x.id),
      name: String(x.name ?? "")
    }));
  const behs = (Array.isArray(body.behaviors) ? body.behaviors : []).filter((x)=>/^\d+$/.test(String(x?.id))).map((x)=>({
      id: String(x.id),
      name: String(x.name ?? "")
    }));
  const spec = {
    geo_locations: geo,
    age_min: Math.min(Math.max(Number(body.age_min) || 18, 13), 65),
    age_max: Math.min(Math.max(Number(body.age_max) || 65, 13), 65),
    genders: GENDER_CODES[String(body.gender ?? "all")] ?? [
      1,
      2
    ],
    ...placementSpec(body.placements) ?? {
      publisher_platforms: [
        "facebook",
        "instagram"
      ]
    }
  };
  if (Array.isArray(body.devices) && body.devices.length) spec.device_platforms = body.devices.filter((d)=>[
      "mobile",
      "desktop"
    ].includes(d));
  if (ints.length || behs.length) spec.flexible_spec = [
    {
      ...ints.length ? {
        interests: ints
      } : {},
      ...behs.length ? {
        behaviors: behs
      } : {}
    }
  ];
  const goal = REACH_GOALS.includes(body.optimization_goal) ? body.optimization_goal : "CONVERSATIONS";
  const d = await graphGet(`act_${actId}/delivery_estimate`, {
    optimization_goal: goal,
    targeting_spec: JSON.stringify(spec)
  }, token);
  const row = d?.data?.[0];
  return {
    ok: true,
    ready: row?.estimate_ready !== false,
    lower: row?.estimate_mau_lower_bound ?? null,
    upper: row?.estimate_mau_upper_bound ?? null,
    states_resolved: regionKeys.length
  };
}
// -- AI inbox + push --
// An inbox row is the AI speaking first: it shows up in the person's AI chat tab, and a push
// tells them to look. The unique (profile_id, dedupe_key) index means each thing is announced once.
async function notifyInbox(admin, row) {
  const { error } = await admin.from("ai_inbox").insert({
    ...row,
    payload: row.payload ?? {}
  });
  if (error) {
    if (error.code !== "23505") console.error("ai_inbox insert:", error.message);
    return false;
  }
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/handle-whatsapp-reply`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        audience: {
          user_ids: [
            row.profile_id
          ]
        },
        category: "ads",
        notification: {
          title: row.title,
          body: row.body ?? "",
          url: "/dashboard_new.html#ai",
          tag: row.dedupe_key
        }
      })
    });
  } catch (e) {
    console.error("push failed:", e);
  }
  return true;
}
// Campaigns created before the AI inbox existed are never announced.
const LIVE_ANNOUNCE_AFTER = new Date("2026-10-06T00:00:00Z").getTime();
// -- scheduled sweep (cron, every 5 minutes) --
async function handleAutoKill(dryRun = false) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: ruleRows } = await admin.from("kill_rules").select("*").eq("enabled", true);
  const rulesByProfile = {};
  for (const r of ruleRows ?? [])(rulesByProfile[r.profile_id] ??= {})[r.kind] = r;
  const { data: capRows } = await admin.from("spend_caps").select("*").eq("enabled", true);
  const capsByProfile = {};
  for (const r of capRows ?? [])(capsByProfile[r.profile_id] ??= {})[r.level] = Number(r.max_spend_naira);
  const { data: accounts } = await admin.from("ad_accounts").select("id, meta_ad_account_id, nickname, company_id, meta_connection_id, media_buyer_id, user_id, billing_mode, markup_pct").eq("status", "active");
  const { data: people } = await admin.from("profiles").select("id, company_id, role, media_buyer_id").in("role", [
    "owner",
    "admin",
    "buyer"
  ]);
  const summary = [];
  let pauses = 0, announced = 0, suggested = 0;
  for (const account of accounts ?? []){
    const actId = String(account.meta_ad_account_id ?? "").replace(/^act_/, "");
    if (!/^\d+$/.test(actId)) continue;
    const here = (people ?? []).filter((p)=>p.company_id === account.company_id);
    const owners = here.filter((p)=>p.id === account.user_id || p.media_buyer_id && p.media_buyer_id === account.media_buyer_id);
    const watchers = owners.filter((p)=>rulesByProfile[p.id]);
    const liveFor = [
      ...new Map([
        ...owners,
        ...here.filter((p)=>p.role === "owner" || p.role === "admin")
      ].map((p)=>[
          p.id,
          p
        ])).values()
    ];
    if (!liveFor.length) continue;
    try {
      const token = await resolveToken(admin, account);
      const [campaigns, adsets, ads, life] = await Promise.all([
        graphGetAll(`act_${actId}/campaigns`, {
          fields: "id,name,effective_status,created_time",
          effective_status: JSON.stringify([
            "ACTIVE"
          ])
        }, token),
        graphGetAll(`act_${actId}/adsets`, {
          fields: "id,name,campaign_id,optimization_goal,destination_type,start_time,status,effective_status,created_time"
        }, token),
        graphGetAll(`act_${actId}/ads`, {
          fields: "id,name,adset_id,campaign_id,status,effective_status,created_time",
          effective_status: JSON.stringify([
            "ACTIVE"
          ])
        }, token),
        insightsByLevel(actId, "ad", "lifetime", token, factorOf(account))
      ]);
      const setById = {};
      for (const s of adsets)setById[s.id] = {
        ...s,
        kind: adsetKind(s)
      };
      const paused = new Set();
      // 1) kill rules -- each watcher judges with their own thresholds
      for (const ad of ads){
        const set = setById[ad.adset_id];
        const kind = set?.kind ?? "other";
        const m = life[ad.id] ?? EMPTY;
        const liveSince = latestTime(ad.created_time, set?.start_time);
        for (const w of watchers){
          const rule = rulesByProfile[w.id][kind];
          const verdict = evaluateRule(rule, {
            ...ad,
            kind,
            live_since: liveSince
          }, m);
          if (dryRun) {
            summary.push({
              account: account.nickname,
              ad: ad.name,
              kind,
              for: w.id,
              ...m,
              would_pause: verdict?.reason ?? null,
              mode: verdict ? rule.auto_kill ? "auto-pause" : "suggest" : null
            });
            continue;
          }
          if (!verdict?.kill || paused.has(ad.id)) continue;
          if (rule.auto_kill) {
            if (pauses >= MAX_AUTO_PAUSES_PER_RUN) continue;
            const result = await pauseOrResume(admin, account, actId, token, "ad", ad.id, "PAUSED");
            pauses++;
            paused.add(ad.id);
            await admin.from("ad_kill_log").insert({
              company_id: account.company_id,
              ad_account_id: account.id,
              level: "ad",
              meta_object_id: ad.id,
              object_name: result.name,
              action: "paused",
              source: "auto",
              actor_profile_id: w.id,
              reason: verdict.reason,
              metrics: m
            });
            await notifyInbox(admin, {
              company_id: account.company_id,
              profile_id: w.id,
              ad_account_id: account.id,
              kind: "auto_killed",
              title: `Paused “${result.name}”`,
              body: `${verdict.reason} I paused it for you (${account.nickname}).`,
              payload: {
                level: "ad",
                object_id: ad.id,
                object_name: result.name,
                ad_account_id: account.id,
                reason: verdict.reason
              },
              dedupe_key: `auto:${ad.id}`
            });
            summary.push({
              account: account.nickname,
              ad: result.name,
              reason: verdict.reason,
              action: "paused"
            });
          } else {
            const ok = await notifyInbox(admin, {
              company_id: account.company_id,
              profile_id: w.id,
              ad_account_id: account.id,
              kind: "kill_suggestion",
              title: `Kill “${ad.name}”?`,
              body: `${verdict.reason} (${account.nickname})`,
              payload: {
                kind: "status",
                ad_account_id: account.id,
                account_name: account.nickname,
                level: "ad",
                object_id: ad.id,
                object_name: ad.name,
                status: "PAUSED",
                reason: verdict.reason
              },
              dedupe_key: `kill:${ad.id}`
            });
            if (ok) {
              suggested++;
              summary.push({
                account: account.nickname,
                ad: ad.name,
                reason: verdict.reason,
                action: "suggested"
              });
            }
          }
        }
      }
      // 1b) spend limits (a campaign or ad set that has spent its limit is switched off, all its ads counted together),
      //     and switching off ad sets / campaigns whose ads / ad sets are all off already
      {
        const capWatchers = owners.filter((p)=>capsByProfile[p.id]);
        const capOf = (lvl)=>{ const v = capWatchers.map((p)=>capsByProfile[p.id][lvl]).filter((n)=>n > 0); return v.length ? Math.min(...v) : null; };
        const caps = { campaign: capOf("campaign"), adset: capOf("adset") };
        const [campAll, adsAll] = await Promise.all([
          graphGetAll(`act_${actId}/campaigns`, { fields: "id,name,status,created_time", effective_status: JSON.stringify(["ACTIVE", "WITH_ISSUES"]) }, token),
          graphGetAll(`act_${actId}/ads`, { fields: "id,adset_id,campaign_id,status,created_time", effective_status: JSON.stringify(AD_STATES) }, token)
        ]);
        const spendOf = async (lvl)=>{ const m = await insightsByLevel(actId, lvl, "lifetime", token, factorOf(account)); return Object.fromEntries(Object.entries(m).map(([k, v])=>[k, Number(v.spend) || 0])); };
        const spend = { campaign: caps.campaign ? await spendOf("campaign") : {}, adset: caps.adset ? await spendOf("adset") : {} };
        const seen = new Set();
        const todo = [...planCaps(caps, campAll, adsets, spend), ...planCascade(campAll, adsets, adsAll)].filter((t)=>!seen.has(t.id) && seen.add(t.id));
        const tellWho = owners.length ? owners : liveFor;
        for (const t of todo){
          if (dryRun) { summary.push({ account: account.nickname, would_pause: `${t.level} ${t.name}`, reason: t.reason }); continue; }
          if (pauses >= MAX_AUTO_PAUSES_PER_RUN) break;
          try {
            const result = await pauseOrResume(admin, account, actId, token, t.level, t.id, "PAUSED");
            pauses++;
            await admin.from("ad_kill_log").insert({ company_id: account.company_id, ad_account_id: account.id, level: t.level, meta_object_id: t.id, object_name: result.name, action: "paused", source: "auto", actor_profile_id: tellWho[0]?.id ?? null, reason: t.reason });
            for (const p of tellWho) await notifyInbox(admin, { company_id: account.company_id, profile_id: p.id, ad_account_id: account.id, kind: "auto_killed", title: `Paused ${t.level === "adset" ? "ad set" : "campaign"} “${result.name}”`, body: `${t.reason} (${account.nickname})`, payload: { level: t.level, object_id: t.id, object_name: result.name, ad_account_id: account.id, reason: t.reason }, dedupe_key: `auto:${t.id}` });
            summary.push({ account: account.nickname, [t.level]: result.name, reason: t.reason, action: "paused" });
          } catch (e) { summary.push({ account: account.nickname, [t.level]: t.name, error: String(e.message ?? e) }); }
        }
      }
      // 2) campaigns that just went live: announce the campaign with its ad sets and ads, once
      const now = Date.now();
      for (const c of campaigns){
        const created = new Date(c.created_time).getTime();
        if (created < LIVE_ANNOUNCE_AFTER || now - created > 14 * 86400_000) continue;
        const sets = adsets.filter((s)=>s.campaign_id === c.id && s.effective_status === "ACTIVE");
        const liveSets = sets.filter((s)=>!s.start_time || new Date(s.start_time).getTime() <= now);
        if (!liveSets.length) continue;
        const lines = liveSets.map((s)=>{
          const names = ads.filter((a)=>a.adset_id === s.id).map((a)=>a.name);
          return `• ${s.name}: ${names.length ? names.join(", ") : "no active ads"}`;
        });
        const nAds = ads.filter((a)=>a.campaign_id === c.id).length;
        if (dryRun) {
          summary.push({
            account: account.nickname,
            campaign_live: c.name,
            ad_sets: liveSets.length,
            ads: nAds
          });
          continue;
        }
        for (const p of liveFor){
          const ok = await notifyInbox(admin, {
            company_id: account.company_id,
            profile_id: p.id,
            ad_account_id: account.id,
            kind: "campaign_live",
            title: `“${c.name}” is live`,
            body: `${liveSets.length} ad set${liveSets.length === 1 ? "" : "s"}, ${nAds} ad${nAds === 1 ? "" : "s"} running in ${account.nickname}.\n${lines.join("\n")}\nI'm watching them now and will flag anything that breaks your kill rules.`,
            payload: {
              campaign_id: c.id
            },
            dedupe_key: `live:${c.id}`
          });
          if (ok) announced++;
        }
      }
    } catch (e) {
      console.error(`sweep ${account.nickname}:`, e.message);
      summary.push({
        account: account.nickname,
        error: e.message
      });
    }
  }
  return {
    ok: true,
    paused: pauses,
    suggested,
    announced,
    summary
  };
}
// -- entrypoint --
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: cors
  });
  try {
    const body = await req.json().catch(()=>({}));
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
    if (body.action === "reach") return json(await handleReach(userClient, body));
    if (body.action === "balances") return json(await handleBalances(userClient, body));
    if (body.action === "set_ad_message") return json(await handleSetAdMessage(userClient, body));
    if (body.action === "set_status") return json(await handleSetStatus(userClient, profile, body));
    if (body.action === "set_budget") return json(await handleSetBudget(userClient, profile, body));
    if (body.action === "targeting_search") return json(await handleTargetingSearch(userClient, body));
    if (body.action === "reach_estimate") return json(await handleReachEstimate(userClient, body));
    if (body.action === "ad_preview") return json(await handleAdPreview(userClient, body));
    if (body.action === "set_ad_image") return json(await handleSetAdImage(userClient, body));
    throw new HttpError(400, "Unknown action.");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error("ads-manager error:", e);
    return json({
      ok: false,
      error: e.message ?? String(e)
    }, status);
  }
});
