import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Powers the "AI Assistant" chat panel in dashboard_new.html. Every question
// is grounded in the caller's OWN real data -- never invented -- and the
// slice of data handed to the model depends on who's asking:
//   owner/admin      -> whole company: every buyer's spend/orders/ROAS, which
//                        ad sets & creatives are actually driving orders,
//                        flags needing attention (approvals, duplicates, stuck orders).
//   buyer            -> only their own campaigns/ad sets/creatives and orders,
//                        plus what the AI call agent has done on their new orders.
//   customer_care    -> calls that need a human, possible-duplicate orders,
//                        stuck orders -- the support queue's own priorities.
//   delivery_agent   -> their own assigned/offered deliveries.
//
// RLS on these tables is company-wide (every role in a company can read every
// row), so the buyer/customer_care/delivery_agent scoping below is done
// explicitly in these queries -- RLS alone would leak cross-buyer data into
// a buyer's own answers.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

function fmtNaira(n: number) {
  return "₦" + Math.round(n || 0).toLocaleString("en-NG");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not signed in" }, 401);

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return json({ error: "Not signed in" }, 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id, role, display_name, media_buyer_id, delivery_agent_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.company_id) return json({ error: "No company on this account yet" }, 400);

  let body: any = {};
  try { body = await req.json(); } catch { /* no body */ }
  const question = (body?.question || "").toString().trim();
  if (!question) return json({ error: "A question is required" }, 400);

  if (!OPENAI_API_KEY) {
    return json({
      answer: "AI chat isn't switched on yet for this workspace — an admin needs to add an OPENAI_API_KEY in Supabase (Project Settings → Edge Functions → Secrets) before I can answer questions.",
    });
  }

  const companyId = profile.company_id as string;
  const role = profile.role as string;
  const sinceIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const { data: companyRow } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
  const companyName = companyRow?.name || "the company";

  let data: Record<string, unknown>;
  try {
    if (role === "owner" || role === "admin") data = await buildAdminContext(companyId, sinceIso);
    else if (role === "buyer") data = await buildBuyerContext(companyId, profile.media_buyer_id, sinceIso);
    else if (role === "customer_care") data = await buildCareContext(companyId, sinceIso);
    else if (role === "delivery_agent") data = await buildDeliveryContext(companyId, profile.delivery_agent_id, sinceIso);
    else data = { note: "No specific data view defined for this role yet." };
  } catch (e) {
    return json({ error: "Couldn't pull your data: " + (e as Error).message }, 500);
  }

  const roleLabel: Record<string, string> = {
    owner: "the company owner", admin: "an admin", buyer: "a media buyer",
    customer_care: "a customer care agent", delivery_agent: "a delivery agent",
  };

  const systemPrompt = `You are the AI assistant built into ${companyName}'s operations dashboard (a media-buying + order/delivery CRM for Nigerian e-commerce).
You are answering ${profile.display_name || "a team member"}, who is ${roleLabel[role] || role} at this company.
Answer ONLY using the JSON data provided below — it is a real, live snapshot of their data (last 7 days unless noted). Never invent numbers, names, or outcomes that aren't in it.
If the data needed to answer isn't in the JSON, say so plainly and suggest what to check (e.g. "pull the latest metrics from Meta first") instead of guessing.
Be concise and direct — short paragraphs or bullet points, not a wall of text. Use ₦ for money. This person is busy and wants the answer, not a lecture.

DATA (JSON):
${JSON.stringify(data)}`;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // This OpenAI project's key doesn't have access to the -mini/-nano
        // tiers (confirmed live: gpt-4o-mini/gpt-4.1-mini/gpt-4.1-nano/o4-mini
        // all 403 "does not have access to model") -- only gpt-4o and
        // gpt-3.5-turbo work on this account. Using gpt-4o for quality.
        model: "gpt-4o",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: question }],
        temperature: 0.3,
        max_tokens: 600,
      }),
    });
    const out = await r.json();
    if (!r.ok) return json({ error: out?.error?.message || "AI request failed" }, 502);
    const answer = out?.choices?.[0]?.message?.content?.trim();
    return json({ answer: answer || "I couldn't generate a response from your data just now — try again." });
  } catch (e) {
    return json({ error: "AI request failed: " + (e as Error).message }, 502);
  }
});

// ── Role-scoped context builders ──────────────────────────────────────────

