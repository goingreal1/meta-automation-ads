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
// Live keys need a real bank (wema-bank or titan-paystack); "test-bank" only exists in test mode.
const IS_LIVE = PAYSTACK_SECRET_KEY.startsWith("sk_live");
const _pref = Deno.env.get("PAYSTACK_PREFERRED_BANK") ?? "";
const PAYSTACK_PREFERRED_BANK = IS_LIVE ? (_pref && _pref !== "test-bank" ? _pref : "wema-bank") : (_pref || "test-bank");

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

// Live Paystack requires a phone number on every customer. Normalise Nigerian formats to +234XXXXXXXXXX.
function normPhone(raw: unknown): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("234")) return "+" + d;
  if (d.length === 11 && d.startsWith("0")) return "+234" + d.slice(1);
  if (d.length === 10 && !d.startsWith("0")) return "+234" + d;
  return null;
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
    const { media_buyer_id, email: givenEmail, phone: givenPhone } = await req.json();
    if (!media_buyer_id) return json({ error: "media_buyer_id is required" }, 400);

    const { data: buyer } = await supabase
      .from("media_buyers")
      .select("id, company_id, name, code, paystack_customer_code, dedicated_account_number, dedicated_account_bank")
      .eq("id", media_buyer_id)
      .maybeSingle();
    if (!buyer) return json({ error: "Media buyer not found" }, 404);

    const { data: co } = await supabase.from("companies").select("name").eq("id", buyer.company_id).maybeSingle();
    // What a paying customer sees as the account name: the company first, then the buyer, e.g. "OUTREACH HQ AMAKA".
    const displayName = `${co?.name ?? ""} ${buyer.name || buyer.code || ""}`.trim().slice(0, 60);
    if (buyer.dedicated_account_number) {
      return json({ account_number: buyer.dedicated_account_number, bank_name: buyer.dedicated_account_bank, account_name: displayName });
    }

    // Paystack requires a valid-looking email on every customer -- buyers
    // don't necessarily have one on file, so a deterministic placeholder
    // stands in. ".internal" was rejected by Paystack's validator as not a
    // real TLD; ".com" passes.
    const email = typeof givenEmail === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(givenEmail) ? givenEmail : `buyer-${buyer.id}@noemail.example.com`;

    const { data: prof } = await supabase.from("profiles").select("whatsapp_number").eq("media_buyer_id", buyer.id).maybeSingle();
    const phone = normPhone(givenPhone) ?? normPhone(prof?.whatsapp_number);
    if (!phone) return json({ error: "A phone number is needed to open this account (Paystack requires one). Add the buyer's WhatsApp number in their profile, then try again." }, 400);

    // first_name / last_name become the account name customers see when they pay.
    const names = { first_name: (co?.name || "Revora").slice(0, 30), last_name: (buyer.name || buyer.code || "Buyer").slice(0, 30), phone };
    const customer = await paystackFetch("/customer", { method: "POST", body: JSON.stringify({ email, ...names }) });
    const customerCode = customer.data.customer_code;
    // The customer may already exist from an earlier attempt without a phone: make sure it carries one.
    await paystackFetch(`/customer/${customerCode}`, { method: "PUT", body: JSON.stringify(names) }).catch(() => {});

    let dva;
    try {
      dva = await paystackFetch("/dedicated_account", { method: "POST", body: JSON.stringify({ customer: customerCode, preferred_bank: PAYSTACK_PREFERRED_BANK, ...names }) });
    } catch (e) {
      if (!IS_LIVE || PAYSTACK_PREFERRED_BANK === "titan-paystack") throw e;
      dva = await paystackFetch("/dedicated_account", { method: "POST", body: JSON.stringify({ customer: customerCode, preferred_bank: "titan-paystack", ...names }) });
    }
    const accountNumber = dva.data.account_number;
    const bankName = dva.data.bank?.name ?? PAYSTACK_PREFERRED_BANK;

    const { error: updErr } = await supabase.from("media_buyers").update({
      paystack_customer_code: customerCode,
      dedicated_account_number: accountNumber,
      dedicated_account_bank: bankName,
    }).eq("id", buyer.id);
    if (updErr) throw updErr;

    return json({ account_number: accountNumber, bank_name: bankName, account_name: dva.data.account_name || displayName });
  } catch (err: any) {
    console.error("paystack-create-account error:", err);
    return json({ error: err.message }, 500);
  }
});
