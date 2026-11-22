import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Copies Meta's REAL delivery status onto Revora's campaigns, ad sets and ads, so the dashboard shows exactly what Ads Manager shows
// (Active, In review, Preparing, Not approved, Has issues, Billing issue, ...) and never a guess.
//   POST { ad_account_id? }   a logged-in person refreshes their own company's ad accounts (all, or one)
//   POST { all: true }        x-cron-secret: every ad account that has campaigns (run every few minutes by the scheduler)
// Three Meta calls per ad account (campaigns, ad sets, ads), each returning status + effective_status.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";
const db = createClient(SUPABASE_URL, SERVICE);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-cron-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...cors } });
// Meta accepts a different set of effective_status filter values on each edge.
const FILTER: Record<string, string[]> = {
  campaigns: ["ACTIVE", "PAUSED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES"],
  adsets: ["ACTIVE", "PAUSED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES", "CAMPAIGN_PAUSED"],
  ads: ["ACTIVE", "PAUSED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO", "CAMPAIGN_PAUSED", "ADSET_PAUSED"],
};

async function pull(path: string, fields: string) {
  const out: any[] = [];
  const edge = path.split("/").pop()!;
  let url = `${GRAPH}/${path}?fields=${fields}&effective_status=${encodeURIComponent(JSON.stringify(FILTER[edge]))}&limit=500&access_token=${META_TOKEN}`;
  for (let i = 0; i < 20 && url; i++) {
    const j = await fetch(url).then((r) => r.json());
    if (j.error) { if (/too many calls|rate limit|request limit/i.test(String(j.error.message))) void db.rpc("meta_rate_hit").then(() => {}, () => {}); throw new Error(j.error.message); }
    out.push(...(j.data ?? []));
    url = j.paging?.next ?? "";
  }
  return out;
}
// Update many rows at once: group the ids by (status, effective_status) so a few updates cover everything.
async function apply(table: string, idCol: string, rows: { id: string; status?: string; effective_status?: string }[], now: string) {
  const groups = new Map<string, string[]>();
  for (const r of rows) { const k = `${r.status ?? ""}|${r.effective_status ?? ""}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r.id); }
  let n = 0;
  for (const [k, ids] of groups) {
    const [status, eff] = k.split("|");
    for (let i = 0; i < ids.length; i += 200) {
      const patch: Record<string, unknown> = { effective_status: eff || null, status_checked_at: now };
      if (status) patch.status = status.toLowerCase();
      const { error } = await db.from(table).update(patch).in(idCol, ids.slice(i, i + 200));
      if (!error) n += Math.min(200, ids.length - i);
    }
  }
  return n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!META_TOKEN) return json({ error: "Meta is not connected on this platform." }, 503);
  const b = await req.json().catch(() => ({}));
  let accounts: any[] = [];
  const cron = req.headers.get("x-cron-secret") || "";
  if (cron) {
    const { data: sec } = await db.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
    if (cron !== sec?.value && cron !== CRON_SECRET) return json({ error: "Unauthorized" }, 401);
    const { data } = await db.from("ad_accounts").select("id, meta_ad_account_id, company_id, nickname");
    const { data: used } = await db.from("campaigns").select("ad_account_id").gte("created_at", new Date(Date.now() - 45 * 86400_000).toISOString());
    const want = new Set((used ?? []).map((r: any) => r.ad_account_id));
    accounts = (data ?? []).filter((a: any) => want.has(a.id) && a.meta_ad_account_id);
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: ud } = await db.auth.getUser(token);
    if (!ud?.user) return json({ error: "Please log in." }, 401);
    const { data: me } = await db.from("profiles").select("company_id").eq("id", ud.user.id).maybeSingle();
    if (!me?.company_id) return json({ error: "No company on this account." }, 403);
    let q = db.from("ad_accounts").select("id, meta_ad_account_id, company_id, nickname").eq("company_id", me.company_id);
    if (b?.ad_account_id) q = q.eq("id", String(b.ad_account_id));
    accounts = ((await q).data ?? []).filter((a: any) => a.meta_ad_account_id);
  }
  const now = new Date().toISOString();
  const result: any[] = [];
  for (const a of accounts) {
    const act = `act_${String(a.meta_ad_account_id).replace(/^act_/, "")}`;
    try {
      const [camps, sets, ads] = await Promise.all([
        pull(`${act}/campaigns`, "id,status,effective_status"),
        pull(`${act}/adsets`, "id,status,effective_status"),
        pull(`${act}/ads`, "id,status,effective_status"),
      ]);
      const c = await apply("campaigns", "meta_campaign_id", camps, now);
      const s = await apply("ad_sets", "meta_adset_id", sets, now);
      const d = await apply("ad_set_ads", "meta_ad_id", ads, now);
      result.push({ account: a.nickname ?? a.id, campaigns: c, ad_sets: s, ads: d });
    } catch (e) { result.push({ account: a.nickname ?? a.id, error: String((e as Error).message ?? e).slice(0, 200) }); }
  }
  return json({ ok: true, refreshed: result });
});