async function buildAdminContext(companyId: string, sinceIso: string) {
  const [{ data: buyers }, { data: adSets }, { data: metrics }, { data: orders }, { data: calls }, { data: approvals }, { data: creatives }] = await Promise.all([
    supabase.from("media_buyers").select("id, name, code").eq("company_id", companyId).eq("active", true),
    supabase.from("ad_sets").select("id, adset_name, media_buyer_id, creative_id, status, campaign_id").eq("company_id", companyId).limit(500),
    supabase.from("daily_metrics").select("ad_set_id, spend_naira, orders, ctr, cost_per_order_naira, metric_date").eq("company_id", companyId).gte("metric_date", sinceIso.slice(0, 10)).limit(2000),
    supabase.from("orders").select("id, media_buyer_id, ad_set_id, creative_id, order_status, order_value_naira, possible_duplicate, followup_attempts, ordered_at").eq("company_id", companyId).gte("ordered_at", sinceIso).limit(2000),
    supabase.from("voice_calls").select("status, needs_human").eq("company_id", companyId).gte("created_at", sinceIso).limit(2000),
    supabase.from("pending_approvals").select("id").eq("company_id", companyId).eq("status", "pending"),
    supabase.from("creative_assets").select("id, headline, file_name").eq("company_id", companyId).limit(500),
  ]);

  const adSetById = new Map((adSets || []).map(a => [a.id, a]));
  const creativeById = new Map((creatives || []).map(c => [c.id, c]));

  // Per-buyer rollup: spend (via their ad sets), orders, delivered, value.
  const buyerStats = new Map<string, { name: string; code: string; spend: number; orders: number; delivered: number; value: number }>();
  for (const b of buyers || []) buyerStats.set(b.id, { name: b.name, code: b.code, spend: 0, orders: 0, delivered: 0, value: 0 });
  for (const m of metrics || []) {
    const buyerId = adSetById.get(m.ad_set_id)?.media_buyer_id;
    if (buyerId && buyerStats.has(buyerId)) buyerStats.get(buyerId)!.spend += Number(m.spend_naira || 0);
  }
  for (const o of orders || []) {
    if (o.media_buyer_id && buyerStats.has(o.media_buyer_id)) {
      const s = buyerStats.get(o.media_buyer_id)!;
      s.orders++;
      s.value += Number(o.order_value_naira || 0);
      if (o.order_status === "delivered") s.delivered++;
    }
  }

  // Which ad sets / creatives actually bring orders.
  const ordersByAdSet = new Map<string, number>();
  const ordersByCreative = new Map<string, number>();
  for (const o of orders || []) {
    if (o.ad_set_id) ordersByAdSet.set(o.ad_set_id, (ordersByAdSet.get(o.ad_set_id) || 0) + 1);
    if (o.creative_id) ordersByCreative.set(o.creative_id, (ordersByCreative.get(o.creative_id) || 0) + 1);
  }
  const topAdSets = [...ordersByAdSet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([id, n]) => ({ ad_set: adSetById.get(id)?.adset_name || id, orders: n }));
  const topCreatives = [...ordersByCreative.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([id, n]) => ({ creative: creativeById.get(id)?.headline || creativeById.get(id)?.file_name || id, orders: n }));

  const callStatusCounts: Record<string, number> = {};
  let needsHuman = 0;
  for (const c of calls || []) { callStatusCounts[c.status] = (callStatusCounts[c.status] || 0) + 1; if (c.needs_human) needsHuman++; }

  return {
    period: "last 7 days",
    buyers: [...buyerStats.values()].map(s => ({
      name: s.name, code: s.code, spend: fmtNaira(s.spend), orders: s.orders, delivered: s.delivered,
      order_value: fmtNaira(s.value), cpa: s.orders ? fmtNaira(s.spend / s.orders) : "n/a",
    })),
    top_ad_sets_by_orders: topAdSets,
    top_creatives_by_orders: topCreatives,
    ai_call_agent_outcomes_last_7_days: callStatusCounts,
    calls_flagged_needing_a_human: needsHuman,
    pending_approvals_awaiting_review: (approvals || []).length,
    possible_duplicate_orders: (orders || []).filter(o => o.possible_duplicate).length,
    orders_stuck_after_followup_attempts: (orders || []).filter(o => (o.followup_attempts || 0) > 0).length,
    total_orders_last_7_days: (orders || []).length,
  };
}

