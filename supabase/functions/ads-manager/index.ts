import { planCascade, planCaps } from "../_shared/autooff.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";
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
  if (!res.ok || data.error) {
    const msg = data?.error?.message || `Meta error ${res.status}`;
    // Meta says "too many calls": tell the shared gate so every background job waits 15 minutes.
    if (/too many calls|rate limit|request limit/i.test(msg) || [4, 17, 32, 613, 80004].includes(Number(data?.error?.code))) {
      try { void createClient(SUPABASE_URL, SERVICE_KEY).rpc("meta_rate_hit").then(() => {}, () => {}); } catch { /* ignore */ }
    }
    throw new HttpError(502, msg);
  }
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
    case "last2":
      return {
        time_range: JSON.stringify({
          since: wat(-1),
          until: wat(0)
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
const firstValue = (arr)=>num((arr ?? [])[0]?.value);
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
    cost_per_landing_page_view: landingPageViews > 0 ? spend / landingPageViews : null,
    // more of what Meta reports: outbound clicks, the buying funnel, post engagement, video watching, and what purchases were worth
    outbound_clicks: firstValue(r.outbound_clicks),
    add_to_cart: actionValue(r.actions, ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"]),
    initiate_checkout: actionValue(r.actions, ["omni_initiated_checkout", "initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout"]),
    view_content: actionValue(r.actions, ["omni_view_content", "view_content", "offsite_conversion.fb_pixel_view_content"]),
    post_engagement: actionValue(r.actions, ["post_engagement"]),
    reactions: actionValue(r.actions, ["post_reaction"]),
    comments: actionValue(r.actions, ["comment"]),
    shares: actionValue(r.actions, ["post"]),
    saves: actionValue(r.actions, ["onsite_conversion.post_save"]),
    video_plays: firstValue(r.video_play_actions),
    video_thruplays: firstValue(r.video_thruplay_watched_actions),
    video_p25: firstValue(r.video_p25_watched_actions),
    video_p50: firstValue(r.video_p50_watched_actions),
    video_p75: firstValue(r.video_p75_watched_actions),
    video_p100: firstValue(r.video_p100_watched_actions),
    video_avg_seconds: firstValue(r.video_avg_time_watched_actions),
    purchase_value: actionValue(r.action_values, PURCHASE_ACTIONS) * factor
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
    fields: `${idField},spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpm,actions,action_values,outbound_clicks,video_play_actions,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions,video_avg_time_watched_actions`,
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
  if (!rule) return null;
  if (ad.status !== "ACTIVE" || ad.effective_status !== "ACTIVE") return null;
  // A scheduled ad set exists on Meta long before it starts delivering: the clock starts at go-live.
  const since = ad.live_since ?? ad.created_time;
  const hours = since ? (Date.now() - new Date(since).getTime()) / 3600_000 : Infinity;
  if (hours < 0) return null;
  // Landing page view cost (website ads only): its own switch. Kill when each view costs more than the limit, or when money was spent and nobody landed on the page.
  const lpvLimit = Number(rule.max_cost_per_lpv);
  if (rule.lpv_enabled && lpvLimit > 0 && ad.kind !== "messaging") {
    const lpvSpend = Number(rule.lpv_min_spend ?? rule.min_spend ?? 0), lpv = Number(life.landing_page_views ?? 0), n = (v)=>"₦" + Math.round(v).toLocaleString("en-NG");
    // Only ads with no purchases are judged here: an ad that sold keeps running whatever its page views cost.
    if (life.spend >= lpvSpend && !(Number(life.purchases ?? 0) > 0)) {
      if (lpv === 0) return { kill: true, auto: !!rule.lpv_auto_kill, reason: `Spent ${n(life.spend)} with 0 landing page views (limit: ${n(lpvLimit)} per view, judged after ${n(lpvSpend)}).` };
      if (life.spend / lpv > lpvLimit) return { kill: true, auto: !!rule.lpv_auto_kill, reason: `${n(life.spend / lpv)} per landing page view is above your ${n(lpvLimit)} limit (${lpv} view${lpv === 1 ? "" : "s"}, ${n(life.spend)} spent).` };
    }
  }
  if (!rule.enabled) return null;
  if (hours < Number(rule.min_hours)) return null;
  if (life.spend < Number(rule.min_spend)) return null;
  // "Never pause an ad that has sold": only ads with no purchases are judged, like campaign and ad set spend limits.
  if (rule.skip_if_purchase && ad.kind !== "messaging" && Number(life.purchases ?? 0) > 0) return null;
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
// The Campaigns screen: live from Meta, with the last good copy kept in the database for instant opening and for when Meta is rate-limiting us.
const snapStatus = (b)=>["live", "paused"].includes(String(b.status)) ? String(b.status) : "all";
const snapRange = (b)=>["today", "yesterday", "last3", "last7", "last30", "lifetime"].includes(b.range) ? b.range : "last7";
async function handleListSafe(userClient, profile, body) {
  const { account } = await getAccount(userClient, body.ad_account_id);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const range = snapRange(body), st = snapStatus(body);
  try {
    const out = await handleList(userClient, profile, body);
    await admin.from("ads_snapshots").upsert({ ad_account_id: account.id, range, status: st, payload: out, fetched_at: new Date().toISOString() }, { onConflict: "ad_account_id,range,status" });
    return out;
  } catch (e) {
    const { data: snap } = await admin.from("ads_snapshots").select("payload, fetched_at").eq("ad_account_id", account.id).eq("range", range).eq("status", st).maybeSingle();
    if (snap?.payload) return { ...snap.payload, ok: true, stale: true, stale_reason: String(e?.message ?? e).slice(0, 220), snapshot_at: snap.fetched_at };
    throw e;
  }
}
async function handleListCached(userClient, body) {
  const { account } = await getAccount(userClient, body.ad_account_id);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: snap } = await admin.from("ads_snapshots").select("payload, fetched_at").eq("ad_account_id", account.id).eq("range", snapRange(body)).eq("status", snapStatus(body)).maybeSingle();
  if (!snap?.payload) return { ok: true, none: true };
  return { ...snap.payload, ok: true, from_snapshot: true, snapshot_at: snap.fetched_at };
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
// -- team_snapshot: the live picture the AI Team meeting works from (internal only). For every active ad account of a company: each campaign's
// numbers today / yesterday / last 2 days / last 7 / last 30 days, and for the campaigns that are winning: how each ad set was set up
// (countries, ages, interests, placements, budget) and the ad copy, headline and picture of the best ads. --
const SNAP_WINDOWS = [["today", "today"], ["yesterday", "yesterday"], ["last_2_days_incl_today", "last2"], ["last_7_days", "last7"], ["last_14d", "last14"], ["last_30_days", "last30"]];
const GENDER = { 1: "men", 2: "women" };
function snapTargeting(t) {
  const g = t?.geo_locations ?? {};
  const interests = [];
  for (const f of t?.flexible_spec ?? []) for (const i of f?.interests ?? []) interests.push(i.name);
  return {
    countries: g.countries ?? [], regions: (g.regions ?? []).map((r)=>r.name).slice(0, 8), cities: (g.cities ?? []).map((c)=>c.name).slice(0, 8),
    ages: t?.age_min || t?.age_max ? `${t?.age_min ?? 18}-${t?.age_max ?? 65}` : null,
    genders: t?.genders?.length ? t.genders.map((x)=>GENDER[x] ?? x).join("+") : "all", interests: [...new Set(interests)].slice(0, 10),
    advantage_audience: t?.targeting_automation?.advantage_audience === 1, platforms: t?.publisher_platforms ?? null
  };
}
function snapCopy(ad) {
  const c = ad.creative ?? {}, o = c.object_story_spec ?? {}, ld = o.link_data, vd = o.video_data;
  const cut = (v, n)=>v ? String(v).replace(/\s+/g, " ").slice(0, n) : null;
  return {
    id: ad.id, name: ad.name, type: vd ? "video" : "image",
    primary_text: cut(c.body ?? ld?.message ?? vd?.message, 420), headline: cut(c.title ?? ld?.name ?? vd?.title, 100), description: cut(ld?.description ?? vd?.link_description, 120),
    cta: c.call_to_action_type ?? ld?.call_to_action?.type ?? vd?.call_to_action?.type ?? null, picture_url: c.image_url ?? ld?.picture ?? vd?.image_url ?? c.thumbnail_url ?? null
  };
}

// Read-only look at the shared Meta token: which app it belongs to, its kind, what it may do, and how much of the call allowance is used.
// Never returns the token. Called with the cron secret only.
async function handleMetaAppInfo() {
  if (!SHARED_META_TOKEN) return { ok: false, error: "No shared Meta token is set." };
  const dbg = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(SHARED_META_TOKEN)}&access_token=${encodeURIComponent(SHARED_META_TOKEN)}`).then((r)=>r.json()).catch((e)=>({ error: { message: String(e) } }));
  const d = dbg?.data ?? {};
  const probe = await fetch(`${GRAPH}/me/adaccounts?fields=account_id&limit=1&access_token=${encodeURIComponent(SHARED_META_TOKEN)}`);
  const hdr = (k)=>{ try { return JSON.parse(probe.headers.get(k) ?? "null"); } catch { return probe.headers.get(k); } };
  return {
    ok: true,
    token: { app_id: d.app_id, application: d.application, type: d.type, is_valid: d.is_valid, expires_at: d.expires_at, data_access_expires_at: d.data_access_expires_at, scopes: d.scopes, granular_scopes: (d.granular_scopes ?? []).map((g)=>({ scope: g.scope, targets: (g.target_ids ?? []).length })), error: dbg?.error?.message },
    usage: { app: hdr("x-app-usage"), ad_account: hdr("x-ad-account-usage"), business_use_case: hdr("x-business-use-case-usage") },
    probe_status: probe.status
  };
}

// Read-only live spend for a company's active ad accounts, straight from Meta: today and yesterday (Lagos days). Cron secret only.
async function handleLiveSpend(companyId) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: accts } = await admin.from("ad_accounts").select("id, meta_ad_account_id, nickname, name, company_id, meta_connection_id, media_buyer_id, user_id, billing_mode, markup_pct, currency").eq("company_id", companyId).eq("status", "active");
  const today = wat(0), yday = wat(-1);
  const out = [];
  for (const a of accts ?? []){
    const actId = String(a.meta_ad_account_id ?? "").replace(/^act_/, "");
    if (!/^\d+$/.test(actId)) continue;
    try {
      const token = await resolveToken(admin, a), factor = factorOf(a);
      const rows = await graphGetAll(`act_${actId}/insights`, { level: "account", time_increment: "1", time_range: JSON.stringify({ since: yday, until: today }), fields: "spend,impressions,actions,date_start" }, token);
      const by = {}; for (const r of rows) by[r.date_start] = insightRow(r, factor);
      out.push({ account: a.nickname || a.name, today: Math.round(by[today]?.spend ?? 0), yesterday: Math.round(by[yday]?.spend ?? 0), purchases_today: by[today]?.purchases ?? 0, purchases_yesterday: by[yday]?.purchases ?? 0 });
    } catch (e) { out.push({ account: a.nickname || a.name, error: String(e?.message ?? e) }); }
  }
  return { ok: true, today, yesterday: yday, accounts: out };
}

// ======================= VIDEO ANATOMY: how a winning video ad is built, scene by scene =======================================
// Once a day, for the best video ads that were not studied yet: the video file from Meta goes to the AWS video machine, which returns a picture
// at every scene change and the sound; the words are transcribed, and the pictures and words are described scene by scene (what is shown, the text
// on screen, what is said, and the job of the scene: hook, problem, proof, offer, call to action). The result teaches the creative agent.
const hmacHexKey = async (key, text)=>{ const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text)))].map((b)=>b.toString(16).padStart(2, "0")).join(""); };
async function framesTicketKey(admin) { const { data } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle(); return String(data?.value ?? ""); }
// The AWS machine asks this to check a signed request. Nothing secret is returned.
async function handleFramesCheck(body) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const id = String(body.video_id ?? ""), exp = Number(body.exp), key = await framesTicketKey(admin);
  if (!key || !/^\d{5,25}$/.test(id) || !(exp > Date.now()) || exp > Date.now() + 15 * 60_000) return { ok: false };
  return { ok: (await hmacHexKey(key, `frames:${id}:${exp}`)) === String(body.sig ?? "") };
}
async function openaiVideoAnalysis(frames, transcript, meta) {
  const OPENAI = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!OPENAI) throw new Error("OPENAI_API_KEY is not set");
  const content = [{ type: "text", text: `You are studying ONE winning video ad for a direct-response ad learning system. The pictures are frames of the video in time order, one per scene change (the time in seconds is given before each). The spoken words (transcript) are given too. Describe ONLY what you can see and hear. Reply with JSON only:
{"scenes":[{"t":seconds,"shows":"what is on screen","text_on_screen":"every word visible, exactly","voiceover":"what is said during this scene, or empty","role":"hook|problem|proof|offer|call_to_action|other"}],
 "structure":{"hook":"the first 3 seconds: what grabs the viewer","problem":"how the problem or fear is shown","proof":"what makes it believable (people, results, demonstration)","offer":"what is offered and how","call_to_action":"how and when the viewer is told to act, with the exact words"},
 "style":"look and feel, pace, how it was filmed, music or silence, who appears","length_s":${meta.length ?? 0},
 "why_it_may_work":"2 sentences","how_to_recreate":"a short brief someone could follow to make a similar video or a still image for this product"}
Ad headline: ${String(meta.headline ?? "").slice(0, 200)}. Transcript: ${String(transcript ?? "").slice(0, 3000) || "(no speech)"}` }];
  for (const f of frames){ content.push({ type: "text", text: `Frame at ${f.t}s:` }); content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${f.jpg}`, detail: "low" } }); }
  const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${OPENAI}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "user", content }] }) });
  const j = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(j?.error?.message || `OpenAI HTTP ${r.status}`);
  await learnCount("gpt-4o-mini", { input_tokens: j.usage?.prompt_tokens, output_tokens: j.usage?.completion_tokens });
  try { return JSON.parse(j.choices?.[0]?.message?.content ?? "{}"); } catch (_) { return { why_it_may_work: String(j.choices?.[0]?.message?.content ?? "").slice(0, 600) }; }
}
async function transcribeAudio(b64) {
  const OPENAI = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!OPENAI || !b64) return "";
  const bin = Uint8Array.from(atob(b64), (c)=>c.charCodeAt(0));
  const fd = new FormData(); fd.append("file", new Blob([bin], { type: "audio/mpeg" }), "audio.mp3"); fd.append("model", "whisper-1"); fd.append("response_format", "text");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${OPENAI}` }, body: fd });
  if (!r.ok) return "";
  return String(await r.text()).trim().slice(0, 4000);
}
async function handleLearnVideo(limit = 2, only = "") {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const lambda = Deno.env.get("TRANSCODE_URL") ?? "";
  if (!lambda) return { ok: false, error: "TRANSCODE_URL is not set." };
  const cap = await learnOverCap(admin);
  if (cap.over) return { ok: true, skipped: "monthly learning budget reached", spent_usd: cap.spent, cap_usd: cap.cap };
  const { data: cos } = await admin.from("companies").select("id").eq("learning_enabled", false);
  const off = new Set((cos ?? []).map((c)=>c.id));
  // Winners: video ads that sold or got messages in the last 30 days, best first.
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const { data: days } = await admin.from("learn_daily").select("object_id, ad_account_id, spend, purchases, messages").eq("level", "ad").gte("day", since).limit(20000);
  const agg = new Map();
  for (const d of days ?? []){ const x = agg.get(d.object_id) ?? { acct: d.ad_account_id, spend: 0, wins: 0 }; x.spend += Number(d.spend) || 0; x.wins += (Number(d.purchases) || 0) + (Number(d.messages) || 0); agg.set(d.object_id, x); }
  const ranked = [...agg.entries()].filter(([, x])=>x.wins > 0).sort((a, b)=>b[1].wins - a[1].wins || a[1].spend - b[1].spend).map(([id])=>id);
  const { data: ads } = ranked.length ? await admin.from("learn_objects").select("ad_account_id, company_id, meta_id, name, creative").eq("level", "ad").in("meta_id", ranked.slice(0, 120)) : { data: [] };
  const byId = new Map((ads ?? []).map((a)=>[a.meta_id, a]));
  const cands = [];
  // A named video (a test or a manual request) skips the winners filter.
  if (only){
    const { data: one } = await admin.from("learn_objects").select("ad_account_id, company_id, meta_id, name, creative").eq("level", "ad").contains("creative", { video_ids: [only] }).limit(1);
    if (one?.[0] && !off.has(one[0].company_id)) cands.push({ ad: one[0], vid: only });
  }
  for (const id of ranked){ const a = byId.get(id); const vid = a?.creative?.video_ids?.[0]; if (a && vid && !off.has(a.company_id) && (!only || String(vid) === only)) cands.push({ ad: a, vid: String(vid) }); }
  const { data: have } = cands.length ? await admin.from("learn_videos").select("video_id, error, created_at, analyzed_at").in("video_id", cands.map((c)=>c.vid)) : { data: [] };
  const haveMap = new Map((have ?? []).map((h)=>[h.video_id, h]));
  const todo = cands.filter((c)=>{ const h = haveMap.get(c.vid); return !h || (!h.analyzed_at && Date.now() - new Date(h.created_at).getTime() > 3 * 86400_000); }).slice(0, limit);
  const key = await framesTicketKey(admin), out = [];
  const deadline = Date.now() + 110_000;
  for (const c of todo){
    if (Date.now() > deadline) break;
    const row = { video_id: c.vid, ad_account_id: c.ad.ad_account_id, company_id: c.ad.company_id, ad_id: c.ad.meta_id, created_at: new Date().toISOString() };
    try {
      const { data: acct } = await admin.from("ad_accounts").select("id, meta_connection_id, company_id").eq("id", c.ad.ad_account_id).maybeSingle();
      const token = await resolveToken(admin, acct);
      const v = await graphGet(c.vid, { fields: "source,length" }, token);
      if (!v.source) throw new Error("Meta did not give the video file for this ad.");
      const exp = Date.now() + 10 * 60_000, sig = await hmacHexKey(key, `frames:${c.vid}:${exp}`);
      const r = await fetch(lambda, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "frames", video_id: c.vid, video_url: v.source, exp, sig }), signal: AbortSignal.timeout(100_000) });
      const f = await r.json().catch(()=>({}));
      if (!r.ok || !f.ok || !(f.frames ?? []).length) throw new Error(f.error || `video machine HTTP ${r.status}`);
      const frames = [];
      for (const [k, fr] of f.frames.entries()){
        const path = `video/${c.vid}/${k}.jpg`;
        await admin.storage.from("learn-media").upload(path, Uint8Array.from(atob(fr.jpg), (ch)=>ch.charCodeAt(0)), { contentType: "image/jpeg", upsert: true });
        frames.push({ t: fr.t, path });
      }
      const transcript = await transcribeAudio(f.audio);
      const analysis = await openaiVideoAnalysis(f.frames, transcript, { length: f.duration, headline: c.ad.creative?.headline });
      await admin.from("learn_videos").upsert({ ...row, length_s: f.duration, frames, transcript, analysis, error: null, analyzed_at: new Date().toISOString() });
      out.push({ video: c.vid, ad: c.ad.name, scenes: f.frames.length, seconds: f.duration, spoken_words: transcript.split(/\s+/).filter(Boolean).length });
    } catch (e) {
      await admin.from("learn_videos").upsert({ ...row, error: String(e.message ?? e).slice(0, 240) });
      out.push({ video: c.vid, error: String(e.message ?? e).slice(0, 160) });
    }
  }
  return { ok: true, candidates: cands.length, studied: out };
}
async function handleTeamSnapshot(body) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const companyId = String(body.company_id ?? "");
  if (!/^[0-9a-f-]{36}$/.test(companyId)) throw new HttpError(400, "company_id missing.");
  const { data: accounts } = await admin.from("ad_accounts").select("id, meta_ad_account_id, nickname, company_id, meta_connection_id, media_buyer_id, user_id, billing_mode, markup_pct, currency").eq("company_id", companyId).eq("status", "active");
  const usable = (accounts ?? []).filter((a)=>/^\d+$/.test(String(a.meta_ad_account_id ?? "").replace(/^act_/, "")));
  const results = await Promise.allSettled(usable.map(async (a)=>{
    const actId = String(a.meta_ad_account_id).replace(/^act_/, ""), token = await resolveToken(admin, a), factor = factorOf(a);
    const [camps, ...wins] = await Promise.all([
      graphGetAll(`act_${actId}/campaigns`, { fields: "id,name,status,effective_status,daily_budget,lifetime_budget,objective,created_time", effective_status: JSON.stringify(["ACTIVE", "PAUSED", "WITH_ISSUES"]) }, token),
      ...SNAP_WINDOWS.map(([, r])=>insightsByLevel(actId, "campaign", r, token, factor).catch(()=>({})))
    ]);
    const num2 = (m)=>m ? { spend: Math.round(m.spend), purchases: m.purchases, conversations: m.conversations, clicks: m.clicks, landing_page_views: m.landing_page_views, cost_per_purchase: m.purchases > 0 ? Math.round(m.spend / m.purchases) : null, cost_per_conversation: m.conversations > 0 ? Math.round(m.spend / m.conversations) : null } : null;
    const rows = camps.map((c)=>{
      const w = {}; SNAP_WINDOWS.forEach(([k], i)=>{ const v = num2(wins[i][c.id]); if (v && (v.spend > 0 || v.purchases || v.conversations)) w[k] = v; });
      return { id: c.id, name: c.name, status: c.effective_status, objective: c.objective, daily_budget: c.daily_budget ? Math.round(num(c.daily_budget) * factor / 100) : null, created: String(c.created_time ?? "").slice(0, 10), ...w };
    }).filter((r)=>r.status === "ACTIVE" || r.last_30_days);
    rows.sort((x, y)=>(y.last_7_days?.purchases ?? 0) - (x.last_7_days?.purchases ?? 0) || (y.last_7_days?.conversations ?? 0) - (x.last_7_days?.conversations ?? 0) || (y.last_7_days?.spend ?? 0) - (x.last_7_days?.spend ?? 0));
    // how the best ones were built, and what their ads say
    const top = rows.filter((r)=>(r.last_30_days?.purchases ?? 0) + (r.last_30_days?.conversations ?? 0) > 0).slice(0, 3);
    const [adIns, adToday, adWeek, adFort] = top.length ? await Promise.all(["last30", "today", "last7", "last14"].map((r)=>insightsByLevel(actId, "ad", r, token, factor).catch(()=>({})))) : [{}, {}, {}, {}];
    const winners = await Promise.all(top.map(async (c)=>{
      const [sets, ads] = await Promise.all([
        graphGetAll(`${c.id}/adsets`, { fields: "id,name,status,daily_budget,optimization_goal,destination_type,bid_strategy,targeting" }, token).catch(()=>[]),
        graphGetAll(`${c.id}/ads`, { fields: "id,name,adset_id,status,creative.thumbnail_width(800).thumbnail_height(800){body,title,object_story_spec,thumbnail_url,image_url,call_to_action_type}" }, token).catch(()=>[])
      ]);
      // the ads that sold TODAY come first, then this week's, then the month's
      const best = ads.map((ad)=>({ ad, m: adIns[ad.id], t: adToday[ad.id], w: adWeek[ad.id], f: adFort[ad.id] })).sort((x, y)=>(y.t?.purchases ?? 0) - (x.t?.purchases ?? 0) || (y.w?.purchases ?? 0) - (x.w?.purchases ?? 0) || (y.m?.purchases ?? 0) - (x.m?.purchases ?? 0) || (y.m?.conversations ?? 0) - (x.m?.conversations ?? 0) || (y.m?.spend ?? 0) - (x.m?.spend ?? 0)).slice(0, 4);
      return {
        campaign: c.name, objective: c.objective,
        // Where this campaign REALLY runs: its ad sets' targeting. The words and pictures of its ads may mention another country; ignore that.
        runs_in_countries: [...new Set(sets.flatMap((s)=>s?.targeting?.geo_locations?.countries ?? []))],
        ad_sets: sets.filter((s)=>s.status === "ACTIVE").slice(0, 4).map((s)=>({ name: s.name, daily_budget: s.daily_budget ? Math.round(num(s.daily_budget) * factor / 100) : null, optimization: s.optimization_goal, destination: s.destination_type, bid: s.bid_strategy, targeting: snapTargeting(s.targeting) })),
        best_ads: best.map(({ ad, m, t, w, f })=>({ ...snapCopy(ad), today: num2(t), last_7_days: num2(w), last_14_days: num2(f), last_30_days: num2(m) }))
      };
    }));
    return { account: a.nickname, currency: a.currency ?? "NGN", campaigns: rows.slice(0, 25), winners };
  }));
  return { ok: true, generated_at: new Date().toISOString(), accounts: results.map((r, i)=>r.status === "fulfilled" ? r.value : { account: usable[i].nickname, error: String(r.reason?.message ?? r.reason).slice(0, 160) }) };
}
// -- notifications from Meta: a message for every new purchase an ad gets (checked every few minutes) --
async function notifyRpc(admin, args) {
  const { error } = await admin.rpc("rv_notify", args);
  if (error) console.error("rv_notify:", error.message);
}
// True only when the account has an ACTIVE ad whose ad set and campaign are on too (Meta's effective_status already folds the parents in).
async function hasActiveAds(actId, token) {
  try { const d = await graphGet(`act_${actId}/ads`, { fields: "id", effective_status: JSON.stringify(["ACTIVE"]), limit: "1" }, token); return (d.data ?? []).length > 0; } catch (_) { return false; }
}
// Watch the Meta balance of a running account. If it rises by more than the spend explains, money arrived from somewhere else
// (Opay, a card, a transfer): log it as funds received. Sends from the Revora wallet are already logged, so they are subtracted first.
async function trackBalance(admin, a, actId, token, day, spendNow) {
  if (a.billing_mode === "managed") return null;
  const bal = await accountBalance(admin, a, actId, token);
  if (bal == null) return null;
  const { data: prev } = await admin.from("ad_balance_track").select("*").eq("ad_account_id", a.id).maybeSingle();
  let added = 0;
  if (prev) {
    const spentSince = prev.day === day ? Math.max(0, spendNow - Number(prev.spend_today)) : spendNow;
    // Spend beyond what the Meta balance held was paid from somewhere else (card, Opay): take that amount off the buyer's Revora wallet, as far as the wallet goes.
    const over = Math.round(spentSince - Number(prev.balance));
    if (over >= 100 && a.media_buyer_id) {
      const { data: w } = await admin.rpc("buyer_wallet_balance", { p_buyer: a.media_buyer_id });
      const take = Math.min(over, Math.max(0, Math.round(Number(w ?? 0))));
      if (take > 0) {
        await admin.from("wallet_adjustments").insert({ company_id: a.company_id, media_buyer_id: a.media_buyer_id, amount_naira: take, reason: "meta_overspend", ref: `acct:${a.id}:${Date.now()}` });
        await notifyRpc(admin, { p_company: a.company_id, p_category: "money", p_kind: "wallet_deducted", p_title: `Wallet −₦${take.toLocaleString("en-NG")}: ${a.nickname ?? "ad account"} spent more than its Meta balance`,
          p_body: `Meta spend went past the balance on ${a.nickname ?? "the account"}, so ₦${take.toLocaleString("en-NG")} was taken off your Revora wallet.`, p_url: "/dashboard_new.html?open=tab:wallet", p_severity: "warning",
          p_data: { ad_account_id: a.id, taken: take }, p_dedupe: `walletdeduct:${a.id}:${Date.now()}`, p_buyer: a.media_buyer_id, p_user: null, p_push: true });
      }
    }
    const expected = Number(prev.balance) - spentSince;
    let jump = bal - expected;
    if (jump > 0 && a.media_buyer_id) {
      const { data: sent } = await admin.from("fund_requests").select("amount_naira").eq("media_buyer_id", a.media_buyer_id).eq("paid_from", "buyer").eq("status", "transferred").gte("transferred_at", prev.updated_at);
      jump -= (sent ?? []).reduce((t, x)=>t + Number(x.amount_naira || 0), 0);
    }
    if (jump >= 1000) added = Math.round(jump);
  }
  await admin.from("ad_balance_track").upsert({ ad_account_id: a.id, day, balance: bal, spend_today: spendNow, updated_at: new Date().toISOString() });
  if (added > 0) {
    // Money that reached Meta: if the buyer's Revora wallet holds enough, it came out of that balance; only the rest is new money from another source.
    let fromWallet = 0;
    if (a.media_buyer_id) {
      const { data: w } = await admin.rpc("buyer_wallet_balance", { p_buyer: a.media_buyer_id });
      fromWallet = Math.min(added, Math.max(0, Math.round(Number(w ?? 0))));
      if (fromWallet > 0) await admin.from("wallet_adjustments").insert({ company_id: a.company_id, media_buyer_id: a.media_buyer_id, amount_naira: fromWallet, reason: "sent_to_meta_from_balance", ref: `acct:${a.id}:${Date.now()}` });
    }
    const other = added - fromWallet;
    if (other > 0) await admin.from("fund_logs").insert({ company_id: a.company_id, media_buyer_id: a.media_buyer_id ?? null, ad_account_id: a.id, amount_naira: other, source: "meta_detected", note: `Balance on ${a.nickname ?? "ad account"} went up (sent from another source)`, log_date: day });
    const m = (n)=>"₦" + Math.round(n).toLocaleString("en-NG");
    await notifyRpc(admin, { p_company: a.company_id, p_category: "money", p_kind: "meta_funded", p_title: `💰 ${a.nickname ?? "Ad account"} was topped up: +${m(added)}`,
      p_body: `Meta balance is now ${m(bal)}. ` + (fromWallet > 0 ? `${m(fromWallet)} was taken off your Revora wallet` : "") + (fromWallet > 0 && other > 0 ? " and " : "") + (other > 0 ? `${m(other)} was logged as funds received from another source` : "") + ".",
      p_url: "/dashboard_new.html?open=tab:wallet", p_severity: "success",
      p_data: { ad_account_id: a.id, added, from_wallet: fromWallet, other, balance: Math.round(bal) }, p_dedupe: `metafunded:${a.id}:${Date.now()}`, p_buyer: a.media_buyer_id ?? null, p_user: null, p_push: true });
  }
  return added;
}
async function handlePurchaseAlerts() {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const day = wat(0), yday = wat(-1);
  const { data: accounts } = await admin.from("ad_accounts").select("id, meta_ad_account_id, nickname, company_id, meta_connection_id, media_buyer_id, user_id, billing_mode, markup_pct").eq("status", "active");
  const usable = (accounts ?? []).filter((a)=>/^\d+$/.test(String(a.meta_ad_account_id ?? "").replace(/^act_/, "")));
  let sent = 0;
  const out = [];
  await Promise.allSettled(usable.map(async (a)=>{
    try {
      const actId = String(a.meta_ad_account_id).replace(/^act_/, ""), token = await resolveToken(admin, a), factor = factorOf(a);
      const ins = await insightsByLevel(actId, "ad", "today", token, factor);
      const spendNow = Object.values(ins).reduce((t, m)=>t + (m.spend || 0), 0);
      if (await hasActiveAds(actId, token)) await trackBalance(admin, a, actId, token, day, spendNow).catch((e)=>console.error("trackBalance:", e.message));
      const buying = Object.entries(ins).filter(([, m])=>(m.purchases ?? 0) > 0);
      let campIns = null; // campaign totals for the message, only fetched when something new happened
      const { data: seenRows } = await admin.from("meta_purchase_seen").select("ad_id, day, purchases").eq("ad_account_id", a.id).gte("day", yday);
      const seen = {}; for (const r of seenRows ?? []) if (r.day === day) seen[r.ad_id] = r.purchases;
      const baseline = !(seenRows ?? []).length; // the first run only learns what is already there, so old purchases do not flood the bell
      for (const [adId, m] of buying){
        const prev = seen[adId] ?? 0;
        if (m.purchases > prev && !baseline) await admin.from("meta_purchase_events").insert({ ad_account_id: a.id, company_id: a.company_id, ad_id: adId, day, added: m.purchases - prev, total_today: m.purchases, spend_today: Math.round(m.spend) }).then(()=>{}, ()=>{});
        if (m.purchases > prev && !baseline && sent < 30) {
          let name = adId, camp = "", campId = "";
          try { const o = await graphGet(adId, { fields: "name,campaign{id,name}" }, token); name = o.name ?? adId; camp = o.campaign?.name ?? ""; campId = o.campaign?.id ?? ""; } catch (_) { /* keep the id */ }
          if (!campIns) campIns = await insightsByLevel(actId, "campaign", "today", token, factor).catch(()=>({}));
          const ct = campId ? campIns[campId] : null;
          const n = m.purchases - prev, cpa = m.spend > 0 ? Math.round(m.spend / m.purchases) : null;
          await notifyRpc(admin, {
            p_company: a.company_id, p_category: "orders", p_kind: "meta_purchase",
            p_title: `🛍 ${n > 1 ? n + " purchases" : "Purchase"} on Meta · ${String(name).slice(0, 70)}`,
            p_body: [`Meta counted ${m.purchases} purchase${m.purchases === 1 ? "" : "s"} on this ad today`, `₦${Math.round(m.spend).toLocaleString("en-NG")} spent${cpa ? ` (₦${cpa.toLocaleString("en-NG")} each)` : ""}`, `${Math.round(m.reach || 0).toLocaleString("en-NG")} people reached`, ct ? `Campaign today: ${ct.purchases} purchases · ₦${Math.round(ct.spend).toLocaleString("en-NG")} spent · ${Math.round(ct.reach || 0).toLocaleString("en-NG")} reached` : null, camp && camp.slice(0, 70), a.nickname].filter(Boolean).join(" · "),
            p_url: "/dashboard_new.html?open=tab:campaigns", p_severity: "success",
            p_data: { ad_id: adId, ad_account_id: a.id, purchases_today: m.purchases, added: n, spend: Math.round(m.spend), reach: Math.round(m.reach || 0), campaign: ct ? { purchases: ct.purchases, spend: Math.round(ct.spend), reach: Math.round(ct.reach || 0) } : null },
            p_dedupe: `metapurchase:${adId}:${day}:${m.purchases}`, p_buyer: a.media_buyer_id ?? null, p_user: null, p_push: true
          });
          sent++;
        }
      }
      const rows = buying.map(([adId, m])=>({ ad_account_id: a.id, ad_id: adId, day, purchases: m.purchases, updated_at: new Date().toISOString() }));
      rows.push({ ad_account_id: a.id, ad_id: "_baseline", day, purchases: 0, updated_at: new Date().toISOString() }); // proves this account has run before, so a first purchase is never swallowed as "baseline"
      await admin.from("meta_purchase_seen").upsert(rows, { onConflict: "ad_account_id,ad_id,day" });
    } catch (e) { out.push({ account: a.nickname, error: String(e.message ?? e).slice(0, 120) }); }
  }));
  admin.from("meta_purchase_seen").delete().lt("day", wat(-3)).then(()=>{}, ()=>{});
  return { ok: true, sent, errors: out };
}

// -- the 9 PM report: orders, visitors and the LIVE Meta numbers (spend, purchases, best campaign), to the owner/admins and to each media buyer --
async function handleDailyDigest(push = true) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const day = wat(0), from = new Date(`${day}T00:00:00+01:00`), to = new Date(from.getTime() + 86400000);
  const money = (n)=>"₦" + Math.round(n).toLocaleString("en-NG");
  const { data: companies } = await admin.from("companies").select("id");
  let sent = 0;
  for (const c of companies ?? []){
    const { data: accounts } = await admin.from("ad_accounts").select("id, meta_ad_account_id, nickname, company_id, meta_connection_id, media_buyer_id, user_id, billing_mode, markup_pct").eq("company_id", c.id).eq("status", "active");
    const usable = (accounts ?? []).filter((a)=>/^\d+$/.test(String(a.meta_ad_account_id ?? "").replace(/^act_/, "")));
    const per = await Promise.allSettled(usable.map(async (a)=>{
      const actId = String(a.meta_ad_account_id).replace(/^act_/, ""), token = await resolveToken(admin, a), factor = factorOf(a);
      const [ins, camps] = await Promise.all([insightsByLevel(actId, "campaign", "today", token, factor), graphGetAll(`act_${actId}/campaigns`, { fields: "id,name", effective_status: JSON.stringify(["ACTIVE", "PAUSED"]) }, token).catch(()=>[])]);
      const names = Object.fromEntries(camps.map((x)=>[x.id, x.name]));
      const rows = Object.entries(ins).map(([id, m])=>({ id, name: names[id] ?? id, spend: m.spend || 0, purchases: m.purchases || 0 }));
      return { buyer: a.media_buyer_id, rows };
    }));
    const metaBy = (buyer)=>{
      const rows = per.filter((r)=>r.status === "fulfilled" && (buyer === undefined || r.value.buyer === buyer)).flatMap((r)=>r.value.rows);
      const spend = rows.reduce((t, r)=>t + r.spend, 0), purchases = rows.reduce((t, r)=>t + r.purchases, 0);
      const best = [...rows].sort((x, y)=>y.purchases - x.purchases || y.spend - x.spend)[0];
      return { spend, purchases, best: best && (best.purchases > 0 || best.spend > 0) ? best : null };
    };
    const { data: ords } = await admin.from("orders").select("media_buyer_id, order_status, order_value_naira").eq("company_id", c.id).gte("ordered_at", from.toISOString()).lt("ordered_at", to.toISOString());
    const ordsBy = (buyer)=>{ const x = (ords ?? []).filter((o)=>o.order_status !== "cancelled" && (buyer === undefined || o.media_buyer_id === buyer)); return { n: x.length, value: x.reduce((t, o)=>t + Number(o.order_value_naira || 0), 0) }; };
    const body = (m, o, vs)=>[m.spend > 0 || m.purchases > 0 ? `Meta: ${money(m.spend)} spent · ${m.purchases} purchase${m.purchases === 1 ? "" : "s"}` : null, m.best && m.best.purchases > 0 ? `Best: ${String(m.best.name).slice(0, 60)} (${m.best.purchases})` : null, vs ? `${vs.visitors} visitors${vs.abandoned > 0 ? ` · ${vs.abandoned} left without ordering` : ""}` : null].filter(Boolean).join(" · ");
    // everyone: owner and admins
    const { data: vsAll } = await admin.rpc("rv_visit_stats_for", { p_company: c.id, p_from: from.toISOString(), p_to: to.toISOString(), p_buyer: null });
    const m = metaBy(undefined), o = ordsBy(undefined), vs = vsAll ? { visitors: Number(vsAll.visitors || 0), abandoned: Number(vsAll.abandoned || 0) } : null;
    if (o.n || m.spend > 0 || m.purchases || vs?.visitors) {
      await notifyRpc(admin, { p_company: c.id, p_category: "reports", p_kind: "daily_digest", p_title: `📊 Today: ${o.n} order${o.n === 1 ? "" : "s"} · ${money(o.value)}`, p_body: body(m, o, vs), p_url: "/dashboard_new.html?open=tab:overview", p_severity: "info",
        p_data: { date: day, orders: o.n, revenue: o.value, meta_spend: Math.round(m.spend), meta_purchases: m.purchases }, p_dedupe: `digest2:${day}`, p_buyer: null, p_user: null, p_push: push });
      sent++;
    }
    // each media buyer: their own accounts and orders
    const { data: buyers } = await admin.from("profiles").select("id, media_buyer_id").eq("company_id", c.id).not("media_buyer_id", "is", null);
    for (const b of buyers ?? []){
      const mb = metaBy(b.media_buyer_id), ob = ordsBy(b.media_buyer_id);
      if (!(ob.n || mb.spend > 0 || mb.purchases)) continue;
      const { data: vb } = await admin.rpc("rv_visit_stats_for", { p_company: c.id, p_from: from.toISOString(), p_to: to.toISOString(), p_buyer: b.media_buyer_id });
      await notifyRpc(admin, { p_company: c.id, p_category: "reports", p_kind: "daily_digest", p_title: `📊 Your day: ${ob.n} order${ob.n === 1 ? "" : "s"} · ${money(ob.value)}`, p_body: body(mb, ob, vb ? { visitors: Number(vb.visitors || 0), abandoned: Number(vb.abandoned || 0) } : null), p_url: "/dashboard_new.html?open=tab:overview", p_severity: "info",
        p_data: { date: day, orders: ob.n, revenue: ob.value, meta_spend: Math.round(mb.spend), meta_purchases: mb.purchases }, p_dedupe: `digest2:${day}:${b.id}`, p_buyer: null, p_user: b.id, p_push: push });
      sent++;
    }
  }
  return { ok: true, sent };
}
// -- reports at 12 PM, 4 PM and 8 PM (Lagos): everything for the day so far, from Meta (spend, purchases, reach, balance, and spend per campaign / ad set / ad) --
async function accountBalance(admin, a, actId, token) {
  try {
    if (a.billing_mode === "managed") { const { data: w } = await admin.rpc("company_wallet_balance", { p_company: a.company_id }); return Math.max(0, Number(w ?? 0)); }
    const d = await graphGet(`act_${actId}`, { fields: "is_prepay_account,funding_source_details" }, token);
    return parseAvailable(d.funding_source_details?.display_string);
  } catch (_) { return null; }
}
// Which report this run is: the nearest of 12pm / 4pm / 8pm Lagos, so a run a few minutes early or late is still labelled right.
function reportSlot() {
  const t = new Date(Date.now() + 3600000), h = t.getUTCHours() + t.getUTCMinutes() / 60;
  const near = [12, 16, 20].reduce((b, x)=>Math.abs(x - h) < Math.abs(b - h) ? x : b, 12);
  return Math.abs(near - h) <= 2 ? near : Math.floor(h);
}
async function handleMetaReport(slotHour, push = true) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const day = wat(0), from = new Date(`${day}T00:00:00+01:00`), to = new Date(from.getTime() + 86400000);
  const monthStart = day.slice(0, 8) + "01", mFrom = new Date(`${monthStart}T00:00:00+01:00`);
  const label = slotHour === 12 ? "Midday report" : slotHour === 16 ? "4pm report" : slotHour === 20 ? "Today's report" : "Report";
  const slot = slotHour === 12 || slotHour === 16 || slotHour === 20 ? String(slotHour) : "x";
  const money = (n)=>"₦" + Math.round(n || 0).toLocaleString("en-NG");
  const { data: companies } = await admin.from("companies").select("id");
  let sent = 0;
  for (const c of companies ?? []){
    const { data: accounts } = await admin.from("ad_accounts").select("id, meta_ad_account_id, nickname, company_id, meta_connection_id, media_buyer_id, user_id, billing_mode, markup_pct").eq("company_id", c.id).eq("status", "active");
    const usable = (accounts ?? []).filter((a)=>/^\d+$/.test(String(a.meta_ad_account_id ?? "").replace(/^act_/, "")));
    if (!usable.length) continue;
    // A buyer can carry a "month so far" starting point (figures from a report kept elsewhere, up to and including as_of); only days after it are added on top.
    const { data: baseRows } = await admin.from("report_baselines").select("*").eq("company_id", c.id).eq("month", day.slice(0, 7));
    const bases = new Map((baseRows ?? []).map((x)=>[x.media_buyer_id, x]));
    const nextDay = (d)=>new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
    const sinceFor = (buyer)=>bases.has(buyer) ? nextDay(bases.get(buyer).as_of) : monthStart;
    const per = await Promise.allSettled(usable.map(async (a)=>{
      const actId = String(a.meta_ad_account_id).replace(/^act_/, ""), token = await resolveToken(admin, a), factor = factorOf(a);
      const mSince = sinceFor(a.media_buyer_id);
      const [rows, campIns, acctIns, balance, monthRows] = await Promise.all([
        graphGetAll(`act_${actId}/insights`, { level: "ad", time_range: JSON.stringify({ since: day, until: day }), fields: "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,actions" }, token, 12),
        insightsByLevel(actId, "campaign", "today", token, factor).catch(()=>({})),
        graphGetAll(`act_${actId}/insights`, { level: "account", time_range: JSON.stringify({ since: day, until: day }), fields: "reach,impressions,spend" }, token).catch(()=>[]),
        accountBalance(admin, a, actId, token),
        graphGetAll(`act_${actId}/insights`, { level: "account", time_range: JSON.stringify({ since: mSince, until: day }), fields: "spend,actions" }, token).catch(()=>[])
      ]);
      const active = await hasActiveAds(actId, token);
      const mm = monthRows[0] ? insightRow(monthRows[0], factor) : { spend: 0, purchases: 0 };
      const camps = new Map();
      for (const r of rows){
        const m = insightRow(r, factor);
        if (!(m.spend > 0 || m.purchases > 0)) continue;
        const cp = camps.get(r.campaign_id) ?? { id: r.campaign_id, name: r.campaign_name, spend: 0, purchases: 0, reach: Math.round(campIns[r.campaign_id]?.reach ?? 0), sets: new Map() };
        cp.spend += m.spend; cp.purchases += m.purchases;
        const st = cp.sets.get(r.adset_id) ?? { name: r.adset_name, spend: 0, purchases: 0, ads: [] };
        st.spend += m.spend; st.purchases += m.purchases; st.ads.push({ name: r.ad_name, spend: Math.round(m.spend), purchases: m.purchases });
        cp.sets.set(r.adset_id, st); camps.set(r.campaign_id, cp);
      }
      const list = [...camps.values()].sort((x, y)=>y.purchases - x.purchases || y.spend - x.spend).slice(0, 10).map((cp)=>({
        name: cp.name, spend: Math.round(cp.spend), purchases: cp.purchases, reach: cp.reach,
        adsets: [...cp.sets.values()].sort((x, y)=>y.purchases - x.purchases || y.spend - x.spend).slice(0, 6).map((st)=>({ name: st.name, spend: Math.round(st.spend), purchases: st.purchases, ads: st.ads.sort((x, y)=>y.purchases - x.purchases || y.spend - x.spend).slice(0, 5) }))
      }));
      const spend = [...camps.values()].reduce((t, x)=>t + x.spend, 0), purchases = [...camps.values()].reduce((t, x)=>t + x.purchases, 0);
      const ar = acctIns[0] ? num(acctIns[0].reach) : 0;
      // Catch any deposit or overspend since the last 5-minute check, so the balance in this report is right to the minute.
      if (active) await trackBalance(admin, a, actId, token, day, spend).catch((e)=>console.error("trackBalance:", e.message));
      return { buyer: a.media_buyer_id, account: a.nickname, active, balance: active ? balance : null, spend: Math.round(spend), purchases, reach: Math.round(ar), month_spend: Math.round(mm.spend), month_purchases: mm.purchases, campaigns: list };
    }));
    const okAccts = per.filter((r)=>r.status === "fulfilled").map((r)=>r.value);
    const { data: ords } = await admin.from("orders").select("media_buyer_id, order_status, order_value_naira").eq("company_id", c.id).gte("ordered_at", from.toISOString()).lt("ordered_at", to.toISOString());
    const { data: mOrds } = await admin.from("orders").select("media_buyer_id, order_status, ordered_at").eq("company_id", c.id).gte("ordered_at", mFrom.toISOString()).lt("ordered_at", to.toISOString());
    // Money received = logged funds + card top-ups + money Revora sent to Meta for the buyer (sends out of a buyer's own held balance are NOT counted again).
    const [{ data: fl }, { data: tp }, { data: fr }, { data: adj }, { data: own }] = await Promise.all([
      admin.from("fund_logs").select("media_buyer_id, amount_naira, log_date").eq("company_id", c.id).gte("log_date", monthStart).lte("log_date", day),
      admin.from("wallet_topups").select("media_buyer_id, amount_naira, confirmed_at").eq("company_id", c.id).eq("status", "confirmed").gte("confirmed_at", mFrom.toISOString()).lt("confirmed_at", to.toISOString()),
      admin.from("fund_requests").select("media_buyer_id, amount_naira, transferred_at").eq("company_id", c.id).eq("paid_from", "company").eq("status", "transferred").gte("transferred_at", mFrom.toISOString()).lt("transferred_at", to.toISOString()),
      admin.from("wallet_adjustments").select("media_buyer_id, amount_naira, created_at, reason").eq("company_id", c.id).in("reason", ["given_by_company", "sent_to_meta_from_balance"]).gte("created_at", mFrom.toISOString()).lt("created_at", to.toISOString()),
      admin.from("fund_requests").select("media_buyer_id, amount_naira, transferred_at").eq("company_id", c.id).eq("paid_from", "buyer").eq("status", "transferred").gte("transferred_at", mFrom.toISOString()).lt("transferred_at", to.toISOString())
    ]);
    const buyerIds = [...new Set(okAccts.map((x)=>x.buyer).filter(Boolean))];
    const wallets = {};
    for (const id of buyerIds){ const { data: w } = await admin.rpc("buyer_wallet_balance", { p_buyer: id }); wallets[id] = Math.max(0, Number(w ?? 0)); }
    const adjIn = (adj ?? []).filter((x)=>x.reason === "given_by_company"), adjSent = (adj ?? []).filter((x)=>x.reason === "sent_to_meta_from_balance");
    const recv = (buyer)=>{
      const ok = (x)=>buyer === undefined || x.media_buyer_id === buyer, add = (rows, f, inDay)=>(rows ?? []).filter(ok).reduce((t, x)=>t + (inDay(f(x)) ? Number(x.amount_naira || 0) : 0), 0);
      const inToday = (iso)=>String(iso).length === 10 ? iso === day : new Date(iso) >= from && new Date(iso) < to, any = ()=>true;
      return {
        // Money credited to the buyer: logged funds, card top-ups, funds the admin gave to their wallet, and money the admin sent straight to Meta for them.
        today: add(fl, (x)=>x.log_date, inToday) + add(tp, (x)=>x.confirmed_at, inToday) + add(fr, (x)=>x.transferred_at, inToday) - add(adjIn, (x)=>x.created_at, inToday),
        month: (()=>{
          const rel = buyer === undefined ? [...bases.keys()] : bases.has(buyer) ? [buyer] : [];
          const aft = (rows, f)=>(rows ?? []).filter(ok).filter((x)=>{ const b = bases.get(x.media_buyer_id), d = String(f(x)).length === 10 ? f(x) : new Date(new Date(f(x)).getTime() + 3600000).toISOString().slice(0, 10); return !b || d > b.as_of; });
          const sum = (rows, f)=>aft(rows, f).reduce((t, x)=>t + Number(x.amount_naira || 0), 0);
          return sum(fl, (x)=>x.log_date) + sum(tp, (x)=>x.confirmed_at) + sum(fr, (x)=>x.transferred_at) - sum(adjIn, (x)=>x.created_at) + rel.reduce((t, id)=>t + Number(bases.get(id).fund_received || 0), 0);
        })(),
        sentToday: add(own, (x)=>x.transferred_at, inToday) + add(adjSent, (x)=>x.created_at, inToday), sentMonth: add(own, (x)=>x.transferred_at, any) + add(adjSent, (x)=>x.created_at, any)
      };
    };
    const make = (buyer)=>{
      const accts = okAccts.filter((x)=>buyer === undefined || x.buyer === buyer);
      const o = (ords ?? []).filter((x)=>x.order_status !== "cancelled" && (buyer === undefined || x.media_buyer_id === buyer));
      const t = { spend: accts.reduce((s, x)=>s + x.spend, 0), purchases: accts.reduce((s, x)=>s + x.purchases, 0), reach: accts.reduce((s, x)=>s + x.reach, 0), balance: accts.reduce((s, x)=>s + (x.balance ?? 0), 0), orders: o.length, orders_value: o.reduce((s, x)=>s + Number(x.order_value_naira || 0), 0) };
      // Order count = CRM orders; when the CRM has none, the Meta purchases stand in. CPA = spend / order count.
      t.order_count = t.orders || t.purchases; t.order_source = t.orders ? "crm" : "meta"; t.cpa = t.order_count ? Math.round(t.spend / t.order_count) : 0;
      const rc = recv(buyer); t.fund_received = Math.round(rc.today); t.sent_to_meta = Math.round(rc.sentToday);
      // Balance = what is left in the wallet + what is left in the Meta ad accounts.
      t.meta_balance = Math.round(t.balance); t.wallet_balance = Math.round(buyer === undefined ? buyerIds.reduce((q, id)=>q + (wallets[id] ?? 0), 0) : (wallets[buyer] ?? 0)); t.balance = t.meta_balance + t.wallet_balance;
      const relB = buyer === undefined ? [...bases.keys()] : bases.has(buyer) ? [buyer] : [];
      const mo = (mOrds ?? []).filter((x)=>{ const b = bases.get(x.media_buyer_id), d = new Date(new Date(x.ordered_at).getTime() + 3600000).toISOString().slice(0, 10); return x.order_status !== "cancelled" && (buyer === undefined || x.media_buyer_id === buyer) && (!b || d > b.as_of); }).length;
      const ms = accts.reduce((s, x)=>s + (x.month_spend || 0), 0) + relB.reduce((q, id)=>q + Number(bases.get(id).ad_spend || 0), 0), mp = accts.reduce((s, x)=>s + (x.month_purchases || 0), 0);
      const moc = (mo || mp) + relB.reduce((q, id)=>q + Number(bases.get(id).order_count || 0), 0);
      t.month = { fund_received: Math.round(rc.month), sent_to_meta: Math.round(rc.sentMonth), spend: ms, order_count: moc, cpa: moc ? Math.round(ms / moc) : 0 };
      return { t, accts };
    };
    const emit = async (who, r, userId)=>{
      const best = r.accts.flatMap((x)=>x.campaigns).sort((x, y)=>y.purchases - x.purchases || y.spend - x.spend)[0];
      // Everyone with a connected ad account gets every report, even on a quiet day (then it says so).
      if (!r.accts.length) return;
      const quiet = !(r.t.spend > 0 || r.t.purchases > 0 || r.t.orders > 0 || r.t.fund_received > 0);
      const bodyLines0 = [`Fund received: ${money(r.t.fund_received)}`].concat(r.t.sent_to_meta > 0 ? [`Sent to Meta: ${money(r.t.sent_to_meta)}`] : []).concat([`Ad spend: ${money(r.t.spend)}`, `Order count: ${r.t.order_count}`, `CPA: ${money(r.t.cpa)}`, `Balance: ${money(r.t.balance)} (wallet ${money(r.t.wallet_balance)} + Meta ${money(r.t.meta_balance)})`]).concat(slotHour === 20 ? [`This month — fund received ${money(r.t.month.fund_received)} · ad spend ${money(r.t.month.spend)} · OC ${r.t.month.order_count} · CPA ${money(r.t.month.cpa)}`] : []);
      const bodyLines = quiet ? ["No ad spend, orders or funds yet today."].concat(bodyLines0) : bodyLines0;
      await notifyRpc(admin, { p_company: c.id, p_category: "reports", p_kind: "meta_report",
        p_title: `📈 ${label}${who ? " · " + who : ""}`,
        p_body: bodyLines.join("\n"),
        p_url: "/dashboard_new.html?open=tab:campaigns", p_severity: "info",
        p_data: { report: { label, date: day, totals: r.t, accounts: r.accts.map(({ buyer, ...x })=>x) } },
        p_dedupe: `report:${day}:${slot}${userId ? ":" + userId : ""}`, p_buyer: null, p_user: userId ?? null, p_push: push });
      sent++;
      // Email copy (owners/admins get the company report; buyers get their own). Off per person in Settings.
      if (push) {
        fetch(`${SUPABASE_URL}/functions/v1/send-internal-email`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ type: "user_email", pref: "email_reports", ...(userId ? { user_id: userId, only_role: "buyer" } : { company_admins: c.id }), subject: `${label}${who ? " · " + who : ""}`, title: `${label}${who ? " · " + who : ""}`, lines: bodyLines, cta_url: "https://dash.revoracrm.online/dashboard_new?open=tab:campaigns", cta_label: "Open campaigns" }) }).catch(()=>{});
      }
      // WhatsApp copy for people who switched it on (their own numbers only; template first, plain text as fallback).
      if (userId && push) {
        const n = (v)=>Math.round(Number(v) || 0).toLocaleString("en-NG"), M = r.t.month;
        fetch(`${SUPABASE_URL}/functions/v1/send-internal-whatsapp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ type: "daily_report", user_id: userId, values: [label, n(r.t.fund_received), n(r.t.sent_to_meta), n(r.t.spend), r.t.order_count, n(r.t.cpa), n(r.t.balance), `fund received ₦${n(M.fund_received)}, ad spend ₦${n(M.spend)}, OC ${M.order_count}, CPA ₦${n(M.cpa)}`] }) }).catch(()=>{});
      }
    };
    await emit("", make(undefined), null);
    const { data: buyers } = await admin.from("profiles").select("id, media_buyer_id").eq("company_id", c.id).not("media_buyer_id", "is", null);
    for (const b of buyers ?? []) await emit("you", make(b.media_buyer_id), b.id);
  }
  return { ok: true, sent };
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
// -- Page posts: list the Page's published posts, and save one as a launchable "post" creative --
async function pageTokenFor(admin, account, token) {
  const { data: acc } = await admin.from("ad_accounts").select("fb_page_id").eq("id", account.id).maybeSingle();
  if (!acc?.fb_page_id) throw new HttpError(400, "This ad account has no Facebook Page connected yet.");
  let pageToken = token;
  try {
    const pt = await graphGet(acc.fb_page_id, {
      fields: "access_token"
    }, token);
    if (pt?.access_token) pageToken = pt.access_token;
  } catch  {}
  return {
    pageId: acc.fb_page_id,
    pageToken
  };
}
async function handlePagePosts(userClient, body) {
  const { account } = await getAccount(userClient, body.ad_account_id);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const token = await resolveToken(admin, account);
  const { pageId, pageToken } = await pageTokenFor(admin, account, token);
  const d = await graphGet(`${pageId}/published_posts`, {
    fields: "id,message,created_time,full_picture,permalink_url,attachments{media_type}",
    limit: String(Math.min(Number(body.limit) || 15, 40))
  }, pageToken);
  return {
    ok: true,
    page_id: pageId,
    posts: (d?.data ?? []).map((p)=>({
        post_id: p.id,
        text: String(p.message ?? "").slice(0, 300),
        created: p.created_time,
        picture: p.full_picture ?? null,
        link: p.permalink_url ?? null,
        kind: p.attachments?.data?.[0]?.media_type ?? "status"
      }))
  };
}
async function handleAddPagePost(userClient, body) {
  const { account } = await getAccount(userClient, body.ad_account_id);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const raw = String(body.post_id ?? "").trim();
  // Accept "pageid_postid", a bare post id (page id is added), or a facebook.com post link.
  const { data: acc } = await admin.from("ad_accounts").select("fb_page_id").eq("id", account.id).maybeSingle();
  let postId = raw;
  const m = raw.match(/(?:posts|videos|photos)\/(?:pfbid[\w]+|\d+)/);
  if (/^\d+$/.test(raw) && acc?.fb_page_id) postId = `${acc.fb_page_id}_${raw}`;
  else if (!/^\d+_\d+$/.test(raw) && m) {
    const id = m[0].split("/")[1];
    if (/^\d+$/.test(id) && acc?.fb_page_id) postId = `${acc.fb_page_id}_${id}`;
  }
  if (!/^\d+_\d+$/.test(postId)) throw new HttpError(400, "Send the post id (like 1234567890_9876543210) or pick a post from page_posts.");
  const token = await resolveToken(admin, account);
  const { pageToken } = await pageTokenFor(admin, account, token);
  const post = await graphGet(postId, {
    fields: "id,message,full_picture,permalink_url,created_time"
  }, pageToken).catch((e)=>{
    throw new HttpError(400, `Meta could not read that post (${e.message}). It must be a public post on this ad account's Page.`);
  });
  const { data, error } = await admin.from("creative_assets").insert({
    company_id: account.company_id,
    ad_account_id: account.id,
    file_name: `Post ${postId}`,
    storage_path: `post/${postId}`,
    public_url: post.full_picture || post.permalink_url || "",
    asset_type: "post",
    meta_post_id: postId,
    primary_text: String(post.message ?? "").slice(0, 2000) || null,
    product_id: body.product_id || null,
    uploaded_by: "page_post",
    test_status: "untested",
    uploaded_at: new Date().toISOString()
  }).select("id").single();
  if (error) throw new HttpError(500, error.message);
  return {
    ok: true,
    creative_id: data.id,
    post_id: postId,
    preview: post.full_picture ?? null,
    text: String(post.message ?? "").slice(0, 300)
  };
}
async function readCarouselCards(admin, account, raw) {
  const cards = [];
  for (const k of raw){
    let url = String(k?.image_url ?? "");
    if (!url && k?.creative_id) {
      const { data: a } = await admin.from("creative_assets").select("public_url, asset_type").eq("id", k.creative_id).eq("company_id", account.company_id).maybeSingle();
      if (!a || a.asset_type !== "image") throw new HttpError(400, "Each card must be an uploaded image (creative_id of an image).");
      url = a.public_url;
    }
    if (!/^https:\/\//.test(url)) throw new HttpError(400, "Each card needs an image (image_url or creative_id).");
    cards.push({
      image_url: url,
      headline: String(k.headline ?? "").slice(0, 80),
      description: String(k.description ?? "").slice(0, 150),
      link: k.link ? String(k.link) : undefined
    });
  }
  return cards;
}
async function handleUpdateCarousel(userClient, body) {
  const { account } = await getAccount(userClient, body.ad_account_id);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: row } = await admin.from("creative_assets").select("id, asset_type").eq("id", body.creative_id).eq("company_id", account.company_id).maybeSingle();
  if (!row || row.asset_type !== "carousel") throw new HttpError(404, "That carousel was not found.");
  const patch = {};
  if (Array.isArray(body.cards)) {
    if (body.cards.length < 2 || body.cards.length > 10) throw new HttpError(400, "A carousel needs 2 to 10 cards.");
    const cards = await readCarouselCards(admin, account, body.cards);
    patch.carousel_cards = cards;
    patch.public_url = `${cards[0].image_url.split("#")[0]}#carousel-${row.id}`;
  }
  if (body.name != null) patch.file_name = String(body.name).slice(0, 120) || "Carousel";
  if (body.primary_text != null) patch.primary_text = String(body.primary_text).slice(0, 2000) || null;
  if (body.feed_only != null) patch.feed_only = !!body.feed_only;
  const { error } = await admin.from("creative_assets").update(patch).eq("id", row.id);
  if (error) throw new HttpError(500, error.message);
  return {
    ok: true
  };
}
async function handleAddCarousel(userClient, body) {
  const { account } = await getAccount(userClient, body.ad_account_id);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const raw = Array.isArray(body.cards) ? body.cards : [];
  if (raw.length < 2 || raw.length > 10) throw new HttpError(400, "A carousel needs 2 to 10 cards.");
  const cards = [];
  for (const k of raw){
    let url = String(k?.image_url ?? "");
    if (!url && k?.creative_id) {
      const { data: a } = await admin.from("creative_assets").select("public_url, asset_type").eq("id", k.creative_id).eq("company_id", account.company_id).maybeSingle();
      if (!a || a.asset_type !== "image") throw new HttpError(400, "Each card must be an uploaded image (creative_id of an image).");
      url = a.public_url;
    }
    if (!/^https:\/\//.test(url)) throw new HttpError(400, "Each card needs an image (image_url or creative_id).");
    cards.push({
      image_url: url,
      headline: String(k.headline ?? "").slice(0, 80),
      description: String(k.description ?? "").slice(0, 150),
      link: k.link ? String(k.link) : undefined
    });
  }
  const name = String(body.name ?? "").trim() || `Carousel (${cards.length} cards)`;
  const cid = crypto.randomUUID();
  // The fragment keeps this row's public_url unique, so deleting/renaming it can never touch the picture it borrows.
  const { data, error } = await admin.from("creative_assets").insert({
    company_id: account.company_id,
    ad_account_id: account.id,
    file_name: name,
    storage_path: `carousel/${cid}`,
    public_url: `${cards[0].image_url.split("#")[0]}#carousel-${cid}`,
    asset_type: "carousel",
    carousel_cards: cards,
    feed_only: body.feed_only !== false,
    primary_text: String(body.primary_text ?? "").slice(0, 2000) || null,
    product_id: body.product_id || null,
    uploaded_by: "carousel",
    test_status: "untested",
    uploaded_at: new Date().toISOString()
  }).select("id").single();
  if (error) throw new HttpError(500, error.message);
  return {
    ok: true,
    creative_id: data.id,
    cards: cards.length
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
// -- Low-balance guard (cron every 5 min) -------------------------------------------------------------------------------------------
// Prepaid account below its floor (default ₦50): switch OFF every ACTIVE campaign, its ad sets and its ads, and remember exactly which.
// Balance back to its resume line (default ₦1,000): switch ON only those, ads and ad sets first and the campaign last. Older campaigns
// that were already off are never touched. A balance that cannot be read (or a card account) never triggers anything.
async function guardSet(admin, id, level, status, token) {
  const res = await fetch(`${GRAPH}/${id}`, {
    method: "POST",
    body: new URLSearchParams({
      status,
      access_token: token
    })
  });
  const d = await res.json().catch(()=>({}));
  if (!res.ok || d.error || d.success === false) throw new Error(d?.error?.message || "Meta refused the change.");
  const table = level === "campaign" ? "campaigns" : level === "adset" ? "ad_sets" : null;
  if (table) await admin.from(table).update({
    status: status === "ACTIVE" ? "active" : "paused"
  }).eq(level === "campaign" ? "meta_campaign_id" : "meta_adset_id", id).then(()=>{}, ()=>{});
}
async function guardRun(admin, items, flag, status, order, token, deadline) {
  for (const level of order){
    const todo = items.filter((i)=>i.level === level && !i[flag]);
    for(let k = 0; k < todo.length; k += 5){
      if (Date.now() > deadline) return false;
      await Promise.allSettled(todo.slice(k, k + 5).map(async (i)=>{
        try {
          await guardSet(admin, i.id, level, status, token);
          i[flag] = true;
          delete i.e;
        } catch (e) {
          i.e = String(e.message ?? e).slice(0, 120);
        }
      }));
    }
  }
  return items.every((i)=>i[flag]);
}
// -- When do purchases (and spend) happen? Meta's hour-of-day breakdown, for every account of a company -----------------------------------
// Hours are in each ad account's own time zone, as Meta reports them (the hour the ad was seen/clicked, not the hour the person ordered).
const emptyHours = ()=>Array.from({ length: 24 }, ()=>({ spend: 0, purchases: 0 }));
async function hourlyForAccount(admin, a, since, until) {
  const actId = String(a.meta_ad_account_id ?? "").replace(/^act_/, "");
  const token = await resolveToken(admin, a);
  const info = await graphGet(`act_${actId}`, { fields: "timezone_name" }, token).catch(()=>({}));
  const rows = await graphGetAll(`act_${actId}/insights`, {
    level: "campaign",
    fields: "campaign_id,campaign_name,spend,actions",
    breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone",
    time_range: JSON.stringify({ since, until }),
    limit: "500"
  }, token, 12);
  const pur = (acts)=>{ for (const t of PURCHASE_ACTIONS){ const x = (acts ?? []).find((q)=>q.action_type === t); if (x) return Number(x.value) || 0; } return 0; };
  const hours = emptyHours(), camps = new Map();
  for (const r of rows){
    const h = Number(String(r.hourly_stats_aggregated_by_advertiser_time_zone ?? "").slice(0, 2));
    if (!(h >= 0 && h < 24)) continue;
    const sp = Number(r.spend) || 0, pc = pur(r.actions);
    hours[h].spend += sp; hours[h].purchases += pc;
    const c = camps.get(r.campaign_id) ?? { campaign: r.campaign_name, spend: 0, purchases: 0, hours: emptyHours() };
    c.spend += sp; c.purchases += pc; c.hours[h].spend += sp; c.hours[h].purchases += pc;
    camps.set(r.campaign_id, c);
  }
  return { hours, camps: [...camps.values()], tz: info.timezone_name ?? null, rows: rows.length };
}
const sumHours = (list)=>{ const h = emptyHours(); for (const x of list) x.forEach((v, i)=>{ h[i].spend += v.spend; h[i].purchases += v.purchases; }); return h; };
const hFmt = (x)=>({ spend: Math.round(x.spend * 100) / 100, purchases: x.purchases, cpa: x.purchases ? Math.round(x.spend / x.purchases * 100) / 100 : null });
const windowsOf = (hours)=>Array.from({ length: 8 }, (_, i)=>{ const part = hours.slice(i * 3, i * 3 + 3).reduce((t, x)=>({ spend: t.spend + x.spend, purchases: t.purchases + x.purchases }), { spend: 0, purchases: 0 }); return { from: i * 3, label: `${String(i * 3).padStart(2, "0")}:00-${String(i * 3 + 3).padStart(2, "0")}:00`, ...hFmt(part) }; });
async function handleHourlyReport(companyId, days = 30) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: accts } = await admin.from("ad_accounts").select("id, name, nickname, meta_ad_account_id, meta_connection_id, company_id, media_buyer_id").eq("company_id", companyId).eq("status", "active");
  const until = new Date().toISOString().slice(0, 10), since = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
  const all = [], camps = [], notes = [];
  for (const a of accts ?? []){
    if (!/^\d+$/.test(String(a.meta_ad_account_id ?? "").replace(/^act_/, ""))) continue;
    const label = a.nickname || a.name || a.id;
    try {
      const r = await hourlyForAccount(admin, a, since, until);
      all.push(r.hours); r.camps.forEach((c)=>camps.push({ account: label, ...c }));
      notes.push(`${label}: ${r.rows} rows, ${r.tz ?? "time zone ?"}`);
    } catch (e) { notes.push(`${label}: ${String(e.message ?? e).slice(0, 140)}`); }
  }
  const hours = sumHours(all);
  return {
    ok: true, days, since, until, notes,
    total: hFmt(hours.reduce((t, x)=>({ spend: t.spend + x.spend, purchases: t.purchases + x.purchases }), { spend: 0, purchases: 0 })),
    by_hour: hours.map((x, h)=>({ hour: h, ...hFmt(x) })),
    by_window: windowsOf(hours),
    campaigns_with_purchases: camps.filter((c)=>c.purchases > 0).sort((x, y)=>y.purchases - x.purchases).map((c)=>({ account: c.account, campaign: c.campaign, ...hFmt(c), purchase_hours: c.hours.map((x, h)=>x.purchases ? `${h}h:${x.purchases}` : null).filter(Boolean).join(" ") }))
  };
}
// -- 3x a week (cron): tell each person, in plain words, when their purchases land and what to do about it --------------------------------
const hr12 = (h)=>{ const x = ((h % 24) + 24) % 24; return x === 0 ? "12 AM" : x < 12 ? `${x} AM` : x === 12 ? "12 PM" : `${x - 12} PM`; };
const winText = (w)=>`${hr12(w.from)} to ${hr12(w.from + 3)}`;
function explainTiming(hours, days, realTimes) {
  const tot = hours.reduce((t, x)=>({ spend: t.spend + x.spend, purchases: t.purchases + x.purchases }), { spend: 0, purchases: 0 });
  const wins = windowsOf(hours), avg = tot.purchases ? tot.spend / tot.purchases : null;
  const lines = [];
  if (tot.purchases < 8) {
    lines.push(`Only ${tot.purchases} purchase${tot.purchases === 1 ? "" : "s"} in ${days} days, which is too few to see a time-of-day pattern. Revora is keeping track and will say more as results build up.`);
    const where = wins.filter((w)=>w.purchases > 0).map((w)=>`${winText(w)} (${w.purchases})`).join(", ");
    if (where) lines.push(`So far they came in these windows: ${where}.`);
    return { title: "🕒 Purchase timing: too early to tell", lines, enough: false, tot };
  }
  const best = wins.filter((w)=>w.purchases >= 2 && w.cpa).sort((x, y)=>x.cpa - y.cpa)[0];
  const costly = wins.filter((w)=>tot.spend > 0 && w.spend / tot.spend >= 0.15 && w.purchases / tot.purchases <= (w.spend / tot.spend) / 2).sort((x, y)=>y.spend - x.spend)[0];
  lines.push(`Last ${days} days: ₦${Math.round(tot.spend).toLocaleString("en-NG")} spent, ${tot.purchases} purchases, about ₦${Math.round(avg).toLocaleString("en-NG")} each.`);
  if (best) lines.push(`Best time: ${winText(best)}. ${best.purchases} purchases at ₦${Math.round(best.cpa).toLocaleString("en-NG")} each${avg && best.cpa < avg * 0.7 ? `, ${(avg / best.cpa).toFixed(1)}x cheaper than your average` : ""}.`);
  if (costly) lines.push(`Costly time: ${winText(costly)}. ₦${Math.round(costly.spend).toLocaleString("en-NG")} spent (${Math.round(costly.spend / tot.spend * 100)}% of your money) for ${costly.purchases} purchase${costly.purchases === 1 ? "" : "s"}.`);
  if (realTimes && realTimes.n >= 3) lines.push(`Revora saw ${realTimes.n} purchases arrive in real time. Most came ${realTimes.top}.`);
  const act = [];
  if (best && avg && best.cpa < avg * 0.7) act.push(`Have your ads fully delivering before ${hr12(best.from)}: start new campaigns about 3 hours earlier, and scale the ad sets that already win then.`);
  if (costly) act.push(tot.purchases >= 30 ? `Watch the ad sets that spend most during ${winText(costly)}; if they keep losing there, ask Revora to switch ads off at those hours.` : `Do not cut ${winText(costly)} yet. ${tot.purchases} purchases is still a small sample.`);
  if (!act.length) act.push("Spend is spread evenly with no clear winner or loser time. Keep running as you are.");
  lines.push("What to do: " + act.join(" "));
  lines.push("Note: Meta credits a purchase to the hour the ad was seen, not the hour the person ordered.");
  return { title: best ? `🕒 Your best time to sell is ${winText(best)}` : "🕒 Purchase timing report", lines, enough: true, tot, best, costly };
}
async function handlePurchaseTimingDigest(dryRun = false) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const days = 30, until = new Date().toISOString().slice(0, 10), since = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
  const stamp = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
  const { data: accts } = await admin.from("ad_accounts").select("id, name, nickname, meta_ad_account_id, meta_connection_id, company_id, media_buyer_id, billing_mode").eq("status", "active");
  const byCo = new Map();
  for (const a of accts ?? []) if (/^\d+$/.test(String(a.meta_ad_account_id ?? "").replace(/^act_/, ""))) byCo.set(a.company_id, [...(byCo.get(a.company_id) ?? []), a]);
  const out = [], deadline = Date.now() + 110_000;
  for (const [companyId, list] of byCo){
    if (Date.now() > deadline) { out.push({ note: "time budget reached, rest next run" }); break; }
    const per = new Map();
    for (const a of list){
      try { per.set(a.id, await hourlyForAccount(admin, a, since, until)); } catch (_) { /* skip an account Meta will not read */ }
    }
    const scopes = [{ key: `co:${companyId}`, buyer: null, accounts: list }];
    for (const b of new Set(list.map((a)=>a.media_buyer_id).filter(Boolean))) scopes.push({ key: `mb:${b}`, buyer: b, accounts: list.filter((a)=>a.media_buyer_id === b) });
    for (const sc of scopes){
      const parts = sc.accounts.map((a)=>per.get(a.id)).filter(Boolean);
      if (!parts.length) continue;
      const hours = sumHours(parts.map((p)=>p.hours));
      if (!hours.some((h)=>h.purchases > 0 || h.spend > 0)) continue;
      // The real arrival times Revora has recorded (since the purchase log began).
      const { data: ev } = await admin.from("meta_purchase_events").select("seen_at, added").in("ad_account_id", sc.accounts.map((a)=>a.id)).gte("seen_at", new Date(Date.now() - days * 86400_000).toISOString());
      let real = null;
      if ((ev ?? []).length) {
        const b = emptyHours();
        for (const e of ev) b[new Date(new Date(e.seen_at).getTime() + 3600_000).getUTCHours()].purchases += e.added;
        const w = windowsOf(b).sort((x, y)=>y.purchases - x.purchases)[0];
        real = { n: b.reduce((t, x)=>t + x.purchases, 0), top: `between ${winText(w)}` };
      }
      const ex = explainTiming(hours, days, real);
      if (dryRun) { out.push({ scope: sc.key, title: ex.title, lines: ex.lines }); continue; }
      await admin.from("purchase_timing_reports").insert({ company_id: companyId, media_buyer_id: sc.buyer, period_days: days, report: { hours, ...ex, real } });
      if (sc.buyer === null) {
        // Company-wide: owners/admins hear it only when they have more than one buyer, so a single buyer is not told twice.
        const buyers = new Set(list.map((a)=>a.media_buyer_id).filter(Boolean));
        if (buyers.size === 1 && list.every((a)=>a.media_buyer_id)) continue;
      }
      await notifyRpc(admin, { p_company: companyId, p_category: "insights", p_kind: "purchase_timing", p_title: ex.title, p_body: ex.lines.join("\n"), p_severity: "info", p_data: { scope: sc.key, enough: ex.enough }, p_dedupe: `timing:${sc.key}:${stamp}`, p_buyer: sc.buyer });
      out.push({ scope: sc.key, sent: true });
    }
  }
  return { ok: true, dry_run: dryRun, results: out };
}
// ======================= LEARNER: reads connected ad accounts and the pages ads link to (read-only, background) =======================
// learn_sync: every few minutes (cron) takes the accounts studied longest ago and stores their campaigns, ad sets, ads (with every setting and a plain
// summary of the creative) plus results and breakdowns. learn_pages: fetches the public landing pages those ads send people to, word for word.
// Nothing here changes an ad account. Companies with companies.learning_enabled = false are skipped.
const LEARN_SKIP_HOSTS = /(^|\.)(facebook\.com|fb\.com|fb\.me|m\.me|messenger\.com|instagram\.com|wa\.me|whatsapp\.com|l\.facebook\.com|google\.com|youtube\.com|youtu\.be|tiktok\.com|t\.me)$/i;
function normUrl(u) {
  try {
    const x = new URL(String(u).trim());
    if (!/^https?:$/.test(x.protocol) || LEARN_SKIP_HOSTS.test(x.hostname)) return null;
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ttclid|fb_|ref$)/i.test(k)) x.searchParams.delete(k);
    x.hash = "";
    let out = x.origin.toLowerCase() + x.pathname.replace(/\/+$/, "") + (x.search || "");
    return out.length < 600 ? out : null;
  } catch (_) { return null; }
}
function summarizeCreative(cr) {
  if (!cr) return null;
  const oss = cr.object_story_spec ?? {}, ld = oss.link_data, vd = oss.video_data, afs = cr.asset_feed_spec;
  const links = new Set(), push = (u)=>{ if (u) links.add(u); };
  let kind = "unknown", cards = null;
  if (ld?.child_attachments?.length) {
    kind = "carousel";
    cards = ld.child_attachments.map((c)=>{ push(c.link); return { headline: c.name ?? null, description: c.description ?? null, link: c.link ?? null, video: !!c.video_id, cta: c.call_to_action?.type ?? null }; });
  } else if (cr.object_story_id && !ld && !vd && !afs) kind = "post";
  else if (vd) kind = "video";
  else if (ld) kind = "image";
  else if (afs) kind = afs.videos?.length ? "video_feed" : "image_feed";
  push(ld?.link); push(ld?.call_to_action?.value?.link); push(vd?.call_to_action?.value?.link);
  for (const l of afs?.link_urls ?? []) push(l.website_url);
  const flags = Object.entries(cr.degrees_of_freedom_spec?.creative_features_spec ?? {}).filter(([, v])=>v?.enroll_status === "OPT_IN").map(([k])=>k);
  return {
    kind, cards,
    primary_text: ld?.message ?? vd?.message ?? afs?.bodies?.[0]?.text ?? null,
    headline: ld?.name ?? vd?.title ?? afs?.titles?.[0]?.text ?? null,
    description: ld?.description ?? vd?.link_description ?? afs?.descriptions?.[0]?.text ?? null,
    cta: ld?.call_to_action?.type ?? vd?.call_to_action?.type ?? cr.call_to_action_type ?? afs?.call_to_action_types?.[0] ?? null,
    message_destination: ld?.call_to_action?.value?.app_destination ?? vd?.call_to_action?.value?.app_destination ?? null,
    video_ids: [vd?.video_id, ...(afs?.videos ?? []).map((v)=>v.video_id)].filter(Boolean),
    image_hash: ld?.image_hash ?? null, post_id: cr.effective_object_story_id ?? cr.object_story_id ?? null,
    placement_customized: !!afs?.asset_customization_rules?.length, advantage_features: flags, url_tags: cr.url_tags ?? null, links: [...links]
  };
}
const learnNum = (n)=>Number(n) || 0;
function learnRow(r) {
  const val = (list, types)=>{ for (const t of types){ const x = (list ?? []).find((a)=>a.action_type === t); if (x) return Number(x.value) || 0; } return 0; };
  return {
    spend: learnNum(r.spend), impressions: learnNum(r.impressions), reach: learnNum(r.reach), clicks: learnNum(r.clicks), link_clicks: learnNum(r.inline_link_clicks),
    lpv: val(r.actions, LPV_ACTIONS), purchases: val(r.actions, PURCHASE_ACTIONS), purchase_value: val(r.action_values, PURCHASE_ACTIONS), messages: val(r.actions, [MSG_ACTION]),
    extra: { video_3s: val(r.actions, ["video_view"]), thruplay: val(r.video_thruplay_watched_actions, ["video_view"]), video_p100: val(r.video_p100_watched_actions, ["video_view"]), frequency: learnNum(r.frequency), add_to_cart: val(r.actions, ["add_to_cart", "omni_add_to_cart"]), checkout: val(r.actions, ["initiate_checkout", "omni_initiated_checkout"]) }
  };
}
const ymd = (d)=>d.toISOString().slice(0, 10);
const FLDS = "spend,impressions,reach,clicks,inline_link_clicks,frequency,actions,action_values,video_thruplay_watched_actions,video_p100_watched_actions";
async function learnDaily(admin, a, actId, token, first, deadline, cur) {
  const base = { ad_account_id: a.id, company_id: a.company_id };
  const save = async (level, rs)=>{
    const rows = rs.filter((r)=>r[level + "_id"] && r.date_start).map((r)=>({ ...base, level, object_id: r[level === "adset" ? "adset_id" : "campaign_id"], day: r.date_start, ...learnRow(r), synced_at: new Date().toISOString() }));
    for(let i = 0; i < rows.length; i += 300) await admin.from("learn_daily").upsert(rows.slice(i, i + 300), { onConflict: "ad_account_id,level,object_id,day" });
    return rows.length;
  };
  const win = async (since, until)=>{
    let n = 0;
    for (const lv of ["campaign", "adset"]){
      const rs = await graphGetAll(`act_${actId}/insights`, { level: lv, fields: `${lv}_id,` + FLDS, time_increment: "1", time_range: JSON.stringify({ since, until }) }, token, 30).catch(()=>[]);
      n += await save(lv, rs);
    }
    return n;
  };
  if (!first) { await win(ymd(new Date(Date.now() - 4 * 86400_000)), ymd(new Date())); return true; }
  // First read: walk back in 30-day windows to the oldest day Meta still keeps (about 37 months). Progress is saved after every window,
  // so a long history is finished over several runs and nothing is ever read twice.
  const limit = new Date(Date.now() - 36 * 30.4 * 86400_000);
  let end = cur.daily_to ? new Date(cur.daily_to) : new Date();
  while (end > limit){
    if (Date.now() > deadline) return false;
    const start = new Date(end.getTime() - 29 * 86400_000);
    await win(ymd(start < limit ? limit : start), ymd(end));
    end = new Date(start.getTime() - 86400_000);
    cur.daily_to = ymd(end);
    await admin.from("ad_accounts").update({ learn_cursor: cur }).eq("id", a.id);
  }
  return true;
}
async function learnBreakdowns(admin, a, actId, token, preset, winLabel, deadline) {
  const ins = [];
  const put = (level, id, breakdown, bucket, r)=>ins.push({ ad_account_id: a.id, company_id: a.company_id, level, object_id: id, breakdown, bucket: String(bucket).slice(0, 80), win: winLabel, ...learnRow(r), synced_at: new Date().toISOString() });
  const adTotals = await graphGetAll(`act_${actId}/insights`, { level: "ad", fields: "ad_id," + FLDS, date_preset: preset }, token, 40).catch(()=>[]);
  for (const r of adTotals) put("ad", r.ad_id, "total", "all", r);
  const BR = [
    ["hour", "hourly_stats_aggregated_by_advertiser_time_zone", (r)=>String(r.hourly_stats_aggregated_by_advertiser_time_zone ?? "").slice(0, 2)],
    ["age_gender", "age,gender", (r)=>`${r.age}|${r.gender}`],
    ["country", "country", (r)=>r.country],
    ["region", "region", (r)=>r.region],
    ["placement", "publisher_platform,platform_position", (r)=>`${r.publisher_platform}|${r.platform_position}`],
    ["device", "device_platform", (r)=>r.device_platform]
  ];
  let all = true;
  for (const [name, brk, bucket] of BR){
    if (Date.now() > deadline) { all = false; break; }
    const rs = await graphGetAll(`act_${actId}/insights`, { level: "campaign", fields: "campaign_id," + FLDS, breakdowns: brk, date_preset: preset }, token, 40).catch(()=>[]);
    for (const r of rs) if (bucket(r)) put("campaign", r.campaign_id, name, bucket(r), r);
  }
  for(let i = 0; i < ins.length; i += 300) await admin.from("learn_insights").upsert(ins.slice(i, i + 300), { onConflict: "ad_account_id,level,object_id,breakdown,bucket,win" });
  return all;
}
// Meta's Activity History: budget changes, pauses, duplications, edits. Read from the start the first time, then only what is new.
const hash32 = (t)=>{ let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
async function learnActivity(admin, a, actId, token, first, cur, deadline) {
  const since = first ? 0 : Math.max(0, Number(cur.activity_since) || 0);
  const rows = await graphGetAll(`act_${actId}/activities`, { fields: "event_time,event_type,translated_event_type,object_id,object_name,object_type,actor_name,extra_data", since: String(since), limit: "500" }, token, 60).catch(()=>[]);
  const j = (x)=>{ try { return typeof x === "string" ? JSON.parse(x) : x ?? null; } catch (_) { return { text: String(x).slice(0, 300) }; } };
  const ev = rows.map((r)=>{ const ex = j(r.extra_data); return { ad_account_id: a.id, company_id: a.company_id, event_key: `${r.event_time}|${r.event_type}|${r.object_id}|${hash32(JSON.stringify(ex ?? ""))}`, event_time: r.event_time, event_type: r.event_type, translated: r.translated_event_type ?? null, object_id: r.object_id ?? null, object_type: r.object_type ?? null, object_name: r.object_name ?? null, actor: r.actor_name ?? null, old_value: ex?.old_value ?? ex?.old ?? null, new_value: ex?.new_value ?? ex?.new ?? null, raw: ex }; });
  for(let i = 0; i < ev.length; i += 300) await admin.from("learn_events").upsert(ev.slice(i, i + 300), { onConflict: "ad_account_id,event_key" });
  cur.activity_since = Math.floor(Date.now() / 1000) - 86400;
  return ev.length;
}
async function learnAccount(admin, a, deadline) {
  const actId = String(a.meta_ad_account_id).replace(/^act_/, "");
  const token = await resolveToken(admin, a);
  const first = !a.learn_backfill_done_at;
  const cur = (a.learn_cursor && typeof a.learn_cursor === "object") ? { ...a.learn_cursor } : {};
  const base = { ad_account_id: a.id, company_id: a.company_id, synced_at: new Date().toISOString() };
  const out = { mode: first ? "first full read" : "update" };
  // 1) Structure: everything on the first read, then only what changed since the last visit.
  if (!first || !cur.structure_done) {
    const since = first ? null : Math.floor(Math.max(0, new Date(a.learn_synced_at ?? 0).getTime() - 86400_000) / 1000);
    const p = since != null ? { filtering: JSON.stringify([{ field: "updated_time", operator: "GREATER_THAN", value: since }]) } : {};
    const [camps, sets, ads] = await Promise.all([
      graphGetAll(`act_${actId}/campaigns`, { fields: "id,name,objective,status,effective_status,buying_type,special_ad_categories,daily_budget,lifetime_budget,bid_strategy,spend_cap,start_time,stop_time,created_time,updated_time,smart_promotion_type", ...p }, token, 60),
      graphGetAll(`act_${actId}/adsets`, { fields: "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_strategy,bid_amount,targeting,promoted_object,destination_type,attribution_spec,start_time,end_time,created_time,updated_time,pacing_type,is_dynamic_creative", ...p }, token, 60),
      graphGetAll(`act_${actId}/ads`, { fields: "id,name,adset_id,campaign_id,status,effective_status,created_time,updated_time,creative{id,object_story_spec,object_story_id,effective_object_story_id,asset_feed_spec,degrees_of_freedom_spec,call_to_action_type,url_tags}", ...p }, token, 80)
    ]);
    const rows = [], urls = new Set();
    for (const c of camps) rows.push({ ...base, level: "campaign", meta_id: c.id, parent_id: null, campaign_id: c.id, name: c.name, status: c.status, effective_status: c.effective_status, created_time: c.created_time ?? null, settings: c, creative: null, landing_url: null });
    for (const x of sets) rows.push({ ...base, level: "adset", meta_id: x.id, parent_id: x.campaign_id, campaign_id: x.campaign_id, name: x.name, status: x.status, effective_status: x.effective_status, created_time: x.created_time ?? null, settings: x, creative: null, landing_url: null });
    for (const x of ads){
      const sm = summarizeCreative(x.creative);
      for (const l of sm?.links ?? []){ const n = normUrl(l); if (n) urls.add(n); }
      const { creative, ...rest } = x;
      rows.push({ ...base, level: "ad", meta_id: x.id, parent_id: x.adset_id, campaign_id: x.campaign_id, name: x.name, status: x.status, effective_status: x.effective_status, created_time: x.created_time ?? null, settings: rest, creative: sm, landing_url: (sm?.links ?? []).map(normUrl).find(Boolean) ?? null });
    }
    for(let i = 0; i < rows.length; i += 200) await admin.from("learn_objects").upsert(rows.slice(i, i + 200), { onConflict: "ad_account_id,level,meta_id" });
    for (const u of urls){
      const { data: ex } = await admin.from("learn_pages").select("url_norm, company_ids").eq("url_norm", u).maybeSingle();
      if (!ex) await admin.from("learn_pages").insert({ url_norm: u, company_ids: [a.company_id] });
      else if (!(ex.company_ids ?? []).includes(a.company_id)) await admin.from("learn_pages").update({ company_ids: [...ex.company_ids, a.company_id] }).eq("url_norm", u);
    }
    cur.structure_done = true; out.objects = rows.length; out.pages = urls.size;
  }
  // 2) Daily history (whole history the first time; the last few days afterwards).
  const dailyDone = await learnDaily(admin, a, actId, token, first, deadline, cur);
  // 3) Totals and breakdowns: lifetime the first time, then refreshed weekly over the last 30 days.
  let bkDone = true;
  const bkAge = a.learn_breakdowns_at ? Date.now() - new Date(a.learn_breakdowns_at).getTime() : Infinity;
  if (first ? (dailyDone && !cur.bk_done) : bkAge > 7 * 86400_000) {
    bkDone = await learnBreakdowns(admin, a, actId, token, first ? "maximum" : "last_30d", first ? "all" : "30d", deadline);
    if (bkDone) { cur.bk_done = true; await admin.from("ad_accounts").update({ learn_breakdowns_at: new Date().toISOString() }).eq("id", a.id); }
  } else if (first) bkDone = !!cur.bk_done;
  // 4) Activity History (scaling, pauses, duplicates, edits).
  if (!first || (dailyDone && bkDone && !cur.act_done)) { out.events = await learnActivity(admin, a, actId, token, first, cur, deadline); if (first) cur.act_done = true; }
  const finished = !first || (dailyDone && bkDone && cur.act_done);
  await admin.from("ad_accounts").update({ learn_synced_at: new Date().toISOString(), learn_cursor: cur, ...(first && finished ? { learn_backfill_done_at: new Date().toISOString() } : {}) }).eq("id", a.id);
  out.full_read_complete = first ? finished : true;
  return out;
}
async function handleLearnSync(maxAccounts = 2, onlyAccountId = "") {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const deadline = Date.now() + 70_000;
  const { data: cos } = await admin.from("companies").select("id").eq("learning_enabled", false);
  const off = new Set((cos ?? []).map((c)=>c.id));
  const { data: accts } = await admin.from("ad_accounts").select("id, name, nickname, meta_ad_account_id, meta_connection_id, company_id, billing_mode, learn_synced_at, learn_backfill_done_at, learn_cursor, learn_breakdowns_at").eq("status", "active").order("learn_synced_at", { ascending: true, nullsFirst: true }).order("learn_backfill_done_at", { ascending: true, nullsFirst: true }).limit(40);
  const out = [];
  for (const a of (accts ?? []).filter((x)=>(!onlyAccountId || x.id === onlyAccountId) && (onlyAccountId || !x.learn_backfill_done_at || !x.learn_synced_at || Date.now() - new Date(x.learn_synced_at).getTime() > 22 * 3600_000) && !off.has(x.company_id) && /^\d+$/.test(String(x.meta_ad_account_id ?? "").replace(/^act_/, ""))).slice(0, maxAccounts)){
    if (Date.now() > deadline) break;
    try { out.push({ account: a.nickname || a.name, ...await learnAccount(admin, a, deadline) }); } catch (e) { await admin.from("ad_accounts").update({ learn_synced_at: new Date().toISOString() }).eq("id", a.id); out.push({ account: a.nickname || a.name, error: String(e.message ?? e).slice(0, 160) }); }
  }
  return { ok: true, accounts: out };
}
// ---- landing pages -------------------------------------------------------------------------------------------------------------------------
const decodeEnt = (t)=>String(t).replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n)=>{ try { return String.fromCodePoint(Number(n)); } catch (_) { return ""; } }).replace(/&#x([0-9a-f]+);/gi, (_, n)=>{ try { return String.fromCodePoint(parseInt(n, 16)); } catch (_) { return ""; } });
const BLOCK_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "td", "th", "div", "section", "article", "header", "footer", "main", "nav", "ul", "ol", "table", "tr", "form", "blockquote", "figcaption", "summary", "dt", "dd", "aside", "button", "label", "br", "hr", "select", "option"]);
const KEEP_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "td", "th", "blockquote", "figcaption", "summary", "dt", "dd", "button", "label", "div", "section", "span", "a", "option"]);
function parsePage(html, base) {
  const headBlock = html.match(/<head\b[\s\S]*?<\/head>/i)?.[0] ?? "";
  const bodyOnly = html.replace(/<head\b[\s\S]*?<\/head>/i, " ");
  let h = bodyOnly.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, (m, t)=>t.toLowerCase() === "script" && /fbq\(|fbevents\.js/.test(m) ? " <meta data-pixel> " : " ");
  const title = decodeEnt((headBlock.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim()).slice(0, 200);
  const desc = decodeEnt(html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1] ?? "").slice(0, 400);
  const blocks = [], ctas = [], fields = [], imgs = [];
  let cur = null, footer = 0, depthFooter = 0, formCount = 0, videoCount = 0;
  const flush = ()=>{ if (cur) { const x = decodeEnt(cur.x).replace(/\s+/g, " ").replace(/ ([.,!?;:%)\]])/g, "$1").replace(/([(\[]) /g, "$1").trim(); if (x.length > 1 && x !== blocks[blocks.length - 1]?.x) blocks.push({ t: cur.t, x: x.slice(0, 1500), f: footer ? 1 : 0 }); cur = null; } };
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  let m, openA = null, openBtn = null, stack = [];
  while ((m = re.exec(h))) {
    if (m[4] !== undefined) { const t = m[4]; if (!t.trim()) continue; if (!cur) cur = { t: stack.find((x)=>/^h[1-6]$/.test(x)) ?? stack[stack.length - 1] ?? "text", x: "" }; cur.x += " " + t; if (openA) openA.x += " " + t; if (openBtn) openBtn.x += " " + t; continue; }
    const close = m[1] === "/", tag = m[2].toLowerCase(), attrs = m[3] ?? "";
    if (tag === "footer") { flush(); if (!close) { footer++; depthFooter++; } else if (depthFooter > 0) { depthFooter--; if (!depthFooter) footer = 0; } continue; }
    if (!close) {
      if (tag === "img") { const alt = decodeEnt(attrs.match(/alt=["']([^"']*)["']/i)?.[1] ?? "").trim(); imgs.push(alt); continue; }
      if (tag === "video" || (tag === "iframe" && /youtube|vimeo|wistia|loom/i.test(attrs))) videoCount++;
      if (tag === "form") formCount++;
      if (tag === "input" || tag === "textarea" || tag === "select") { const ph = decodeEnt(attrs.match(/placeholder=["']([^"']*)["']/i)?.[1] ?? attrs.match(/name=["']([^"']*)["']/i)?.[1] ?? "").trim(); const ty = attrs.match(/type=["']([^"']*)["']/i)?.[1] ?? tag; if (ty !== "hidden" && ty !== "submit") fields.push(`${ty}:${ph}`.slice(0, 80)); if (ty === "submit") { const v = decodeEnt(attrs.match(/value=["']([^"']*)["']/i)?.[1] ?? "").trim(); if (v) ctas.push(v); } continue; }
      if (tag === "a") { if (stack.some((x)=>x === "nav" || x === "header" || x === "footer" || x === "li") || footer) flush(); openA = { x: "", href: attrs.match(/href=["']([^"']*)["']/i)?.[1] ?? "" }; }
      if (tag === "button") openBtn = { x: "" };
      if (BLOCK_TAGS.has(tag)) flush();
      if (tag !== "br" && tag !== "hr") stack.push(tag);
      if (BLOCK_TAGS.has(tag) || KEEP_TAGS.has(tag)) { if (!cur && BLOCK_TAGS.has(tag)) cur = null; }
    } else {
      if (tag === "a" && openA) { if (stack.some((x)=>x === "nav" || x === "header" || x === "footer" || x === "li") || footer) flush(); const x = decodeEnt(openA.x).replace(/\s+/g, " ").trim(); if (x && x.length < 80 && /btn|button|order|buy|shop|get|call|whatsapp|checkout/i.test(attrs + x + openA.href)) ctas.push(x); openA = null; }
      if (tag === "button" && openBtn) { const x = decodeEnt(openBtn.x).replace(/\s+/g, " ").trim(); if (x) ctas.push(x.slice(0, 80)); openBtn = null; }
      if (BLOCK_TAGS.has(tag)) flush();
      const i = stack.lastIndexOf(tag); if (i >= 0) stack.length = i;
    }
  }
  flush();
  const text = blocks.map((b)=>b.x).join("\n");
  const words = text.split(/\s+/).filter(Boolean).length;
  const money = [...new Set((text.match(/(?:₦\s?\d[\d,]*(?:\.\d+)?|\b(?:NGN|N)\s?\d{1,3}(?:,\d{3})+|\b(?:NGN|N)\s?\d{4,}|\b(?:KSh|KES|GHS|GH₵)\s?\d[\d,]*|[$€£]\s?\d[\d,]*(?:\.\d+)?)/g) ?? []).map((x)=>x.replace(/[\s,]+$/, "").replace(/\s+/g, "")))].slice(0, 25);
  const low = text.toLowerCase();
  const signals = {
    headings: blocks.filter((b)=>/^h[1-6]$/.test(b.t)).map((b)=>`${b.t}: ${b.x}`).slice(0, 80),
    prices: money, ctas: [...new Set(ctas)].slice(0, 30), form_fields: fields.slice(0, 30), forms: formCount, images: imgs.length, images_with_alt: imgs.filter(Boolean).length, videos: videoCount,
    pay_on_delivery: /pay on delivery|cash on delivery|\bcod\b|pay when|pay after/.test(low), guarantee: /money.?back|guarantee|refund/.test(low),
    urgency: /limited|hurry|only \d+ (left|remaining)|today only|before (it|stock)|running out|countdown|last chance|selling fast/.test(low),
    testimonials: /testimon|what (our )?customers say|reviews?|verified (buyer|purchase)|before and after|before & after/.test(low),
    free_delivery: /free (delivery|shipping)/.test(low), nafdac: /nafdac/.test(low), whatsapp: /whatsapp|wa\.me/.test(h.toLowerCase()), meta_pixel: /data-pixel|fbq\(|fbevents\.js/i.test(html),
    footer_blocks: blocks.filter((b)=>b.f).length
  };
  return { title, desc, blocks: blocks.slice(0, 1500), text: text.slice(0, 120_000), words, signals, spa: words < 60 && /id=["'](root|app|__next)["']|__NEXT_DATA__|ng-version|data-reactroot/i.test(html) };
}
function safeFetchUrl(u) {
  const x = new URL(u);
  if (!/^https?:$/.test(x.protocol)) throw new Error("only http(s)");
  const host = x.hostname;
  if (/^(localhost|0\.0\.0\.0|\[?::1\]?)$/i.test(host) || /\.(local|internal|localhost)$/i.test(host)) throw new Error("blocked host");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) { const [p, q] = host.split(".").map(Number); if (p === 10 || p === 127 || p === 0 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168)) throw new Error("blocked ip"); }
  if (/^\[/.test(host) || host.includes(":")) throw new Error("blocked ipv6");
  return x;
}
async function handleLearnPages(limit = 8) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: cos } = await admin.from("companies").select("id").eq("learning_enabled", false);
  const off = new Set((cos ?? []).map((c)=>c.id));
  const { data: due } = await admin.from("learn_pages").select("url_norm, company_ids, attempts").lte("next_fetch_at", new Date().toISOString()).order("next_fetch_at", { ascending: true }).limit(limit * 3);
  const out = [], deadline = Date.now() + 100_000;
  for (const pg of (due ?? []).filter((d)=>(d.company_ids ?? []).some((c)=>!off.has(c))).slice(0, limit)){
    if (Date.now() > deadline) break;
    const upd = { fetched_at: new Date().toISOString(), attempts: pg.attempts + 1 };
    try {
      const u = safeFetchUrl(pg.url_norm);
      const ctl = new AbortController(), to = setTimeout(()=>ctl.abort(), 12_000);
      const res = await fetch(u.toString(), { redirect: "follow", signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; RevoraLearner/1.0; +https://revoracrm.online)", Accept: "text/html,application/xhtml+xml" } }).finally(()=>clearTimeout(to));
      const fin = safeFetchUrl(res.url || u.toString());
      const ct = res.headers.get("content-type") ?? "";
      const reader = res.body?.getReader(); let html = "", bytes = 0; const dec = new TextDecoder();
      while (reader) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; html += dec.decode(value, { stream: true }); if (bytes > 1_500_000) { await reader.cancel(); break; } }
      if (!res.ok) { await admin.from("learn_pages").update({ ...upd, status: "error", http_status: res.status, final_url: fin.toString(), error: `HTTP ${res.status}`, next_fetch_at: new Date(Date.now() + (pg.attempts >= 3 ? 14 : 1) * 86400_000).toISOString() }).eq("url_norm", pg.url_norm); out.push({ url: pg.url_norm, error: `HTTP ${res.status}` }); continue; }
      if (!/html|xml|text/i.test(ct)) { await admin.from("learn_pages").update({ ...upd, status: "skipped", http_status: res.status, error: `not a web page (${ct.slice(0, 40)})`, next_fetch_at: new Date(Date.now() + 30 * 86400_000).toISOString() }).eq("url_norm", pg.url_norm); continue; }
      const pr = parsePage(html, fin.toString());
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pr.text)))).map((b)=>b.toString(16).padStart(2, "0")).join("").slice(0, 32);
      await admin.from("learn_pages").update({ ...upd, status: "ok", http_status: res.status, final_url: fin.toString(), title: pr.title, meta_description: pr.desc, js_rendered: pr.spa, word_count: pr.words, content_hash: hash, blocks: pr.blocks, text: pr.text, signals: pr.signals, error: pr.spa ? "page builds itself with JavaScript, so little text could be read" : null, next_fetch_at: new Date(Date.now() + 7 * 86400_000).toISOString() }).eq("url_norm", pg.url_norm);
      out.push({ url: pg.url_norm, words: pr.words, blocks: pr.blocks.length, spa: pr.spa });
    } catch (e) {
      await admin.from("learn_pages").update({ ...upd, status: "error", error: String(e.message ?? e).slice(0, 160), next_fetch_at: new Date(Date.now() + (pg.attempts >= 3 ? 14 : 1) * 86400_000).toISOString() }).eq("url_norm", pg.url_norm);
      out.push({ url: pg.url_norm, error: String(e.message ?? e).slice(0, 100) });
    }
  }
  return { ok: true, pages: out };
}
// Live pictures of the landing pages: a phone-sized, top-to-bottom stack of images (made by the AWS Lambda revora-screenshot; SCREENSHOT_URL secret, Vercel api/screenshot as the temporary fallback) stored privately.
async function handleLearnShots(limit = 3, only = null) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: sec } = await admin.from("app_secrets").select("value").eq("key", "shot_secret").maybeSingle();
  if (!sec?.value) return { ok: false, error: "shot_secret missing" };
  const { data: cos } = await admin.from("companies").select("id").eq("learning_enabled", false);
  const off = new Set((cos ?? []).map((c)=>c.id));
  const { data: pages } = only ? await admin.from("learn_pages").select("url_norm, final_url, content_hash, shot_hash, shot_at, company_ids").eq("url_norm", only) : await admin.from("learn_pages").select("url_norm, final_url, content_hash, shot_hash, shot_at, company_ids").eq("status", "ok").order("shot_at", { ascending: true, nullsFirst: true }).limit(60);
  const todo = only ? (pages ?? []) : (pages ?? []).filter((p)=>(p.company_ids ?? []).some((c)=>!off.has(c)) && (!p.shot_at || (p.shot_hash !== p.content_hash && Date.now() - new Date(p.shot_at).getTime() > 6 * 86400_000))).slice(0, limit);
  const out = [], deadline = Date.now() + 100_000;
  for (const p of todo){
    if (Date.now() > deadline) break;
    try {
      const ctl = new AbortController(), to = setTimeout(()=>ctl.abort(), 70_000);
      const shotUrl = Deno.env.get("SCREENSHOT_URL") ?? "";
      if (!shotUrl) throw new Error("SCREENSHOT_URL is not set");
      const r = await fetch(shotUrl, { method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", "x-shot-secret": sec.value }, body: JSON.stringify({ url: p.final_url || p.url_norm }) }).finally(()=>clearTimeout(to));
      const j = await r.json().catch(()=>({}));
      if (!r.ok || !j.slices?.length) throw new Error(j.error || `screenshot HTTP ${r.status}`);
      const dir = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(p.url_norm)))).map((b)=>b.toString(16).padStart(2, "0")).join("").slice(0, 16) + "/" + Date.now();
      const shots = [];
      for (const [i, sl] of j.slices.entries()){
        const bytes = Uint8Array.from(atob(sl.b64), (c)=>c.charCodeAt(0));
        const path = `${dir}/${String(i).padStart(2, "0")}.jpg`;
        const { error } = await admin.storage.from("learn-shots").upload(path, bytes, { contentType: "image/jpeg", upsert: true });
        if (error) throw new Error(error.message);
        shots.push({ path, y: sl.y, h: sl.h });
      }
      await admin.from("learn_pages").update({ shots, shot_at: new Date().toISOString(), shot_hash: p.content_hash, page_height: j.page_height ?? null }).eq("url_norm", p.url_norm);
      out.push({ url: p.url_norm, slices: shots.length, height: j.page_height });
    } catch (e) {
      await admin.from("learn_pages").update({ shot_at: new Date().toISOString() }).eq("url_norm", p.url_norm);
      out.push({ url: p.url_norm, error: String(e.message ?? e).slice(0, 140) });
    }
  }
  return { ok: true, shots: out };
}
// ---- What creatives and pages LOOK like: pictures, video frames and a Claude vision description of each -----------------------------------
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
// Per-million-token prices (USD) for what the learner uses, and a running count of real spend per day and model.
const LEARN_PRICES = { "claude-haiku-5-5": [0.10, 0.50], "claude-sonnet-5-5": [2.00, 10.00], "gpt-4o-mini": [0.15, 0.60] };
async function learnCount(model, usage) {
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const [pi, po] = LEARN_PRICES[model] ?? [2, 10], i = Number(usage?.input_tokens) || 0, o = Number(usage?.output_tokens) || 0;
    const day = new Date().toISOString().slice(0, 10);
    const { data: cur } = await admin.from("learn_usage").select("*").eq("day", day).eq("model", model).maybeSingle();
    await admin.from("learn_usage").upsert({ day, model, calls: (cur?.calls ?? 0) + 1, input_tokens: Number(cur?.input_tokens ?? 0) + i, output_tokens: Number(cur?.output_tokens ?? 0) + o, cost_usd: Number(cur?.cost_usd ?? 0) + i / 1e6 * pi + o / 1e6 * po }, { onConflict: "day,model" });
  } catch (_) { /* counting must never break reading */ }
}
async function learnOverCap(admin) {
  const { data: cap } = await admin.from("app_secrets").select("value").eq("key", "learn_vision_cap_usd").maybeSingle();
  const first = new Date().toISOString().slice(0, 8) + "01";
  const { data: rows } = await admin.from("learn_usage").select("cost_usd").gte("day", first);
  const spent = (rows ?? []).reduce((t, r)=>t + Number(r.cost_usd), 0);
  return { over: spent >= Number(cap?.value ?? 5), spent, cap: Number(cap?.value ?? 5) };
}
async function claudeVision(images, instruction, model = "claude-haiku-5-5") {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const content = [...images.map((i)=>({ type: "image", source: { type: "base64", media_type: i.type, data: i.b64 } })), { type: "text", text: instruction }];
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: "user", content }] }) });
  const j = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(j?.error?.message || `Claude HTTP ${r.status}`);
  await learnCount(model, j.usage);
  const text = (j.content ?? []).map((c)=>c.text ?? "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : { summary: text.slice(0, 800) }; } catch (_) { return { summary: text.slice(0, 800) }; }
}
const b64of = (buf)=>{ let bin = ""; for (let k = 0; k < buf.length; k += 8192) bin += String.fromCharCode(...buf.subarray(k, k + 8192)); return btoa(bin); };
async function fetchImage(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; RevoraLearner/1.0)" } });
  if (!r.ok) throw new Error(`image HTTP ${r.status}`);
  const type = (r.headers.get("content-type") ?? "image/jpeg").split(";")[0];
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) throw new Error(`not an image (${type})`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > 4_500_000) throw new Error("image too large");
  return { buf, type };
}
const AD_PROMPT = `You are studying one advertising creative for a direct-response ad learning system. Describe ONLY what you can see. Reply with JSON only, no other text:
{"summary":"2 sentences on what this ad shows","text_on_media":"every word visible on the image, exactly as written","people":"who is shown and what they are doing (age range, gender, expression), or none","product":"is the product visible, and how (pack, in hand, on table)","setting":"where it is","style":"one of: ugc_selfie, studio, before_after, testimonial_screenshot, chat_screenshot, text_only, meme, lifestyle, doctor_authority, news_style, other","colors":"main colours","hook":"what grabs attention in the first second","emotion":"fear, hope, curiosity, trust, urgency, etc.","cta_visible":"any button or call to action drawn on it","claims":"health or result claims made on the image","quality":"1 to 5 for clarity and professionalism","notes":"anything else a media buyer should know"}
If several images are given they are frames of one video in time order: describe how the video develops (hook, middle, end) in "summary".`;
const PAGE_PROMPT = `You are studying a sales landing page for a direct-response ad learning system. The images are the page seen on a phone, top to bottom, in order. Describe ONLY what you can see. Reply with JSON only:
{"above_the_fold":"what a visitor sees first, with the exact headline","structure":["each section in order, one line each"],"visual_style":"look and feel, fonts, colours, spacing","colors":"main colours","hooks":["every attention-grabbing line or visual, exact words"],"offer":"how price, packages and discount are shown","order_form":"where it is and what it asks for","cta_buttons":["exact button texts and colours"],"social_proof":["types used: chat screenshots, before/after, ratings, counters, doctor, media logos"],"trust":["guarantees, delivery, payment on delivery, certificates"],"urgency":"how urgency or scarcity is created","strengths":["what is done well"],"weaknesses":["what could be better"],"overall":"2 sentences for a media buyer"}`;
async function learnMediaDiscover(admin, cap = 30) {
  const { data: ads } = await admin.from("learn_objects").select("ad_account_id, company_id, meta_id, creative").eq("level", "ad").order("synced_at", { ascending: false }).limit(400);
  const cand = (ads ?? []).filter((a)=>a.creative && ["image", "image_feed", "video", "video_feed", "carousel"].includes(a.creative.kind));
  if (!cand.length) return 0;
  const { data: have } = await admin.from("learn_ad_media").select("ad_account_id, ad_id").in("ad_id", cand.map((a)=>a.meta_id));
  const done = new Set((have ?? []).map((h)=>`${h.ad_account_id}:${h.ad_id}`));
  const todo = cand.filter((a)=>!done.has(`${a.ad_account_id}:${a.meta_id}`)).slice(0, cap);
  const byAcct = new Map();
  for (const a of todo) byAcct.set(a.ad_account_id, [...(byAcct.get(a.ad_account_id) ?? []), a]);
  let n = 0;
  for (const [acctId, list] of byAcct){
    const { data: acct } = await admin.from("ad_accounts").select("id, meta_connection_id, company_id").eq("id", acctId).maybeSingle();
    if (!acct) continue;
    const token = await resolveToken(admin, acct);
    const info = await graphGet("", { ids: list.map((a)=>a.meta_id).join(","), fields: "creative{image_url,thumbnail_url,video_id,object_story_spec,asset_feed_spec}" }, token).catch(()=>({}));
    for (const a of list){
      const cr = info[a.meta_id]?.creative ?? {}, oss = cr.object_story_spec ?? {}, afs = cr.asset_feed_spec ?? {};
      const items = [];
      for (const v of [oss.video_data?.video_id, cr.video_id, ...(afs.videos ?? []).map((x)=>x.video_id)]) if (v) items.push({ key: `video:${v}`, kind: "video", url: null, role: "video" });
      const imgs = [cr.image_url, oss.link_data?.picture, oss.photo_data?.url, ...(oss.link_data?.child_attachments ?? []).map((c)=>c.picture), ...(afs.images ?? []).map((x)=>x.url)].filter(Boolean);
      for (const u of imgs) items.push({ key: `image:${hash32(u.split("?")[0])}`, kind: "image", url: u, role: "image" });
      if (!items.length && cr.thumbnail_url) items.push({ key: `image:${hash32(cr.thumbnail_url.split("?")[0])}`, kind: "image", url: cr.thumbnail_url, role: "thumbnail" });
      for (const it of items.slice(0, 12)){
        await admin.from("learn_ad_media").upsert({ ad_account_id: a.ad_account_id, ad_id: a.meta_id, media_key: it.key, role: it.role }, { onConflict: "ad_account_id,ad_id,media_key" });
        const { data: ex } = await admin.from("learn_media").select("media_key, company_ids").eq("media_key", it.key).maybeSingle();
        if (!ex) await admin.from("learn_media").insert({ media_key: it.key, kind: it.kind, source_url: it.url, company_ids: [a.company_id] });
        else if (!(ex.company_ids ?? []).includes(a.company_id)) await admin.from("learn_media").update({ company_ids: [...ex.company_ids, a.company_id] }).eq("media_key", it.key);
      }
      if (!items.length) await admin.from("learn_ad_media").upsert({ ad_account_id: a.ad_account_id, ad_id: a.meta_id, media_key: "none", role: "none" }, { onConflict: "ad_account_id,ad_id,media_key" });
      n++;
    }
  }
  return n;
}
async function handleLearnVision(limit = 4) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: cos } = await admin.from("companies").select("id").eq("learning_enabled", false);
  const off = new Set((cos ?? []).map((c)=>c.id));
  const out = { discovered: await learnMediaDiscover(admin).catch((e)=>`error: ${String(e.message ?? e).slice(0, 100)}`), media: [], pages: [] };
  const cap = await learnOverCap(admin);
  if (cap.over) return { ok: true, paused: `monthly cap reached ($${cap.spent.toFixed(2)} of $${cap.cap})`, ...out };
  if (!ANTHROPIC_KEY) return { ok: false, error: "ANTHROPIC_API_KEY is not set in the Supabase edge function secrets, so pictures are collected but not described yet.", ...out };
  const deadline = Date.now() + 100_000;
  // 1) creatives
  const { data: pend } = await admin.from("learn_media").select("media_key, kind, source_url, company_ids").is("described_at", null).is("error", null).order("created_at", { ascending: true }).limit(limit * 3);
  for (const m of (pend ?? []).filter((x)=>(x.company_ids ?? []).some((c)=>!off.has(c))).slice(0, limit)){
    if (Date.now() > deadline) break;
    try {
      const imgs = [], paths = [];
      let lengthS = null;
      const folder = m.media_key.replace(/[^a-z0-9]+/gi, "_");
      if (m.kind === "image") {
        const f = await fetchImage(m.source_url);
        imgs.push({ b64: b64of(f.buf), type: f.type });
        const path = `${folder}/0.${f.type.split("/")[1]}`;
        await admin.storage.from("learn-media").upload(path, f.buf, { contentType: f.type, upsert: true }); paths.push({ path, t: 0 });
      } else {
        const vid = m.media_key.replace("video:", "");
        const { data: map } = await admin.from("learn_ad_media").select("ad_account_id").eq("media_key", m.media_key).limit(1).maybeSingle();
        const { data: acct } = await admin.from("ad_accounts").select("id, meta_connection_id").eq("id", map?.ad_account_id ?? "").maybeSingle();
        if (!acct) throw new Error("no account for video");
        const token = await resolveToken(admin, acct);
        const v = await graphGet(vid, { fields: "picture,length,thumbnails{uri,is_preferred,width,height}" }, token);
        lengthS = v.length ?? null;
        let urls = (v.thumbnails?.data ?? []).map((t)=>t.uri).filter(Boolean);
        if (!urls.length && v.picture) urls = [v.picture];
        if (urls.length > 6) urls = Array.from({ length: 6 }, (_, k)=>urls[Math.round(k * (urls.length - 1) / 5)]);
        if (!urls.length) throw new Error("video has no frames");
        for (const [k, u] of urls.entries()){
          const f = await fetchImage(u).catch(()=>null); if (!f) continue;
          imgs.push({ b64: b64of(f.buf), type: f.type });
          const path = `${folder}/${k}.${f.type.split("/")[1]}`;
          await admin.storage.from("learn-media").upload(path, f.buf, { contentType: f.type, upsert: true }); paths.push({ path, t: v.length ? Math.round(k * v.length / Math.max(urls.length, 1)) : null });
        }
        if (!imgs.length) throw new Error("could not download frames");
      }
      const description = await claudeVision(imgs, AD_PROMPT);
      await admin.from("learn_media").update({ paths, length_s: lengthS, description, described_at: new Date().toISOString() }).eq("media_key", m.media_key);
      out.media.push({ key: m.media_key, kind: m.kind, style: description.style ?? null });
    } catch (e) {
      await admin.from("learn_media").update({ error: String(e.message ?? e).slice(0, 200) }).eq("media_key", m.media_key);
      out.media.push({ key: m.media_key, error: String(e.message ?? e).slice(0, 100) });
    }
  }
  // 2) landing pages (the screenshot slices)
  const { data: pgs } = await admin.from("learn_pages").select("url_norm, shots, company_ids").is("vision_at", null).not("shots", "is", null).limit(3);
  for (const pg of (pgs ?? []).filter((x)=>(x.company_ids ?? []).some((c)=>!off.has(c))).slice(0, 1)){
    if (Date.now() > deadline) break;
    try {
      const imgs = [];
      for (const sh of (pg.shots ?? []).slice(0, 8)){
        const { data: f } = await admin.storage.from("learn-shots").download(sh.path);
        if (f) imgs.push({ b64: b64of(new Uint8Array(await f.arrayBuffer())), type: "image/jpeg" });
      }
      if (!imgs.length) throw new Error("no slices");
      const vision = await claudeVision(imgs, PAGE_PROMPT, "claude-sonnet-5-5");
      await admin.from("learn_pages").update({ vision, vision_at: new Date().toISOString() }).eq("url_norm", pg.url_norm);
      out.pages.push({ url: pg.url_norm, slices_seen: imgs.length });
    } catch (e) {
      await admin.from("learn_pages").update({ vision_at: new Date().toISOString(), vision: { error: String(e.message ?? e).slice(0, 200) } }).eq("url_norm", pg.url_norm);
      out.pages.push({ url: pg.url_norm, error: String(e.message ?? e).slice(0, 100) });
    }
  }
  return { ok: true, ...out };
}
// ======================= PATTERN FINDER: what do winning ads have in common that losing ads lack? =======================================
// Daily job. Evidence first, wording second: every lesson is a counted comparison, never a guess.
//  - WINNER: sold or got messages at a cost clearly below its own account's median cost per result. LOSER: spent well past that cost for nothing.
//  - FEATURES: creative format, wording style, audience, budget setup, placements, landing page traits, and (once described) what the picture shows.
//  - A feature value becomes a lesson when its win rate beats (or trails) the overall rate by enough ads (z score) and enough lift.
//  - Lessons are kept per business (private) and across businesses (global, no names). Every run re-checks old lessons; ones that stop holding fade.
const PL = { minDecided: 20, minGroup: 8, z: 1.5, lift: 1.3 };
const bucketOf = (n, cuts, labels)=>{ for (let i = 0; i < cuts.length; i++) if (n < cuts[i]) return labels[i]; return labels[cuts.length]; };
function adFeatures(a) {
  const cr = a.creative ?? {}, cs = a.campaign_settings ?? {}, ss = a.adset_settings ?? {}, tg = ss.targeting ?? {};
  const f = {};
  f["Creative format"] = cr.kind ?? null;
  f["Button"] = cr.cta ?? null;
  const dest = String(ss.destination_type ?? "").toUpperCase();
  f["Where it sends people"] = /WHATSAPP/.test(dest) || /WHATSAPP/.test(cr.message_destination ?? "") ? "WhatsApp" : /MESSENGER/.test(dest) ? "Messenger" : /INSTAGRAM/.test(dest) ? "Instagram chat" : /ON_AD/.test(dest) ? "Lead form" : "Website";
  f["Campaign goal"] = cs.objective ?? null;
  f["Budget set on"] = (cs.daily_budget || cs.lifetime_budget) ? "campaign (CBO)" : "ad set (ABO)";
  f["Optimisation goal"] = ss.optimization_goal ?? null;
  f["Bid strategy"] = cs.bid_strategy ?? ss.bid_strategy ?? null;
  f["Placements"] = (tg.facebook_positions || tg.instagram_positions) ? ((tg.facebook_positions ?? []).length + (tg.instagram_positions ?? []).length <= 3 ? "a few chosen" : "many chosen") : "automatic";
  const amin = Number(tg.age_min) || 18, amax = Number(tg.age_max) || 65;
  f["Youngest age targeted"] = bucketOf(amin, [25, 35, 45], ["18-24", "25-34", "35-44", "45+"]);
  f["Age range width"] = bucketOf(amax - amin, [15, 30], ["narrow (under 15 years)", "medium (15-29 years)", "wide (30+ years)"]);
  const gn = tg.genders ?? [];
  f["Gender"] = gn.length === 1 ? (gn[0] === 1 ? "men only" : "women only") : "all genders";
  f["Country"] = (tg.geo_locations?.countries ?? [])[0] ?? null;
  const pt = String(cr.primary_text ?? "");
  if (pt) {
    f["Ad text length"] = bucketOf(pt.length, [300, 800], ["short (under 300 characters)", "medium (300-800)", "long (800+)"]);
    f["Ad text uses tick marks"] = /[✅✔☑]/.test(pt) ? "yes" : "no";
    f["Ad text mentions pay on delivery"] = /pay on delivery|cash on delivery|\bcod\b|pay when/i.test(pt) ? "yes" : "no";
    f["Ad text opens with a question"] = /\?/.test(pt.split(/\n/)[0] ?? "") ? "yes" : "no";
    f["Ad text mentions a price"] = /(₦|NGN|KSh|\$)\s?\d|\b\d{1,3},\d{3}\b/.test(pt) ? "yes" : "no";
    f["Ad text creates urgency"] = /limited|hurry|today only|before (it|stock)|running out|last chance|selling fast|don'?t wait/i.test(pt) ? "yes" : "no";
  }
  const hl = String(cr.headline ?? "");
  if (hl) f["Headline in all capitals"] = hl.replace(/[^A-Za-z]/g, "").length > 4 && hl === hl.toUpperCase() ? "yes" : "no";
  if (a.page_title || a.page_words) {
    f["Landing page length"] = bucketOf(Number(a.page_words) || 0, [800, 1500, 2500], ["short (under 800 words)", "medium (800-1500)", "long (1500-2500)", "very long (2500+)"]);
    const sg = a.page_signals ?? {};
    f["Page has testimonials"] = sg.testimonials ? "yes" : "no";
    f["Page offers pay on delivery"] = sg.pay_on_delivery ? "yes" : "no";
    f["Page has a money-back guarantee"] = sg.guarantee ? "yes" : "no";
    f["Page creates urgency"] = sg.urgency ? "yes" : "no";
    f["Page has free delivery"] = sg.free_delivery ? "yes" : "no";
    f["Page has an order form on it"] = (sg.forms ?? 0) > 0 ? "yes" : "no";
    f["Page has video"] = (sg.videos ?? 0) > 0 ? "yes" : "no";
  }
  const md = (a.media ?? []).map((m)=>m.seen).filter((d)=>d && d.style)[0];
  if (md) {
    f["What the creative looks like"] = md.style;
    f["Creative shows people"] = md.people && !/^none/i.test(md.people) ? "yes" : "no";
    f["Words on the creative"] = bucketOf(String(md.text_on_media ?? "").length, [20, 120], ["almost none", "some", "a lot"]);
  }
  return Object.fromEntries(Object.entries(f).filter(([, v])=>v != null && v !== ""));
}
const HOWTO = {
  "Creative format": "Use more of this format in the next test, and put less budget behind the formats that trail.",
  "Button": "Make this button your default for similar offers.",
  "Where it sends people": "Test sending more traffic to this destination.",
  "Budget set on": "Prefer this budget setup when launching similar campaigns.",
  "Placements": "Keep this placement style for similar campaigns.",
  "Landing page length": "Match this page length when you build or choose a page.",
  "Ad text length": "Aim for this length when writing ad text.",
  "What the creative looks like": "Make more creatives in this style and fewer in the styles that trail."
};
function pctText(x) { return Math.round(x * 100) + "%"; }
async function handleLearnPatterns(dryRun = false) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: off } = await admin.from("companies").select("id").eq("learning_enabled", false);
  const skip = new Set((off ?? []).map((c)=>c.id));
  const rows = [];
  for (let from = 0;; from += 1000){
    const { data } = await admin.from("learn_anatomy").select("*").range(from, from + 999);
    if (!data?.length) break; rows.push(...data); if (data.length < 1000) break;
  }
  const ads = rows.filter((a)=>!skip.has(a.company_id) && Number(a.spend) > 0);
  // Result type and per-account median cost per result.
  const resultOf = (a)=>{ const dest = a.adset_settings?.destination_type ?? ""; const msg = /WHATSAPP|MESSENGER|INSTAGRAM/i.test(dest) || /WHATSAPP/i.test(a.creative?.message_destination ?? ""); return msg ? Number(a.messages) || 0 : Number(a.purchases) || 0; };
  const byAcct = new Map();
  for (const a of ads) byAcct.set(a.ad_account_id, [...(byAcct.get(a.ad_account_id) ?? []), a]);
  const decided = [];
  for (const [, list] of byAcct){
    const cpas = list.filter((a)=>resultOf(a) >= 1).map((a)=>Number(a.spend) / resultOf(a)).sort((x, y)=>x - y);
    if (cpas.length < 3) continue;
    const med = cpas[Math.floor(cpas.length / 2)];
    for (const a of list){
      const r = resultOf(a), sp = Number(a.spend);
      if (r >= 1 && sp / r <= med * 0.9 && sp >= med * 0.5) decided.push({ a, win: true });
      else if (r === 0 && sp >= med * 2) decided.push({ a, win: false });
    }
  }
  const report = { ads_read: rows.length, with_spend: ads.length, decided: decided.length, winners: decided.filter((d)=>d.win).length };
  // Ads judged on purchases and ads judged on messages are different worlds, so they are compared only with their own kind.
  const SEG = (d)=>{ const dest = d.a.adset_settings?.destination_type ?? ""; return /WHATSAPP|MESSENGER|INSTAGRAM/i.test(dest) || /WHATSAPP/i.test(d.a.creative?.message_destination ?? "") ? "conversation ads (judged on messages)" : "sales ads (judged on purchases)"; };
  const compute = (set, scope, companyId, segment)=>{
    const N = set.length; if (N < PL.minDecided) return [];
    const W = set.filter((d)=>d.win).length, base = W / N; if (base < 0.05 || base > 0.95) return [];
    const groups = new Map();
    for (const d of set){
      for (const [k, v] of Object.entries(adFeatures(d.a))){
        const key = k + "\u0000" + v; const g = groups.get(key) ?? { k, v, n: 0, w: 0, cos: new Set(), camps: new Set() };
        g.n++; if (d.win) g.w++; g.cos.add(d.a.company_id); g.camps.add(d.a.campaign_id); groups.set(key, g);
      }
    }
    const out = [];
    for (const g of groups.values()){
      if (g.n < PL.minGroup || N - g.n < PL.minGroup) continue;
      // Ads in one campaign tend to look alike, so a pattern must show up in several campaigns (and, across businesses, in more than one business).
      if (g.camps.size < 3) continue;
      if (scope === "global" && g.cos.size < 2) continue;
      const rate = g.w / g.n, z = (rate - base) / Math.sqrt(base * (1 - base) / g.n), lift = rate / base;
      const positive = z >= PL.z && lift >= PL.lift, negative = z <= -PL.z && lift <= 1 / PL.lift;
      if (!positive && !negative) continue;
      const confidence = Math.abs(z) >= 2.5 && g.n >= 30 && g.camps.size >= 8 ? "high" : Math.abs(z) >= 2 && g.n >= 15 && g.camps.size >= 5 ? "medium" : "low";
      const claim = positive ? `${g.k}: "${g.v}" wins more often. ${pctText(rate)} of ${g.n} ${segment} with it were winners, against ${pctText(base)} overall (${lift.toFixed(1)}x), across ${g.camps.size} campaigns.` : `${g.k}: "${g.v}" wins less often. Only ${pctText(rate)} of ${g.n} ${segment} with it were winners, against ${pctText(base)} overall, across ${g.camps.size} campaigns.`;
      out.push({ scope, company_id: companyId, segment, feature: g.k, value: g.v, direction: positive ? "positive" : "negative", n: g.n, winners: g.w, rate, baseline: base, lift, z, companies: g.cos.size, confidence, claim, how_to: positive ? (HOWTO[g.k] ?? "Try more of this in your next test.") : "Test it against a better-performing alternative before spending more on it." });
    }
    return out.sort((x, y)=>Math.abs(y.z) - Math.abs(x.z)).slice(0, 25);
  };
  let found = [];
  const segs = [...new Set(decided.map(SEG))];
  for (const sg of segs){
    const inSeg = decided.filter((d)=>SEG(d) === sg);
    found = found.concat(compute(inSeg, "global", null, sg));
    const byCo = new Map();
    for (const d of inSeg) byCo.set(d.a.company_id, [...(byCo.get(d.a.company_id) ?? []), d]);
    for (const [co, set] of byCo) found = found.concat(compute(set, "company", co, sg));
  }
  report.segments = Object.fromEntries(segs.map((sg)=>{ const x = decided.filter((d)=>SEG(d) === sg); return [sg, { decided: x.length, winners: x.filter((d)=>d.win).length }]; }));
  report.lessons_found = found.length;
  if (dryRun) return { ok: true, ...report, preview: found.slice(0, 12).map((l)=>({ scope: l.scope, confidence: l.confidence, claim: l.claim })) };
  // Save, and re-check what was learned before.
  const { data: old } = await admin.from("learn_lessons").select("id, scope, company_id, segment, feature, value, confirmed, failed, status").neq("status", "retired");
  const keyOf = (l)=>`${l.scope}|${l.company_id ?? ""}|${l.segment ?? "all"}|${l.feature}|${l.value}`;
  const seen = new Set();
  for (const l of found){
    seen.add(keyOf(l));
    const prev = (old ?? []).find((o)=>keyOf(o) === keyOf(l));
    const row = { ...l, status: "active", last_checked: new Date().toISOString(), evidence: { decided: N0(decided), win_rate_overall: Math.round(report.winners / Math.max(report.decided, 1) * 100) / 100 } };
    const { error } = prev ? await admin.from("learn_lessons").update({ ...row, confirmed: (prev.confirmed ?? 0) + 1 }).eq("id", prev.id) : await admin.from("learn_lessons").insert({ ...row, confirmed: 1 });
    if (error) console.error("learn_lessons save:", error.message);
  }
  for (const o of old ?? []) if (!seen.has(keyOf(o))) {
    const failed = (o.failed ?? 0) + 1;
    await admin.from("learn_lessons").update({ failed, status: failed >= 2 ? "retired" : "weak", last_checked: new Date().toISOString() }).eq("id", o.id);
  }
  return { ok: true, ...report };
}
const N0 = (d)=>d.length;
// ======================= SESSION RECORDINGS: small compressed replay files in R2, one per chunk of a visit ====================================
const REC_ACC = Deno.env.get("R2_ACCOUNT_ID") ?? "", REC_BKT = Deno.env.get("R2_BUCKET") ?? "";
const recAws = REC_ACC && REC_BKT && Deno.env.get("R2_ACCESS_KEY_ID") ? new AwsClient({ accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID"), secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY"), service: "s3", region: "auto" }) : null;
const recUrl = (k)=>`https://${REC_ACC}.r2.cloudflarestorage.com/${REC_BKT}/${k.split("/").map(encodeURIComponent).join("/")}`;
const recKey = (company, scope, key, seq)=>`rec/${company}/${scope}/${key}/${String(seq).padStart(4, "0")}.json.gz`;
async function gzipText(text) { const cs = new CompressionStream("gzip"); const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(text)); w.close(); return new Uint8Array(await new Response(cs.readable).arrayBuffer()); }
async function gunzipBytes(bytes) { const ds = new DecompressionStream("gzip"); const w = ds.writable.getWriter(); w.write(bytes); w.close(); return await new Response(ds.readable).text(); }
const hostOf = (u)=>{ try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch (_) { return ""; } };
// Public (no login): the page script sends replay events here. The visit must already exist, the project must allow the website, size is capped.
async function handleRecIngest(req, body) {
  if (!recAws) return json({ ok: false, error: "recording storage is not configured" }, 503);
  const events = Array.isArray(body.events) ? body.events : [];
  const len = Number(req.headers.get("content-length") ?? 0);
  if (!events.length || events.length > 4000 || len > 900_000) return json({ ok: false, error: "bad size" }, 413);
  const key = String(body.key ?? "").slice(0, 64), seq = Number(body.seq);
  if (key.length < 8 || !(seq >= 0 && seq < 700)) return json({ ok: false, error: "bad request" }, 400);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  let sessQ = admin.from("site_sessions").select("id, company_id, site_id, project_id, rec_chunks, rec_bytes, country, host").eq("session_key", key);
  let scope = "";
  if (body.site) { scope = String(body.site); sessQ = sessQ.eq("site_id", scope); }
  else {
    const { data: pj } = await admin.from("rec_projects").select("id, enabled, record, domains").eq("public_id", String(body.project ?? "")).maybeSingle();
    if (!pj || !pj.enabled || !pj.record) return json({ ok: false, error: "project not found or recording is off" }, 403);
    const oh = hostOf(req.headers.get("origin") ?? "") || hostOf(req.headers.get("referer") ?? "");
    const allowed = (pj.domains ?? []).map((d)=>String(d).toLowerCase().replace(/^www\./, ""));
    if (allowed.length && !allowed.includes(oh)) return json({ ok: false, error: "this website is not allowed for this project" }, 403);
    scope = pj.id; sessQ = sessQ.eq("project_id", scope);
  }
  const { data: sess } = await sessQ.maybeSingle();
  if (!sess) return json({ ok: true, waiting: true }, 202); // the visit row is created by the first page ping; try again with the next chunk
  if (Number(sess.rec_bytes) > 25_000_000) return json({ ok: false, error: "recording limit reached" }, 413);
  const gz = await gzipText(JSON.stringify(events));
  const r = await recAws.fetch(recUrl(recKey(sess.company_id, scope, key, seq)), { method: "PUT", body: gz, headers: { "content-type": "application/gzip" } });
  if (!r.ok) return json({ ok: false, error: `storage ${r.status}` }, 502);
  const hd = (n)=>{ const v = req.headers.get(n); try { return v ? decodeURIComponent(v).slice(0, 80) : null; } catch (_) { return v ? v.slice(0, 80) : null; } };
  const bg = body.geo && typeof body.geo === "object" ? body.geo : {};
  const clean = (v)=>typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null;
  const country = (clean(bg.country) ?? hd("cf-ipcountry") ?? hd("x-vercel-ip-country") ?? "").toUpperCase();
  const geo = { country: /^[A-Z]{2}$/.test(country) ? country : null, city: clean(bg.city) ?? hd("cf-ipcity"), region: clean(bg.region) ?? hd("cf-region") };
  // No location from the browser or headers: look the visitor's address up once per visit (never stored, only the place is).
  if (!sess.country && !geo.country) {
    const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    if (/^[0-9a-fA-F:.]{3,45}$/.test(ip)) {
      try {
        const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country_code,city,region`, { signal: AbortSignal.timeout(2500) });
        const j = await r.json();
        if (j?.success) { geo.country = /^[A-Z]{2}$/.test(String(j.country_code)) ? j.country_code : null; geo.city = clean(j.city); geo.region = clean(j.region); }
      } catch (_) { /* location is a nice-to-have */ }
    }
  }
  const upd = { has_recording: true, rec_chunks: Math.max(Number(sess.rec_chunks), seq + 1), rec_bytes: Number(sess.rec_bytes) + gz.length };
  if (!sess.country) { if (geo.country) upd.country = geo.country; if (geo.city) upd.city = geo.city; if (geo.region) upd.region = geo.region; }
  if (!sess.host && body.host) upd.host = String(body.host).toLowerCase().replace(/^www\./, "").slice(0, 120);
  await admin.from("site_sessions").update(upd).eq("id", sess.id);
  // Someone is watching this visit live: also push this batch through the live table (Supabase Realtime delivers it), and tell the
  // recorder to send small batches every second while that lasts.
  const { data: w } = await admin.from("live_watch").select("until_at").eq("session_id", sess.id).maybeSingle();
  const watch = !!w && new Date(w.until_at).getTime() > Date.now();
  if (watch && JSON.stringify(events).length < 450_000) await admin.from("live_events").insert({ session_id: sess.id, seq, events });
  return json({ ok: true, watch });
}
// Logged in: the replay of one visit the person is allowed to see (the table's own rules decide).
async function handleRecGet(userClient, body) {
  if (!recAws) throw new HttpError(503, "recording storage is not configured");
  const { data: sess } = await userClient.from("site_sessions").select("*").eq("id", String(body.session_id ?? "")).maybeSingle();
  if (!sess) throw new HttpError(404, "Visit not found.");
  if (!sess.has_recording || !sess.rec_chunks) return { ok: true, events: [], session: sess, note: "No recording for this visit." };
  const scope = sess.site_id ?? sess.project_id;
  let all = [], total = 0;
  // from_seq: only the chunks after those the viewer already has (the live view asks for just the new part).
  const from = Math.max(0, Math.min(Number(body.from_seq) || 0, 699));
  for(let i = from; i < Math.min(sess.rec_chunks, 700); i++){
    const r = await recAws.fetch(recUrl(recKey(sess.company_id, scope, sess.session_key, i)));
    if (!r.ok) continue;
    const bytes = new Uint8Array(await r.arrayBuffer()); total += bytes.length;
    if (total > 8_000_000) break;
    try { all = all.concat(JSON.parse(await gunzipBytes(bytes))); } catch (_) { /* skip a damaged chunk */ }
  }
  all.sort((x, y)=>x.timestamp - y.timestamp);
  return { ok: true, events: all, session: sess, chunks: Number(sess.rec_chunks) };
}
// Cron: recordings are kept 60 days. Removes the files first, then the visit rows that have none left.
async function handleRecCleanup() {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const old = new Date(Date.now() - 60 * 86400_000).toISOString();
  const { data: rows } = await admin.from("site_sessions").select("id, company_id, site_id, project_id, session_key, rec_chunks").eq("has_recording", true).lt("started_at", old).limit(150);
  let files = 0;
  for (const r of rows ?? []){
    if (recAws) for(let i = 0; i < Math.min(r.rec_chunks, 700); i++){ await recAws.fetch(recUrl(recKey(r.company_id, r.site_id ?? r.project_id, r.session_key, i)), { method: "DELETE" }).catch(()=>{}); files++; }
    await admin.from("site_sessions").update({ has_recording: false, rec_chunks: 0 }).eq("id", r.id);
  }
  await admin.from("site_sessions").delete().lt("started_at", old).eq("has_recording", false);
  return { ok: true, sessions_cleaned: (rows ?? []).length, files_removed: files };
}
const gMoney = (n)=>"₦" + Math.round(Number(n)).toLocaleString("en-NG");
async function handleBalanceGuard(dryRun = false) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const deadline = Date.now() + 100_000;
  const { data: accts } = await admin.from("ad_accounts").select("id, name, nickname, meta_ad_account_id, meta_connection_id, company_id, media_buyer_id, billing_mode, guard_pause_below_naira, guard_resume_at_naira").eq("auto_pause_low_balance", true).eq("status", "active");
  const out = [];
  for (const a of (accts ?? []).filter((x)=>x.billing_mode !== "managed")){
    if (Date.now() > deadline) break;
    const actId = String(a.meta_ad_account_id ?? "").replace(/^act_/, "");
    if (!/^\d+$/.test(actId)) continue;
    const label = a.nickname || a.name || actId;
    try {
      const token = await resolveToken(admin, a);
      const d = await graphGet(`act_${actId}`, {
        fields: "is_prepay_account,funding_source_details"
      }, token);
      const bal = d.is_prepay_account === true ? parseAvailable(d.funding_source_details?.display_string) : null;
      if (bal == null) {
        out.push({ account: label, skipped: "balance not readable (or a card account)" });
        continue;
      }
      const low = Number(a.guard_pause_below_naira ?? 50), resume = Number(a.guard_resume_at_naira ?? 1000);
      const { data: open } = await admin.from("balance_guard_pauses").select("*").eq("ad_account_id", a.id).is("restored_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const tell = async (kind, title, body, row)=>notifyRpc(admin, { p_company: a.company_id, p_category: "money", p_kind: kind, p_title: title, p_body: body, p_severity: kind === "guard_pause" ? "warning" : "info", p_data: { ad_account_id: a.id }, p_dedupe: `${kind}:${row}`, p_buyer: a.media_buyer_id ?? null });
      if (!open && bal < low) {
        const camps = (await graphGetAll(`act_${actId}/campaigns`, { fields: "id,name,status", effective_status: JSON.stringify(["ACTIVE", "WITH_ISSUES", "IN_PROCESS"]) }, token)).filter((c)=>c.status === "ACTIVE");
        if (!camps.length) {
          out.push({ account: label, balance: bal, note: "low, nothing running" });
          continue;
        }
        const ids = new Set(camps.map((c)=>c.id));
        const [sets, ads] = await Promise.all([
          graphGetAll(`act_${actId}/adsets`, { fields: "id,name,status,campaign_id", effective_status: JSON.stringify(["ACTIVE", "WITH_ISSUES", "IN_PROCESS", "CAMPAIGN_PAUSED", "ADSET_PAUSED"]) }, token),
          graphGetAll(`act_${actId}/ads`, { fields: "id,name,status,campaign_id", effective_status: JSON.stringify(AD_STATES) }, token)
        ]);
        const items = [
          ...camps.map((c)=>({ level: "campaign", id: c.id, name: c.name })),
          ...sets.filter((x)=>x.status === "ACTIVE" && ids.has(x.campaign_id)).map((x)=>({ level: "adset", id: x.id, name: x.name })),
          ...ads.filter((x)=>x.status === "ACTIVE" && ids.has(x.campaign_id)).map((x)=>({ level: "ad", id: x.id, name: x.name }))
        ];
        if (dryRun) {
          out.push({ account: label, balance: bal, would_pause: { campaigns: camps.length, adsets: items.filter((i)=>i.level === "adset").length, ads: items.filter((i)=>i.level === "ad").length } });
          continue;
        }
        const { data: row } = await admin.from("balance_guard_pauses").insert({ ad_account_id: a.id, company_id: a.company_id, balance_at_pause: bal, items }).select("id").single();
        const done = await guardRun(admin, items, "p", "PAUSED", ["campaign", "adset", "ad"], token, deadline);
        await admin.from("balance_guard_pauses").update({ items }).eq("id", row.id);
        const n = items.filter((i)=>i.level === "campaign").length;
        if (done) await tell("guard_pause", `⏸️ ${label}: balance is ${gMoney(bal)}, so ${n} campaign${n === 1 ? "" : "s"} switched off`, `The balance fell below ${gMoney(low)}. Revora switched off the running campaigns, their ad sets and ads. Add funds (at least ${gMoney(resume)}) and they switch back on by themselves. Campaigns that were already off stay off.`, row.id);
        out.push({ account: label, balance: bal, paused: items.filter((i)=>i.p).length, of: items.length });
      } else if (open) {
        const items = Array.isArray(open.items) ? open.items : [];
        if (bal >= resume) {
          if (dryRun) {
            out.push({ account: label, balance: bal, would_resume: items.length });
            continue;
          }
          const done = await guardRun(admin, items, "r", "ACTIVE", ["ad", "adset", "campaign"], token, deadline);
          await admin.from("balance_guard_pauses").update({ items, ...done ? { restored_at: new Date().toISOString() } : {} }).eq("id", open.id);
          if (done) {
            const n = items.filter((i)=>i.level === "campaign").length;
            await tell("guard_resume", `▶️ ${label}: balance is back, ${n} campaign${n === 1 ? "" : "s"} switched on`, `The balance is ${gMoney(bal)} again. Revora switched back on only the campaigns (and their ad sets and ads) it had switched off.`, open.id);
          }
          out.push({ account: label, balance: bal, resumed: items.filter((i)=>i.r).length, of: items.length, finished: done });
        } else if (!dryRun && items.some((i)=>!i.p)) {
          // The pause did not finish last time (Meta busy): carry on.
          const done = await guardRun(admin, items, "p", "PAUSED", ["campaign", "adset", "ad"], token, deadline);
          await admin.from("balance_guard_pauses").update({ items }).eq("id", open.id);
          out.push({ account: label, balance: bal, continued_pause: done });
        } else out.push({ account: label, balance: bal, note: "paused, waiting for funds" });
      } else out.push({ account: label, balance: bal, note: "fine" });
    } catch (e) {
      out.push({ account: label, error: String(e.message ?? e).slice(0, 160) });
    }
  }
  return { ok: true, dry_run: dryRun, accounts: out };
}
async function handleSetBalanceGuard(userClient, body) {
  const { account } = await getAccount(userClient, body.ad_account_id);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { error } = await admin.from("ad_accounts").update({
    auto_pause_low_balance: body.enabled === true
  }).eq("id", account.id);
  if (error) throw new HttpError(500, error.message);
  return { ok: true, enabled: body.enabled === true };
}
async function handleAutoKill(dryRun = false) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: ruleRows } = await admin.from("kill_rules").select("*").or("enabled.eq.true,lpv_enabled.eq.true");
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
              mode: verdict ? (verdict.auto ?? rule.auto_kill) ? "auto-pause" : "suggest" : null
            });
            continue;
          }
          if (!verdict?.kill || paused.has(ad.id)) continue;
          if (verdict.auto ?? rule.auto_kill) {
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
        const spendOf = async (lvl)=>{ const m = await insightsByLevel(actId, lvl, "lifetime", token, factorOf(account)); return Object.fromEntries(Object.entries(m).map(([k, v])=>[k, { spend: Number(v.spend) || 0, results: Number(v.purchases || 0) + Number(v.conversations || 0) }])); };
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
    if (body.action === "purchase_alerts" || body.action === "meta_app_info" || body.action === "live_spend" || body.action === "daily_digest" || body.action === "meta_report" || body.action === "wa_report_setup") {
      const admin0 = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: secret0 } = await admin0.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
      if (!secret0?.value || (req.headers.get("x-cron-secret") ?? "") !== secret0.value) throw new HttpError(401, "Not allowed.");
      if (body.action === "wa_report_setup") {
        if (body.mode === "test" && body.user_id) {
          const t = await fetch(`${SUPABASE_URL}/functions/v1/send-internal-whatsapp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` }, body: JSON.stringify({ type: "daily_report", user_id: String(body.user_id), values: Array.isArray(body.values) ? body.values : ["Midday report (test)", "0", "9,864", "14,507", "3", "4,836", "19,379", "fund received ₦350,000, ad spend ₦319,507, OC 17, CPA ₦18,795"] }) });
          return json({ status: t.status, ...(await t.json().catch(()=>({}))) });
        }
        const r = await fetch(`${SUPABASE_URL}/functions/v1/send-internal-whatsapp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` }, body: JSON.stringify({ type: "report_template", action: body.mode === "status" ? "status" : "create" }) });
        return json({ status: r.status, ...(await r.json().catch(()=>({}))) });
      }
      return json(body.action === "live_spend" ? await handleLiveSpend(String(body.company_id ?? "")) : body.action === "meta_app_info" ? await handleMetaAppInfo() : body.action === "purchase_alerts" ? await handlePurchaseAlerts() : body.action === "meta_report" ? await handleMetaReport(Number(body.hour) || reportSlot(), body.push !== false) : await handleDailyDigest(body.push !== false));
    }
    if (body.action === "learn_shot_get") {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: secret } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
      if (!secret?.value || (req.headers.get("x-cron-secret") ?? "") !== secret.value) throw new HttpError(401, "Not allowed.");
      const { data: pg } = await admin.from("learn_pages").select("shots").eq("url_norm", String(body.url ?? "")).maybeSingle();
      const sh = (pg?.shots ?? [])[Number(body.i) || 0];
      if (!sh) return json({ ok: false, error: "no such slice", count: (pg?.shots ?? []).length });
      const { data: f, error } = await admin.storage.from("learn-shots").download(sh.path);
      if (error) throw new HttpError(500, error.message);
      const buf = new Uint8Array(await f.arrayBuffer()); let bin = ""; for (let k = 0; k < buf.length; k += 8192) bin += String.fromCharCode(...buf.subarray(k, k + 8192));
      return json({ ok: true, count: (pg?.shots ?? []).length, y: sh.y, h: sh.h, b64: btoa(bin) });
    }
    if (body.action === "rec_ingest") return await handleRecIngest(req, body);
    if (body.action === "rec_cleanup") {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: secret } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
      if (!secret?.value || (req.headers.get("x-cron-secret") ?? "") !== secret.value) throw new HttpError(401, "Not allowed.");
      return json(await handleRecCleanup());
    }
    if (body.action === "learn_patterns") {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: secret } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
      if (!secret?.value || (req.headers.get("x-cron-secret") ?? "") !== secret.value) throw new HttpError(401, "Not allowed.");
      return json(await handleLearnPatterns(body.dry_run === true));
    }
    if (body.action === "frames_check") return json(await handleFramesCheck(body));
    if (body.action === "learn_sync" || body.action === "learn_pages" || body.action === "learn_shots" || body.action === "learn_vision" || body.action === "learn_video") {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: secret } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
      const given = req.headers.get("x-cron-secret") ?? "";
      if (!secret?.value || given !== secret.value) throw new HttpError(401, "Not allowed.");
      if (body.action === "learn_video") return json(await handleLearnVideo(Math.min(Number(body.limit) || 2, 4), /^\d{5,25}$/.test(String(body.video_id ?? "")) ? String(body.video_id) : ""));
      return json(body.action === "learn_vision" ? await handleLearnVision(Math.min(Number(body.limit) || 4, 8)) : body.action === "learn_sync" ? await handleLearnSync(Math.min(Number(body.max_accounts) || 2, 6), /^[0-9a-f-]{36}$/.test(String(body.ad_account_id ?? "")) ? String(body.ad_account_id) : "") : body.action === "learn_shots" ? await handleLearnShots(Math.min(Number(body.limit) || 3, 6), body.url ? String(body.url) : null) : await handleLearnPages(Math.min(Number(body.limit) || 8, 20)));
    }
    if (body.action === "purchase_timing_digest") {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: secret } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
      const given = req.headers.get("x-cron-secret") ?? "";
      if (!secret?.value || given !== secret.value) throw new HttpError(401, "Not allowed.");
      return json(await handlePurchaseTimingDigest(body.dry_run === true));
    }
    if (body.action === "hourly_report") {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: secret } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
      const given = req.headers.get("x-cron-secret") ?? "";
      if (!secret?.value || given !== secret.value) throw new HttpError(401, "Not allowed.");
      return json(await handleHourlyReport(String(body.company_id ?? ""), Math.min(Math.max(Number(body.days) || 30, 1), 90)));
    }
    if (body.action === "balance_guard") {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: secret } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
      const given = req.headers.get("x-cron-secret") ?? "";
      if (!secret?.value || given !== secret.value) throw new HttpError(401, "Not allowed.");
      return json(await handleBalanceGuard(body.dry_run === true));
    }
    if (body.action === "auto_kill") {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: secret } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
      const given = req.headers.get("x-cron-secret") ?? "";
      if (!secret?.value || given !== secret.value) throw new HttpError(401, "Not allowed.");
      return json(await handleAutoKill(body.dry_run === true));
    }
    if (body.action === "team_snapshot") {
      let okAuth = !!SERVICE_KEY && req.headers.get("x-internal-key") === SERVICE_KEY;
      if (!okAuth && req.headers.get("x-cron-secret")) {
        const { data: secret } = await createClient(SUPABASE_URL, SERVICE_KEY).from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
        okAuth = !!secret?.value && req.headers.get("x-cron-secret") === secret.value;
      }
      if (!okAuth) throw new HttpError(401, "Not allowed.");
      return json(await handleTeamSnapshot(body));
    }
    const { userClient, profile } = await getUserContext(req);
    // Someone is looking at live Meta numbers: background jobs stand aside for a few minutes.
    if (["list", "daily", "reach", "balances"].includes(body.action)) {
      try { void createClient(SUPABASE_URL, SERVICE_KEY).rpc("meta_ui_ping").then(() => {}, () => {}); } catch { /* ignore */ }
    }
    if (body.action === "list") return json(await handleListSafe(userClient, profile, body));
    if (body.action === "list_cached") return json(await handleListCached(userClient, body));
    if (body.action === "daily") return json(await handleDaily(userClient, body));
    if (body.action === "reach") return json(await handleReach(userClient, body));
    if (body.action === "balances") return json(await handleBalances(userClient, body));
    if (body.action === "set_ad_message") return json(await handleSetAdMessage(userClient, body));
    if (body.action === "set_status") return json(await handleSetStatus(userClient, profile, body));
    if (body.action === "set_budget") return json(await handleSetBudget(userClient, profile, body));
    if (body.action === "targeting_search") return json(await handleTargetingSearch(userClient, body));
    if (body.action === "reach_estimate") return json(await handleReachEstimate(userClient, body));
    if (body.action === "ad_preview") return json(await handleAdPreview(userClient, body));
    if (body.action === "set_balance_guard") return json(await handleSetBalanceGuard(userClient, body));
    if (body.action === "rec_get") return json(await handleRecGet(userClient, body));
    if (body.action === "page_posts") return json(await handlePagePosts(userClient, body));
    if (body.action === "add_page_post") return json(await handleAddPagePost(userClient, body));
    if (body.action === "update_carousel") return json(await handleUpdateCarousel(userClient, body));
    if (body.action === "add_carousel") return json(await handleAddCarousel(userClient, body));
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
