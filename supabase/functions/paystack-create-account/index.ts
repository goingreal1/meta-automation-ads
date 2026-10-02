import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Creates (or reuses) a Paystack Dedicated Virtual Account for a customer,
// so they can pay for their order by bank transfer with zero manual
// confirmation on our side -- a webhook (paystack-webhook) marks the
// payment confirmed the moment it lands. One DVA per customer phone number
// (Paystack ties a DVA to a customer, not to a single order), reused across
// all of that customer's future orders.
//
//   POST { order_id } -> { account_number, bank_name, account_name, amount_naira }

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" },
    });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!PAYSTACK_SECRET_KEY) return json({ error: "PAYSTACK_SECRET_KEY isn't configured yet." }, 500);

  try {
    const { order_id } = await req.json();
    if (!order_id) return json({ error: "order_id is required" }, 400);

    const { data: order } = await supabase
      .from("orders")
      .select("id, company_id, media_buyer_id, customer_name, customer_phone, customer_email, order_value_naira")
      .eq("id", order_id)
      .maybeSingle();
    if (!order) return json({ error: "Order not found" }, 404);
    if (!order.customer_phone) return json({ error: "Order has no customer phone number -- can't create a payment account." }, 400);

    // Reuse an existing DVA for this customer if we already made one.
    const { data: existing } = await supabase
      .from("paystack_customers")
      .select("paystack_customer_code, dedicated_account_number, dedicated_account_bank")
      .eq("company_id", order.company_id)
      .eq("customer_phone", order.customer_phone)
      .maybeSingle();

    let accountNumber = existing?.dedicated_account_number ?? null;
    let bankName = existing?.dedicated_account_bank ?? null;

    if (!accountNumber) {
      // Paystack requires an email on every customer -- most COD orders
      // don't have a real one, so a deterministic placeholder stands in.
      const email = order.customer_email || `${order.customer_phone.replace(/\D/g, "")}@noemail.customer`;
      const [firstName, ...rest] = (order.customer_name || "Customer").trim().split(" ");

      const customer = await paystackFetch("/customer", {
        method: "POST",
        body: JSON.stringify({ email, phone: order.customer_phone, first_name: firstName, last_name: rest.join(" ") || "Customer" }),
      });
      const customerCode = customer.data.customer_code;

      const dva = await paystackFetch("/dedicated_account", {
        method: "POST",
        body: JSON.stringify({ customer: customerCode, preferred_bank: PAYSTACK_PREFERRED_BANK }),
      });
      accountNumber = dva.data.account_number;
      bankName = dva.data.bank?.name ?? PAYSTACK_PREFERRED_BANK;

      const { error: upsertErr } = await supabase.from("paystack_customers").upsert({
        company_id: order.company_id,
        customer_phone: order.customer_phone,
        paystack_customer_code: customerCode,
        dedicated_account_number: accountNumber,
        dedicated_account_bank: bankName,
      }, { onConflict: "company_id,customer_phone" });
      if (upsertErr) throw upsertErr;
    }

    // One pending payment row per order -- the webhook matches a deposit to
    // the oldest pending row for this customer with a matching amount.
    const { error: payErr } = await supabase.from("payments").upsert({
      company_id: order.company_id,
      order_id: order.id,
      media_buyer_id: order.media_buyer_id,
      amount_naira: order.order_value_naira,
      status: "pending",
    }, { onConflict: "order_id", ignoreDuplicates: true });
    if (payErr) throw payErr;

    return json({
      account_number: accountNumber,
      bank_name: bankName,
      account_name: order.customer_name || "Customer",
      amount_naira: order.order_value_naira,
    });
  } catch (err: any) {
    console.error("paystack-create-account error:", err);
    return json({ error: err.message }, 500);
  }
});