async function buildBuyerContext(companyId: string, mediaBuyerId: string | null, sinceIso: string) {
  if (!mediaBuyerId) return { note: "This account isn't linked to a media buyer profile yet, so there's no campaign/order data to show." };

  const [{ data: adSets }, { data: creatives }, { data: orders }] = await Promise.all([
    supabase.from("ad_sets").select("id, adset_name, creative_id, status").eq("company_id", companyId).eq("media_buyer_id", mediaBuyerId).limit(300),
    supabase.from("creative_assets").select("id, headline, file_name").eq("company_id", companyId).limit(300),
    supabase.from("orders").select("id, order_status, order_value_naira, ad_set_id, creative_id, ordered_at, delivery_agent_id, assignment_status").eq("company_id", companyId).eq("media_buyer_id", mediaBuyerId).gte("ordered_at", sinceIso).limit(1000),
  ]);
  const adSetIds = (adSets || []).map(a => a.id);
  const { data: metrics } = adSetIds.length
    ? await supabase.from("daily_metrics").select("ad_set_id, spend_naira, ctr, cost_per_order_naira, orders, metric_date").in("ad_set_id", adSetIds).gte("metric_date", sinceIso.slice(0, 10)).limit(2000)
    : { data: [] as any[] };

  const adSetById = new Map((adSets || []).map(a => [a.id, a]));
  const creativeById = new Map((creatives || []).map(c => [c.id, c]));

  const totalSpend = (metrics || []).reduce((s, m) => s + Number(m.spend_naira || 0), 0);
  const avgCtr = (metrics || []).length ? (metrics || []).reduce((s, m) => s + Number(m.ctr || 0), 0) / (metrics || []).length : 0;

  const ordersByAdSet = new Map<string, number>();
  for (const o of orders || []) if (o.ad_set_id) ordersByAdSet.set(o.ad_set_id, (ordersByAdSet.get(o.ad_set_id) || 0) + 1);
  const topAdSets = [...ordersByAdSet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, n]) => ({ ad_set: adSetById.get(id)?.adset_name || id, orders: n, creative: creativeById.get(adSetById.get(id)?.creative_id)?.headline || null }));

  // What the AI call agent has actually done on this buyer's new orders.
  const orderIds = (orders || []).map(o => o.id);
  const { data: calls } = orderIds.length
    ? await supabase.from("voice_calls").select("order_id, status").in("order_id", orderIds).gte("created_at", sinceIso).limit(1000)
    : { data: [] as any[] };
  const callStatusCounts: Record<string, number> = {};
  for (const c of calls || []) callStatusCounts[c.status] = (callStatusCounts[c.status] || 0) + 1;
  const ordersWithDeliveryAgent = (orders || []).filter(o => o.delivery_agent_id).length;
  const ordersAwaitingRiderAcceptance = (orders || []).filter(o => o.assignment_status === "offered").length;

  return {
    period: "last 7 days",
    campaigns_summary: { active_ad_sets: (adSets || []).filter(a => a.status === "active" || a.status === "ACTIVE").length, total_ad_sets: (adSets || []).length, spend: fmtNaira(totalSpend), avg_ctr_pct: avgCtr.toFixed(2) },
    top_ad_sets_by_orders: topAdSets,
    orders_summary: {
      total: (orders || []).length,
      delivered: (orders || []).filter(o => o.order_status === "delivered").length,
      pending: (orders || []).filter(o => o.order_status === "pending").length,
      value: fmtNaira((orders || []).reduce((s, o) => s + Number(o.order_value_naira || 0), 0)),
    },
    ai_call_agent_on_new_orders: {
      calls_made: (calls || []).length,
      outcomes: callStatusCounts,
      note: "Every new order automatically gets an AI call attempt to confirm it; outcomes are also visible to Customer Care in the Support Queue, and confirmed orders move to a delivery agent for dispatch.",
    },
    delivery_handoff: { orders_assigned_to_a_delivery_agent: ordersWithDeliveryAgent, orders_awaiting_rider_acceptance: ordersAwaitingRiderAcceptance },
  };
}

async function buildCareContext(companyId: string, sinceIso: string) {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, customer_name, customer_phone, order_status, possible_duplicate, followup_attempts, ordered_at")
    .eq("company_id", companyId)
    .gte("ordered_at", sinceIso)
    .limit(1000);
  const orderById = new Map((orders || []).map(o => [o.id, o]));

  const { data: calls } = await supabase
    .from("voice_calls")
    .select("order_id, status, summary, red_flags, needs_human, created_at")
    .eq("company_id", companyId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(500);

  const needsAttention = (calls || [])
    .filter(c => c.needs_human || c.status === "failed" || c.status === "no_answer")
    .slice(0, 20)
    .map(c => ({
      customer: orderById.get(c.order_id)?.customer_name || "Unknown",
      phone: orderById.get(c.order_id)?.customer_phone || null,
      call_status: c.status, needs_human: c.needs_human, red_flags: c.red_flags, summary: c.summary,
    }));

  const duplicates = (orders || []).filter(o => o.possible_duplicate)
    .map(o => ({ customer: o.customer_name, phone: o.customer_phone, status: o.order_status }));
  const stuck = (orders || []).filter(o => (o.followup_attempts || 0) > 0)
    .map(o => ({ customer: o.customer_name, phone: o.customer_phone, status: o.order_status, followup_attempts: o.followup_attempts }));

  return {
    period: "last 7 days",
    calls_needing_a_human_right_now: needsAttention,
    possible_duplicate_orders: duplicates,
    stuck_orders_after_followup_attempts: stuck,
    totals: { orders_last_7_days: (orders || []).length, calls_last_7_days: (calls || []).length },
  };
}

async function buildDeliveryContext(companyId: string, deliveryAgentId: string | null, sinceIso: string) {
  if (!deliveryAgentId) return { note: "This account isn't linked to a delivery agent profile yet." };
  const { data: orders } = await supabase
    .from("orders")
    .select("id, customer_name, customer_city, order_status, assignment_status, order_value_naira, ordered_at")
    .eq("company_id", companyId)
    .eq("delivery_agent_id", deliveryAgentId)
    .gte("ordered_at", sinceIso)
    .limit(500);
  return {
    period: "last 7 days",
    awaiting_your_acceptance: (orders || []).filter(o => o.assignment_status === "offered").map(o => ({ customer: o.customer_name, city: o.customer_city })),
    active_deliveries: (orders || []).filter(o => o.assignment_status === "accepted" && o.order_status !== "delivered").length,
    delivered_this_period: (orders || []).filter(o => o.order_status === "delivered").length,
  };
}
