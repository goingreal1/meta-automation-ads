import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Receives Paystack's charge.success events for Dedicated Virtual Account
// deposits. A DVA is per MEDIA BUYER now (not per customer/order) -- every
// one of that buyer's customers pays into the same account, so Paystack's
// webhook tells us which buyer generated the revenue immediately, but not
// which specific order the deposit paid for. That's resolved here, in order
// of confidence:
//   1. The transfer narration contains the order's payment_narration_code
//      (customers are asked to include it, but not every bank app preserves
//      a custom narration -- some auto-fill it with the sender's own
//      details instead, so this only works when it comes through).
//   2. Sender name (from Paystack's authorization object) + exact amount
//      match a single pending order for that buyer.
//   3. Neither -- logged unmatched for manual reconciliation rather than
//      guessed.
// A confirmed match marks the order delivered (this webhook, or the delivery agent, are the only ways an order
// becomes delivered) and triggers a "payment received" WhatsApp alert to both the customer and the delivery agent.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function hmacSha512Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeName(s: string | undefined | null): string {
  return (s ?? "").toLowerCase().replace(/[^a-z\s]/g, "").trim();
}

// Same person, different word order or an extra middle name ("THANKGOD OLUWASEUN NDIDI" vs "Ndidi ThankGod Oluwaseun"):
// every word of the shorter name must appear in the longer one, and at least two words must be shared (or the whole one-word name).
function sameName(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const ta = a.split(/\s+/).filter(Boolean), tb = b.split(/\s+/).filter(Boolean);
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const shared = small.filter((w) => big.includes(w)).length;
  return shared === small.length && (shared >= 2 || small.length === 1);
}

