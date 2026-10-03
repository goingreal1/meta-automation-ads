import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// The per-buyer "wallet balance" shown in the dashboard is a computed
// ledger on our own side (confirmed payments minus approved/sent
// amounts) -- it is NOT a real segregated pot of money per buyer.
// Transfers all pull from the ONE shared Paystack merchant balance
// (source: "balance" in paystack-transfer-to-meta). If the sum of what's
// approved-but-not-yet-sent across every buyer ever exceeds what's
// actually sitting in that real balance, a transfer would fail at
// Paystack's end. This lets an admin check the real number before
// approving, rather than approving blind.
//
//   POST { access_token } -> { balance_naira } (owner/admin only)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const PAYSTACK_BASE = "https://api.paystack.co";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
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
    const { access_token } = await req.json();
    const { data: userData } = await supabase.auth.getUser(access_token);
    if (!userData?.user) return json({ error: "Unauthorized" }, 401);
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
    if (!profile || !["owner", "admin"].includes(profile.role)) return json({ error: "Unauthorized" }, 401);

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
