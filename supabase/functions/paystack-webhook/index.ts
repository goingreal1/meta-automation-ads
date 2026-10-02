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
// A confirmed match triggers a "payment received" WhatsApp alert to both
// the customer and the assigned delivery agent.

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
    if (event?.event === "charge.success" && event?.data?.channel === "dedicated_nuban") {
      const data = event.data;
      const customerCode = data.customer?.customer_code;
      const amountNaira = Number(data.amount ?? 0) / 100;
      const reference = data.reference;
      const narration = String(data.authorization?.narration ?? "");
      const senderName = normalizeName(data.authorization?.sender_name);

      const { data: buyer } = await supabase
        .from("media_buyers")
        .select("id, company_id")
        .eq("paystack_customer_code", customerCode)
        .maybeSingle();

      if (!buyer) {
        await supabase.from("payments").insert({
          company_id: null, order_id: null, media_buyer_id: null,
          amount_naira: amountNaira, status: "unmatched", channel: data.channel,
          paystack_reference: reference, raw_event: event,
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
          return senderName && custName && (senderName.includes(custName) || custName.includes(senderName));
        });
        if (nameMatches.length === 1) matchedOrderId = (nameMatches[0] as any).order_id;
      }

      if (matchedOrderId) {
        const { error } = await supabase.from("payments").update({
          status: "confirmed", paid_at: new Date().toISOString(),
          paystack_reference: reference, channel: data.channel, raw_event: event,
        }).eq("order_id", matchedOrderId);
        if (error) console.error("paystack-webhook update error:", error.message);
        else await notifyPaymentConfirmed(matchedOrderId);
      } else {
        await supabase.from("payments").insert({
          company_id: buyer.company_id, order_id: null, media_buyer_id: buyer.id,
          amount_naira: amountNaira, status: "unmatched", channel: data.channel,
          paystack_reference: reference, raw_event: event,
        });
      }
    }

    return new Response("ok", { status: 200 });
  } catch (err: any) {
    console.error("paystack-webhook error:", err);
    return new Response("ok", { status: 200 });
  }
});
