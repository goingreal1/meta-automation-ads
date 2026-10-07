import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Creates (or reuses) ONE Paystack Dedicated Virtual Account per media
// buyer -- not per order, not per customer. Every one of that buyer's
// customers pays into the same account, which means any deposit is
// automatically known to be revenue that buyer generated -- no
// customer-matching needed for attribution. The money still settles to
// the platform's own Paystack merchant balance either way; the buyer's
// "wallet" is a computed ledger number (sum of confirmed payments), never
// actual banking access -- they can't send or move money, only see it.
//
// Per-order matching (which specific order a deposit paid for, needed for
// fulfillment) is handled separately in paystack-webhook, using the
// narration code this function also assigns each order.
//
//   POST { media_buyer_id } -> { account_number, bank_name, account_name }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
// Paystack's test mode only provisions DVAs against specific sandbox banks;
// override via secret once you know which one your account supports.
const PAYSTACK_PREFERRED_BANK = Deno.env.get("PAYSTACK_PREFERRED_BANK") ?? "test-bank";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const PAYSTACK_BASE = "https://api.paystack.co";

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

async function paystackFetch(path: string, init: RequestInit) {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.status === false) {
    throw new Error(body?.message || `Paystack ${path} failed (${res.status})`);
  }
  return body;
}

const SVC_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Internal-only: callers are other edge functions that send the service-role key.
async function isServiceCaller(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (SVC_KEY && token === SVC_KEY) return true;
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL") ?? ""}/auth/v1/admin/users?per_page=1`, { headers: { apikey: token, Authorization: `Bearer ${token}` } });
    return r.status === 200;
  } catch { return false; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" },
    });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!(await isServiceCaller(req))) return json({ error: "unauthorized" }, 401);
  if (!PAYSTACK_SECRET_KEY) return json({ error: "PAYSTACK_SECRET_KEY isn't configured yet." }, 500);

  try {
    const { media_buyer_id } = await req.json();
    if (!media_buyer_id) return json({ error: "media_buyer_id is required" }, 400);

    const { data: buyer } = await supabase
      .from("media_buyers")
      .select("id, company_id, name, code, paystack_customer_code, dedicated_account_number, dedicated_account_bank")
      .eq("id", media_buyer_id)
      .maybeSingle();
    if (!buyer) return json({ error: "Media buyer not found" }, 404);

    if (buyer.dedicated_account_number) {
      return json({ account_number: buyer.dedicated_account_number, bank_name: buyer.dedicated_account_bank, account_name: buyer.name });
    }

    // Paystack requires a valid-looking email on every customer -- buyers
    // don't necessarily have one on file, so a deterministic placeholder
    // stands in. ".internal" was rejected by Paystack's validator as not a
    // real TLD; ".com" passes.
    const email = `buyer-${buyer.id}@noemail.example.com`;

    const customer = await paystackFetch("/customer", {
      method: "POST",
      body: JSON.stringify({ email, first_name: buyer.name || buyer.code, last_name: "Media Buyer" }),
    });
    const customerCode = customer.data.customer_code;

    const dva = await paystackFetch("/dedicated_account", {
      method: "POST",
      body: JSON.stringify({ customer: customerCode, preferred_bank: PAYSTACK_PREFERRED_BANK }),
    });
    const accountNumber = dva.data.account_number;
    const bankName = dva.data.bank?.name ?? PAYSTACK_PREFERRED_BANK;

    const { error: updErr } = await supabase.from("media_buyers").update({
      paystack_customer_code: customerCode,
      dedicated_account_number: accountNumber,
      dedicated_account_bank: bankName,
    }).eq("id", buyer.id);
    if (updErr) throw updErr;

    return json({ account_number: accountNumber, bank_name: bankName, account_name: buyer.name });
  } catch (err: any) {
    console.error("paystack-create-account error:", err);
    return json({ error: err.message }, 500);
  }
});
