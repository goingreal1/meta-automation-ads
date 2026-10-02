import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Receives Paystack's charge.success events for Dedicated Virtual Account
// deposits and marks the matching order's payment confirmed -- no human
// ever has to click "mark paid." A DVA is per-customer, not per-order, so
// Paystack's webhook tells us who paid and how much, but not which order;
// matched here to that customer's oldest still-pending payment row with the
// same amount. Ambiguous matches (same customer, same amount, multiple
// pending orders at once) are left unmatched for manual reconciliation
// rather than guessed.

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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!PAYSTACK_SECRET_KEY) return new Response("Not configured", { status: 500 });

  const rawBody = await req.text();

  // Paystack signs every webhook with your secret key -- without this check,
  // anyone who finds this URL could fabricate a "payment confirmed" event.
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

      const { data: cust } = await supabase
        .from("paystack_customers")
        .select("company_id, customer_phone")
        .eq("paystack_customer_code", customerCode)
        .maybeSingle();

      if (!cust) {
        await supabase.from("payments").insert({
          company_id: null, order_id: null, media_buyer_id: null,
          amount_naira: amountNaira, status: "unmatched", channel: data.channel,
          paystack_reference: reference, raw_event: event,
        });
        return new Response("ok", { status: 200 });
      }

      // Oldest pending order for this customer with a matching amount.
      const { data: candidates } = await supabase
        .from("payments")
        .select("id, order_id, created_at")
        .eq("company_id", cust.company_id)
        .eq("status", "pending")
        .eq("amount_naira", amountNaira)
        .order("created_at", { ascending: true })
        .limit(2);

      if (candidates && candidates.length === 1) {
        const { error } = await supabase.from("payments").update({
          status: "confirmed", paid_at: new Date().toISOString(),
          paystack_reference: reference, channel: data.channel, raw_event: event,
        }).eq("id", candidates[0].id);
        if (error) console.error("paystack-webhook update error:", error.message);
      } else {
        // Zero or multiple (ambiguous) matches -- log it for manual review
        // rather than guess which order this deposit belongs to.
        await supabase.from("payments").insert({
          company_id: cust.company_id, order_id: null, media_buyer_id: null,
          amount_naira: amountNaira, status: "unmatched", channel: data.channel,
          paystack_reference: reference, raw_event: event,
        });
      }
    }

    return new Response("ok", { status: 200 });
  } catch (err: any) {
    console.error("paystack-webhook error:", err);
    // Still 200 -- Paystack retries on non-2xx, and we've already logged it.
    return new Response("ok", { status: 200 });
  }
});
