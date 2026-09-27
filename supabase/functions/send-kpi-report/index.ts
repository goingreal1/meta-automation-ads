import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "1151743088022928";
const ADMIN_WHATSAPP_NUMBER = Deno.env.get("ADMIN_WHATSAPP_NUMBER") ?? "2348104611794";
const META_GRAPH_BASE = "https://graph.facebook.com/v20.0";

async function sendWhatsApp(to: string, body: string) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return { ok: false };
  const res = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && !data.error };
}

function fmtNaira(n: number | null | undefined) {
  if (n === null || n === undefined || isNaN(Number(n))) return "an unknown amount";
  return `₦${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function parseWalletBalance(displayString: string | undefined): number | null {
  if (!displayString) return null;
  const match = displayString.match(/([\d,]+\.\d{2})/);
  return match ? parseFloat(match[1].replace(/,/g, "")) : null;
}

async function refreshBalance(supabase: any, acc: any): Promise<number | null> {
  if (!META_ACCESS_TOKEN || !acc.meta_ad_account_id) return acc.balance_naira ? Number(acc.balance_naira) : null;
  try {
    const params = new URLSearchParams({ access_token: META_ACCESS_TOKEN, fields: "balance,funding_source_details" });
    const res = await fetch(`${META_GRAPH_BASE}/act_${acc.meta_ad_account_id}?${params.toString()}`);
    const data = await res.json();
    if (data.error) return acc.balance_naira ? Number(acc.balance_naira) : null;
    const walletBalance = parseWalletBalance(data.funding_source_details?.display_string);
    const balance = walletBalance !== null ? walletBalance : (data.balance !== undefined ? Number(data.balance) / 100 : null);
    await supabase.from("ad_accounts").update({ balance_naira: balance, balance_updated_at: new Date().toISOString() }).eq("id", acc.id);
    return balance;
  } catch { return acc.balance_naira ? Number(acc.balance_naira) : null; }
}

async function fetchLiveAdSetMetrics(metaAdAccountId: string): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (!META_ACCESS_TOKEN) return map;
  const fields = "adset_id,spend,impressions,reach,clicks,actions";
  const params = new URLSearchParams({ access_token: META_ACCESS_TOKEN, fields, level: "adset", date_preset: "today", limit: "200" });
  try {
    const res = await fetch(`${META_GRAPH_BASE}/act_${metaAdAccountId}/insights?${params.toString()}`);
    const data = await res.json();
    if (data.error) return map;
    for (const row of data.data ?? []) {
      const purchaseAction = (row.actions ?? []).find((a: any) => a.action_type === "purchase" || a.action_type === "offsite_conversion.fb_pixel_purchase");
      const lpvAction = (row.actions ?? []).find((a: any) => a.action_type === "landing_page_view");
      map.set(row.adset_id, {
        spend: parseFloat(row.spend ?? "0"), impressions: parseInt(row.impressions ?? "0"), reach: parseInt(row.reach ?? "0"),
        clicks: parseInt(row.clicks ?? "0"), orders: purchaseAction ? parseInt(purchaseAction.value) : 0,
        landingPageViews: lpvAction ? parseInt(lpvAction.value) : 0,
      });
    }
  } catch { /* ignore, empty map returned */ }
  return map;
}

async function persistLiveMetrics(supabase: any, adSetDbId: string, accountDbId: string, m: any) {
  const costPerOrder = m.orders > 0 ? m.spend / m.orders : null;
  const ctr = m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0;
  const cpc = m.clicks > 0 ? m.spend / m.clicks : 0;
  await supabase.from("daily_metrics").upsert({
    ad_set_id: adSetDbId, ad_account_id: accountDbId, metric_date: new Date().toISOString().slice(0, 10),
    spend_naira: m.spend, impressions: m.impressions, reach: m.reach, clicks: m.clicks, ctr, cpc_naira: cpc,
    orders: m.orders, cost_per_order_naira: costPerOrder, landing_page_views: m.landingPageViews,
  }, { onConflict: "ad_set_id,metric_date" });
}

function emptyTotals() { return { spend: 0, impressions: 0, reach: 0, clicks: 0, orders: 0, landingPageViews: 0 }; }
function addTotals(a: any, m: any) { a.spend += m.spend; a.impressions += m.impressions; a.reach += m.reach; a.clicks += m.clicks; a.orders += m.orders; a.landingPageViews += m.landingPageViews; }

function naturalReport(acc: any, totals: any): string {
  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const lpvRate = totals.clicks > 0 ? (totals.landingPageViews / totals.clicks) * 100 : 0;
  const costPerOrder = totals.orders > 0 ? totals.spend / totals.orders : null;
  const ctrWord = ctr >= 3 ? "excellent" : ctr >= 1 ? "solid" : "weak";
  const parts: string[] = [`*${acc.nickname ?? acc.name}* — ${fmtNaira(totals.spend)} spent today (live).`];
  if (totals.impressions === 0) {
    parts.push("No impressions yet on the active ad sets.");
  } else {
    parts.push(`${totals.impressions.toLocaleString()} impressions, ${totals.clicks.toLocaleString()} clicks — a ${ctr.toFixed(2)}% CTR, ${ctrWord}.`);
    if (totals.clicks > 0) parts.push(totals.landingPageViews === 0 ? "None showing as a tracked page view yet." : `${totals.landingPageViews.toLocaleString()} (about ${lpvRate.toFixed(0)}%) reached the page.`);
    if (totals.orders > 0) parts.push(`${totals.orders} order${totals.orders > 1 ? "s" : ""}, roughly ${fmtNaira(costPerOrder)} each.`);
    else if (totals.landingPageViews > 0) parts.push("Still no orders from those page views.");
    else if (totals.clicks > 0) parts.push("No orders yet, early days.");
  }
  return parts.join(" ");
}

async function buildLiveKPIReport(supabase: any): Promise<string> {
  const { data: allAccounts } = await supabase.from("ad_accounts").select("*").eq("status", "active");
  const lines: string[] = [`Here's your ${new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" })} check-in (live from Meta):`, ""];
  const grand = emptyTotals();
  let anyActive = false;

  for (const acc of allAccounts ?? []) {
    const { data: adSets } = await supabase.from("ad_sets").select("id, adset_name, meta_adset_id, status").eq("ad_account_id", acc.id);
    const activeSets = (adSets ?? []).filter((s: any) => s.status === "active");
    const pausedSets = (adSets ?? []).filter((s: any) => s.status !== "active");
    if (activeSets.length === 0) continue;
    anyActive = true;

    const liveMap = await fetchLiveAdSetMetrics(acc.meta_ad_account_id);
    const totals = emptyTotals();
    for (const s of activeSets) {
      const m = liveMap.get(s.meta_adset_id) ?? emptyTotals();
      addTotals(totals, m);
      await persistLiveMetrics(supabase, s.id, acc.id, m);
    }
    addTotals(grand, totals);
    lines.push(naturalReport(acc, totals));
    if (pausedSets.length > 0) lines.push(`_(${pausedSets.length} paused ad set${pausedSets.length > 1 ? "s" : ""} excluded: ${pausedSets.map((s: any) => s.adset_name).join(", ")})_`);
    lines.push("");
  }

  if (!anyActive) return "Nothing's actively running right now — quiet check-in, no ads to report on.";

  const grandCtr = grand.impressions > 0 ? ((grand.clicks / grand.impressions) * 100).toFixed(2) : "0.00";
  lines.push(`*Overall:* ${fmtNaira(grand.spend)} spent, ${grand.impressions.toLocaleString()} impressions, ${grand.clicks.toLocaleString()} clicks, ${grand.landingPageViews.toLocaleString()} page views, ${grandCtr}% CTR, ${grand.orders} orders.`);
  return lines.join("\n");
}

Deno.serve(async (_req: Request) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const report = await buildLiveKPIReport(supabase);
    const result = await sendWhatsApp(ADMIN_WHATSAPP_NUMBER, report);
    return new Response(JSON.stringify({ success: result.ok, report }), { status: result.ok ? 200 : 500, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