async function notifyPaymentConfirmed(orderId: string) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-payment-whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ order_id: orderId, type: "payment_confirmed" }),
    });
  } catch (err) {
    console.error("notifyPaymentConfirmed failed:", err);
  }
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-internal-whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ order_id: orderId, type: "payment_confirmed_admin" }),
    });
  } catch (err) {
    console.error("send-internal-whatsapp (payment_confirmed_admin) failed:", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!PAYSTACK_SECRET_KEY) return new Response("Not configured", { status: 500 });

  const rawBody = await req.text();

  const signature = req.headers.get("x-paystack-signature") ?? "";
  const expected = await hmacSha512Hex(PAYSTACK_SECRET_KEY, rawBody);
  if (signature !== expected) {
    console.error("paystack-webhook: signature mismatch");
    return new Response("Invalid signature", { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("ok", { status: 200 });
  }

  try {
    // Revora's own subscription payments (started from Settings -> Billing). Idempotent on the reference.
    if (event?.event === "charge.success" && event?.data?.metadata?.kind === "subscription") {
      const d = event.data, md = d.metadata;
      const plans: Record<string, number> = { media_buyer: 10000, business: 25000 };
      const months = Number(md.months);
      const due = plans[md.plan] * (months === 12 ? 10 : months);
      if (plans[md.plan] && md.company_id && Number(d.amount) / 100 >= due) {
        const { error } = await supabase.rpc("apply_subscription_payment", { p_reference: d.reference, p_company: md.company_id, p_plan: md.plan, p_months: months, p_amount: Number(d.amount) / 100, p_raw: d });
        if (error) console.error("paystack-webhook subscription error:", error.message);
      } else console.error("paystack-webhook: subscription payment did not match a plan", d.reference);
      return new Response("ok", { status: 200 });
    }

    if (event?.event === "charge.success" && event?.data?.channel === "dedicated_nuban") {
      const data = event.data;
      const customerCode = data.customer?.customer_code;
      const amountNaira = Number(data.amount ?? 0) / 100;
      const reference = data.reference;
      const narration = String(data.authorization?.narration ?? "");
      const senderName = normalizeName(data.authorization?.sender_name);
      // Who sent it and from which bank, so an admin can trace a payment that could not be matched to an order.
      const sender = {
        sender_name: data.authorization?.sender_name ?? null,
        sender_bank: data.authorization?.sender_bank ?? null,
        sender_account: data.authorization?.sender_bank_account_number ?? null,
        narration: narration || null,
      };

      // Paystack retries webhooks: a reference we already confirmed must never confirm (or deliver) anything twice.
      if (reference) {
        const { data: seen } = await supabase.from("payments").select("id").eq("paystack_reference", reference).eq("status", "confirmed").limit(1);
        if (seen && seen.length) return new Response("ok", { status: 200 });
      }

      // Company-level DVA (admin depositing their own money) -- always
      // auto-confirmed on arrival, no order to match against since it was
      // never tied to a customer order in the first place.
      const { data: company } = await supabase
        .from("companies")
        .select("id")
        .eq("paystack_customer_code", customerCode)
        .maybeSingle();
      if (company) {
        const { error } = await supabase.from("payments").insert({
          company_id: company.id, order_id: null, media_buyer_id: null,
          amount_naira: amountNaira, status: "confirmed", source: "admin_topup",
          channel: data.channel, paid_at: new Date().toISOString(),
          paystack_reference: reference, raw_event: event, ...sender,
        });
        if (error) console.error("paystack-webhook admin_topup insert error:", error.message);
        return new Response("ok", { status: 200 });
      }

      const { data: buyer } = await supabase
        .from("media_buyers")
        .select("id, company_id")
        .eq("paystack_customer_code", customerCode)
        .maybeSingle();

      if (!buyer) {
        await supabase.from("payments").insert({
          company_id: null, order_id: null, media_buyer_id: null,
          amount_naira: amountNaira, status: "unmatched", channel: data.channel,
          paystack_reference: reference, raw_event: event, ...sender,
        });
        return new Response("ok", { status: 200 });
      }

      // 1. Narration contains the order's code -- exact match.
      let matchedOrderId: string | null = null;
      const { data: codeOrders } = await supabase
        .from("orders")
        .select("id, payment_narration_code, customer_name")
        .eq("media_buyer_id", buyer.id)
        .not("payment_narration_code", "is", null);
      for (const o of codeOrders ?? []) {
        if (o.payment_narration_code && narration.toUpperCase().includes(o.payment_narration_code)) {
          matchedOrderId = o.id;
          break;
        }
      }
      // A code in the narration proves which order it is for, but not that the whole price was paid.
      // Part payments are left for a person to reconcile instead of marking the order delivered.
      if (matchedOrderId) {
        const { data: ord } = await supabase.from("orders").select("order_value_naira").eq("id", matchedOrderId).maybeSingle();
        if (ord && Number(ord.order_value_naira ?? 0) - amountNaira > 1) matchedOrderId = null;
      }

      // 2. Sender name + exact amount, among this buyer's pending payments.
      if (!matchedOrderId) {
        const { data: pending } = await supabase
          .from("payments")
          .select("id, order_id, orders!inner(customer_name)")
          .eq("media_buyer_id", buyer.id)
          .eq("status", "pending")
          .eq("amount_naira", amountNaira);
        const nameMatches = (pending ?? []).filter((p: any) => {
          const custName = normalizeName(p.orders?.customer_name);
          return sameName(senderName, custName);
        });
        if (nameMatches.length === 1) matchedOrderId = (nameMatches[0] as any).order_id;
      }

      // 3. Orders still waiting for this money: this buyer's unpaid orders worth exactly this amount (pay-on-delivery orders
      //    have no waiting payment row). The sender's name picks the order; if the name does not match (a POS, someone paying
      //    for a friend), a single order at this price that customer care has already confirmed (valid) is taken as the one.
      if (!matchedOrderId) {
        const { data: open } = await supabase
          .from("orders")
          .select("id, customer_name, order_status, payments(status)")
          .eq("media_buyer_id", buyer.id)
          .in("order_status", ["pending", "valid"])
          .eq("order_value_naira", amountNaira);
        const unpaid = (open ?? []).filter((o: any) => !(o.payments ?? []).some((p: any) => p.status === "confirmed"));
        const byName = unpaid.filter((o: any) => {
          const custName = normalizeName(o.customer_name);
          return sameName(senderName, custName);
        });
        if (byName.length === 1) matchedOrderId = (byName[0] as any).id;
        else if (unpaid.length === 1 && (unpaid[0] as any).order_status === "valid") matchedOrderId = (unpaid[0] as any).id;
      }

      if (matchedOrderId) {
        const { error } = await supabase.from("payments").update({
          status: "confirmed", paid_at: new Date().toISOString(),
          paystack_reference: reference, channel: data.channel, raw_event: event, ...sender,
        }).eq("order_id", matchedOrderId);
        if (error) console.error("paystack-webhook update error:", error.message);
        else {
          // The order may have had no pending payment row to update; make sure a confirmed one exists.
          const { data: confirmedRow } = await supabase.from("payments").select("id").eq("order_id", matchedOrderId).eq("status", "confirmed").limit(1);
          if (!confirmedRow || !confirmedRow.length) {
            await supabase.from("payments").insert({
              company_id: buyer.company_id, order_id: matchedOrderId, media_buyer_id: buyer.id,
              amount_naira: amountNaira, status: "confirmed", paid_at: new Date().toISOString(),
              channel: data.channel, paystack_reference: reference, raw_event: event, ...sender,
            });
          }
          // A matched payment is the proof of delivery: mark the order delivered (never reopen a cancelled/returned one).
          await supabase.from("orders").update({ order_status: "delivered", delivered_at: new Date().toISOString() })
            .eq("id", matchedOrderId).in("order_status", ["pending", "valid"]);
          await notifyPaymentConfirmed(matchedOrderId);
        }
      } else {
        // No order could be matched (a POS or bank app often changes the sender name). The money is real, so it is held in
        // the COMPANY funding wallet right away: stored as a company-level confirmed deposit that remembers which buyer's
        // account it arrived in. The buyer cannot spend it. An admin can later match it to an order, which moves it out.
        await supabase.from("payments").insert({
          company_id: buyer.company_id, order_id: null, media_buyer_id: null,
          amount_naira: amountNaira, status: "confirmed", source: "admin_topup", channel: data.channel,
          paid_at: new Date().toISOString(), paystack_reference: reference, raw_event: event,
          held_for_buyer_id: buyer.id, held_reason: "No order matched this deposit", ...sender,
        });
      }
    }

    return new Response("ok", { status: 200 });
  } catch (err: any) {
    console.error("paystack-webhook error:", err);
    return new Response("ok", { status: 200 });
  }
});
