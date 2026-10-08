import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// The one scheduled "tell people" sweep (pg_cron, every 30 min). Free in-app alerts only (AI inbox + push); no WhatsApp.
//   1. Low balance on an account that is still running ads.
//   2. A result: an ad set got a purchase, or its first / every 5th WhatsApp message today.
//   3. Money with nothing back: an ad set spent past the person's kill-rule spend today with zero results.
//   4. A clear winner: 3+ results today at well under the person's kill cost.
// Numbers come from daily_metrics (ad-set rows), which pull-meta-metrics keeps fresh. Each alert has a dedupe key, so it is announced once.
// Auth: the shared cron secret (app_secrets.ads_cron_secret) in the x-cron-secret header, like the other cron jobs.

const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const db = createClient(URL_, KEY);
const naira = (n: number) => "₦" + Math.round(n).toLocaleString("en-NG");
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

// Everyone who should hear about an ad account: its buyer plus the company's owners and admins.
async function peopleFor(acct: any) {
  const { data } = await db.from("profiles").select("id, role, media_buyer_id").eq("company_id", acct.company_id).in("role", ["owner", "admin", "buyer"]);
  return (data ?? []).filter((p: any) => p.role !== "buyer" || (p.media_buyer_id && p.media_buyer_id === acct.media_buyer_id));
}

// Put one alert in each person's AI inbox (once, by dedupe key) and push it to their phone.
async function tell(acct: any, kind: string, title: string, body: string, key: string, people?: any[]) {
  for (const p of people ?? await peopleFor(acct)) {
    const { error } = await db.from("ai_inbox").insert({ company_id: acct.company_id, profile_id: p.id, ad_account_id: acct.id, kind, title, body, payload: {}, dedupe_key: key });
    if (error) { if (error.code !== "23505") console.error("ai_inbox:", error.message); continue; }
    await fetch(`${URL_}/functions/v1/handle-whatsapp-reply`, {
      method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ audience: { user_ids: [p.id] }, category: "ads", notification: { title, body, url: "/dashboard_new.html#ai", tag: key } }),
    }).catch((e) => console.error("push:", e));
  }
}

async function lowBalance(acct: any, name: string) {
  if (Number(acct.balance_naira) > Number(acct.low_balance_threshold_naira)) return false;
  const last = acct.last_low_balance_alert_at ? new Date(acct.last_low_balance_alert_at).getTime() : 0;
  if (Date.now() - last < 6 * 3600_000) return false;
  const { count } = await db.from("campaigns").select("id", { count: "exact", head: true }).eq("ad_account_id", acct.id).eq("status", "ACTIVE");
  if (!count) return false;
  await tell(acct, "low_balance", `${name} is running low`, `Balance is about ${naira(Number(acct.balance_naira))} and ads are still running. Top up so they don't stop.`, `low_balance:${acct.id}:${Math.floor(Date.now() / (6 * 3600_000))}`);
  await db.from("ad_accounts").update({ last_low_balance_alert_at: new Date().toISOString() }).eq("id", acct.id);
  return true;
}

async function resultAlerts(acct: any, name: string, today: string) {
  const [{ data: rows }, { data: sets }] = await Promise.all([
    db.from("daily_metrics").select("ad_set_id, spend_naira, purchases, conversations").eq("ad_account_id", acct.id).eq("metric_date", today).is("ad_set_ad_id", null),
    db.from("ad_sets").select("id, adset_name").eq("ad_account_id", acct.id),
  ]);
  const people = await peopleFor(acct);
  const rules = (await db.from("kill_rules").select("profile_id, max_cost_per_result, min_spend").eq("enabled", true).in("profile_id", people.map((p: any) => p.id))).data ?? [];
  const minSpend = rules.length ? Math.min(...rules.map((r: any) => Number(r.min_spend))) : 0;
  const killCost = rules.length ? Math.min(...rules.map((r: any) => Number(r.max_cost_per_result))) : 0;
  let sent = 0;
  for (const r of rows ?? []) {
    const set = (sets ?? []).find((s: any) => s.id === r.ad_set_id)?.adset_name ?? "An ad set";
    const spend = Number(r.spend_naira || 0), buys = Number(r.purchases || 0), msgs = Number(r.conversations || 0), results = buys + msgs;
    const k = (x: string) => `${x}:${r.ad_set_id}:${today}`;
    const alerts: [string, string, string, string][] = [];
    if (buys > 0) alerts.push(["result", `${set} got a purchase`, `${buys} purchase${buys > 1 ? "s" : ""} today on ${name}, ${naira(spend)} spent so far.`, `${k("buy")}:${buys}`]);
    if (!buys && msgs > 0 && (msgs === 1 || msgs % 5 === 0)) alerts.push(["result", `${set}: ${msgs} message${msgs > 1 ? "s" : ""} today`, `${naira(spend)} spent on ${name}, about ${naira(spend / msgs)} per message.`, `${k("msg")}:${msgs}`]);
    if (!results && minSpend > 0 && spend >= minSpend) alerts.push(["spend_no_result", `${set} spent ${naira(spend)} with no result`, `On ${name} today. Don't judge too early, but this is past your kill-rule spend.`, k("noresult")]);
    if (results >= 3 && killCost > 0 && spend / results <= killCost * 0.6) alerts.push(["winner", `${set} looks like a winner`, `${results} results today at about ${naira(spend / results)} each on ${name}. Consider scaling about 20%.`, k("winner")]);
    for (const [kind, title, body, key] of alerts) { await tell(acct, kind, title, body, key, people); sent++; }
  }
  return sent;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => ({}));
  const given = req.headers.get("x-cron-secret") || body?.cron_secret || "";
  const { data: sec } = await db.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
  if (!given || (given !== sec?.value && given !== CRON_SECRET)) return json({ error: "Unauthorized" }, 401);
  try {
    const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10); // Lagos is UTC+1
    const { data: accounts } = await db.from("ad_accounts").select("id, name, nickname, balance_naira, low_balance_threshold_naira, last_low_balance_alert_at, media_buyer_id, company_id").eq("status", "active");
    const out = { accounts: accounts?.length ?? 0, low_balance: 0, other_alerts: 0 };
    for (const a of accounts ?? []) {
      const name = a.nickname || a.name || "Your ad account";
      if (a.balance_naira != null && await lowBalance(a, name)) out.low_balance++;
      out.other_alerts += await resultAlerts(a, name, today).catch((e) => { console.error("resultAlerts:", e); return 0; });
    }
    return json({ ok: true, ...out });
  } catch (err: any) {
    console.error("alerts sweep error:", err);
    return json({ error: err.message }, 500);
  }
});
