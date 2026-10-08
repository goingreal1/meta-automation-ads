import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Two jobs, both owner/admin only, both authenticated by the caller's own session token.
//
// 1. Funding wallet check (the original job). The per-buyer "wallet balance" shown in the
//    dashboard is a computed ledger on our own side, not a real segregated pot of money.
//    Transfers all pull from the ONE shared Paystack merchant balance, so an admin can check
//    the real number before approving a request.
//      POST { access_token }                                  -> { balance_naira }
//
// 2. Revora subscription billing (function slots are capped, so it lives here).
//      POST { access_token, action: "billing_status" }        -> plan, trial and expiry
//      POST { access_token, action: "subscribe", plan, months, return_url } -> { authorization_url }
//      POST { access_token, action: "verify", reference }     -> activates the plan once Paystack confirms
//    The paystack-webhook function applies the same payment too; apply_subscription_payment is
//    idempotent on the Paystack reference, so whichever arrives first wins and the other is a no-op.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const PAYSTACK_BASE = "https://api.paystack.co";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Naira per month. Prices live here, never in the browser. 12 months = 10 months' price.
const PLANS: Record<string, { label: string; monthly: number }> = {
  media_buyer: { label: "Media buyer", monthly: 10000 },
  business: { label: "Business", monthly: 25000 },
};
const MONTHS = [1, 3, 6, 12];
const priceFor = (plan: string, months: number) => PLANS[plan].monthly * (months === 12 ? 10 : months);

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

async function billingState(companyId: string) {
  const { data: c } = await supabase.from("companies").select("name, plan, trial_ends_at, plan_expires_at, team_size, buyers_count, monthly_ad_spend, account_type").eq("id", companyId).maybeSingle();
  if (!c) return null;
  const now = Date.now();
  const trialEnd = c.trial_ends_at ? new Date(c.trial_ends_at).getTime() : 0;
  const planEnd = c.plan_expires_at ? new Date(c.plan_expires_at).getTime() : 0;
  let state: "comped" | "active" | "trialing" | "expired" = "expired";
  if (c.plan === "comped") state = "comped";
  else if (c.plan_expires_at && planEnd > now) state = "active";
  else if (c.plan === "trial" && trialEnd > now) state = "trialing";
  const daysLeft = state === "trialing" ? Math.ceil((trialEnd - now) / 86400000) : state === "active" ? Math.ceil((planEnd - now) / 86400000) : 0;
  // Suggest a plan from what they told us at sign-up.
  const big = (c.buyers_count ?? 0) > 5 || c.team_size === "50+" || c.team_size === "21-50";
  const solo = c.account_type === "personal" || c.team_size === "1";
  const suggested = big ? "enterprise" : solo ? "media_buyer" : "business";
  return { company: c.name, plan: c.plan, state, days_left: daysLeft, trial_ends_at: c.trial_ends_at, plan_expires_at: c.plan_expires_at, suggested_plan: suggested, plans: PLANS, months: MONTHS };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" },
    });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!PAYSTACK_SECRET_KEY) return json({ error: "PAYSTACK_SECRET_KEY isn't configured yet." }, 500);

  try {
    const body = await req.json();
    const { data: userData } = await supabase.auth.getUser(body?.access_token);
    if (!userData?.user) return json({ error: "Unauthorized" }, 401);
    const { data: profile } = await supabase.from("profiles").select("role, company_id").eq("id", userData.user.id).maybeSingle();
    if (!profile) return json({ error: "Unauthorized" }, 401);
    const action = String(body?.action ?? "balance");

    // Any signed-in member may see the plan state (the dashboard needs it to show the trial banner or lock screen).
    if (action === "billing_status") {
      const st = await billingState(profile.company_id);
      return json({ ...st, can_manage: ["owner", "admin"].includes(profile.role) });
    }

    if (!["owner", "admin"].includes(profile.role)) return json({ error: "Unauthorized" }, 401);

    if (action === "subscribe") {
      const plan = String(body?.plan ?? "");
      const months = Number(body?.months ?? 1);
      if (!PLANS[plan]) return json({ error: "Pick the Media buyer or Business plan. Enterprise is arranged with us directly." }, 400);
      if (!MONTHS.includes(months)) return json({ error: "Choose 1, 3, 6 or 12 months." }, 400);
      const amount = priceFor(plan, months);
      const reference = `rv_${profile.company_id.slice(0, 8)}_${Date.now()}`;
      let callback = String(body?.return_url ?? "");
      if (!/^https:\/\/[^\s]+$/.test(callback)) callback = "";
      const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
        method: "POST",
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userData.user.email, amount: amount * 100, currency: "NGN", reference,
          ...(callback ? { callback_url: callback } : {}),
          metadata: { kind: "subscription", company_id: profile.company_id, plan, months, custom_fields: [{ display_name: "Plan", variable_name: "plan", value: `${PLANS[plan].label} x ${months} mo` }] },
        }),
      });
      const d = await res.json();
      if (!res.ok || !d?.status) throw new Error(d?.message || "Could not start the payment");
      return json({ authorization_url: d.data.authorization_url, reference, amount_naira: amount });
    }

    if (action === "verify") {
      const reference = String(body?.reference ?? "");
      if (!/^rv_[A-Za-z0-9_-]+$/.test(reference)) return json({ error: "Bad reference" }, 400);
      const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } });
      const d = await res.json();
      if (!res.ok || !d?.status) throw new Error(d?.message || "Could not verify the payment");
      const t = d.data;
      if (t.status !== "success") return json({ ok: false, status: t.status });
      const md = t.metadata ?? {};
      if (md.kind !== "subscription" || md.company_id !== profile.company_id) return json({ error: "This payment belongs to a different company." }, 403);
      const paid = Number(t.amount) / 100;
      if (!PLANS[md.plan] || paid < priceFor(md.plan, Number(md.months))) return json({ error: "The amount paid does not match the plan." }, 400);
      const { error } = await supabase.rpc("apply_subscription_payment", { p_reference: reference, p_company: profile.company_id, p_plan: md.plan, p_months: Number(md.months), p_amount: paid, p_raw: t });
      if (error) throw new Error(error.message);
      return json({ ok: true, ...(await billingState(profile.company_id)) });
    }

    const res = await fetch(`${PAYSTACK_BASE}/balance`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } });
    const data = await res.json();
    if (!res.ok || data?.status === false) throw new Error(data?.message || "Could not fetch Paystack balance");

    const ngn = (data.data ?? []).find((b: any) => b.currency === "NGN");
    return json({ balance_naira: ngn ? Number(ngn.balance) / 100 : null });
  } catch (err: any) {
    console.error("paystack-balance error:", err);
    return json({ error: err.message }, 500);
  }
});
