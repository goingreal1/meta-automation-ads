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
async function hmacSha512Hex(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), {
    name: "HMAC",
    hash: "SHA-512"
  }, false, [
    "sign"
  ]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b)=>b.toString(16).padStart(2, "0")).join("");
}
function normalizeName(s) {
  return (s ?? "").toLowerCase().replace(/[^a-z\s]/g, "").trim();
}
// Same person, different word order or an extra middle name ("THANKGOD OLUWASEUN NDIDI" vs "Ndidi ThankGod Oluwaseun"):
// every word of the shorter name must appear in the longer one, and at least two words must be shared (or the whole one-word name).
function sameName(a, b) {
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const ta = a.split(/\s+/).filter(Boolean), tb = b.split(/\s+/).filter(Boolean);
  const [small, big] = ta.length <= tb.length ? [
    ta,
    tb
  ] : [
    tb,
    ta
  ];
  const shared = small.filter((w)=>big.includes(w)).length;
  return shared === small.length && (shared >= 2 || small.length === 1);
}
async function notifyPaymentConfirmed(orderId) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-payment-whatsapp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        order_id: orderId,
        type: "payment_confirmed"
      })
    });
  } catch (err) {
    console.error("notifyPaymentConfirmed failed:", err);
  }
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-internal-whatsapp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        order_id: orderId,
        type: "payment_confirmed_admin"
      })
    });
  } catch (err) {
    console.error("send-internal-whatsapp (payment_confirmed_admin) failed:", err);
  }
}
Deno.serve(async (req)=>{
  if (req.method !== "POST") return new Response("POST only", {
    status: 405
  });
  if (!PAYSTACK_SECRET_KEY) return new Response("Not configured", {
    status: 500
  });
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature") ?? "";
  const expected = await hmacSha512Hex(PAYSTACK_SECRET_KEY, rawBody);
  if (signature !== expected) {
    console.error("paystack-webhook: signature mismatch");
    return new Response("Invalid signature", {
      status: 401
    });
  }
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch  {
    return new Response("ok", {
      status: 200
    });
  }
  try {
    // Revora's own subscription payments (started from Settings -> Billing). Idempotent on the reference.
    if (event?.event === "charge.success" && event?.data?.metadata?.kind === "subscription") {
      const d = event.data, md = d.metadata;
      const plans = {
        media_buyer: 5000,
        business: 25000
      };
      const months = Number(md.months);
      const due = plans[md.plan] * (months === 12 ? 10 : months);
      if (plans[md.plan] && md.company_id && Number(d.amount) / 100 >= due) {
        const { error } = await supabase.rpc("apply_subscription_payment", {
          p_reference: d.reference,
          p_company: md.company_id,
          p_plan: md.plan,
          p_months: months,
          p_amount: Number(d.amount) / 100,
          p_raw: d
        });
        if (error) console.error("paystack-webhook subscription error:", error.message);
      } else console.error("paystack-webhook: subscription payment did not match a plan", d.reference);
      return new Response("ok", {
        status: 200
      });
    }
    // Order-confirmation deposit paid through Paystack Checkout (started from a thank-you page). Only records the deposit on the
    // order; it never touches payments or the delivered status. Idempotent: an order already paid/refunded/forfeited is left alone.
    if (event?.event === "charge.success" && event?.data?.metadata?.kind === "order_deposit") {
      const d = event.data, md = d.metadata;
      const orderId = typeof md?.order_id === "string" ? md.order_id : "";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
        const { data: ord } = await supabase.from("orders").select("id, deposit_amount_naira, deposit_status").eq("id", orderId).maybeSingle();
        if (ord && (ord.deposit_status === null || ord.deposit_status === "pending") && Number(d.amount) === Math.round(Number(ord.deposit_amount_naira ?? 0) * 100)) {
          const { error } = await supabase.from("orders").update({
            deposit_status: "paid",
            deposit_paid_at: new Date().toISOString(),
            deposit_reference: d.reference
          }).eq("id", ord.id);
          if (error) console.error("paystack-webhook order_deposit update error:", error.message);
        } else if (!ord) {
          console.error("paystack-webhook: order_deposit for unknown order", orderId, d.reference);
        }
      }
      return new Response("ok", {
        status: 200
      });
    }
    // Outgoing transfers: the bank has confirmed (or refused) a transfer we sent. Update its receipt.
    if (event?.event === "transfer.success" || event?.event === "transfer.failed" || event?.event === "transfer.reversed") {
      const t = event.data ?? {};
      const code = String(t.transfer_code ?? ""), ref = String(t.reference ?? "");
      const ok = event.event === "transfer.success";
      const why = ok ? null : String(t.reason ?? t.failures ?? event.event.replace("transfer.", "")).slice(0, 200);
      const { data: rcs } = await supabase.from("transfer_receipts").select("id, status, kind").or(`paystack_transfer_code.eq.${code},paystack_reference.eq.${ref}`).limit(5);
      for (const r of rcs ?? []){
        if (r.status === "delivered" && !ok) continue; // a later reversal is handled below only if it follows a failure
        await supabase.from("transfer_receipts").update({
          status: ok ? "delivered" : "failed",
          failure_reason: why,
          updated_at: new Date().toISOString()
        }).eq("id", r.id);
      }
      if (!ok) {
        // Money did not arrive: give it back to the wallet / let the funding request be sent again.
        if (code) {
          const { data: wds } = await supabase.from("admin_withdrawals").select("id").eq("paystack_transfer_code", code).eq("status", "sent");
          await supabase.from("admin_withdrawals").update({
            status: "failed",
            transfer_error: why
          }).eq("paystack_transfer_code", code).eq("status", "sent");
          // The money is back in the wallet, and so is Revora's fee.
          for (const w of wds ?? []) await supabase.rpc("rv_refund_fee", { p_kind: "transfer", p_ref: String(w.id) });
          await supabase.from("fund_requests").update({
            status: "approved",
            paystack_transfer_code: null,
            paystack_transfer_reference: null,
            transferred_at: null,
            transfer_error: why
          }).eq("paystack_transfer_code", code).eq("status", "transferred");
        }
      }
      return new Response("ok", {
        status: 200
      });
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
        narration: narration || null
      };
      // Paystack retries webhooks: a reference we already confirmed must never confirm (or deliver) anything twice.
      if (reference) {
        const { data: seen } = await supabase.from("payments").select("id").eq("paystack_reference", reference).eq("status", "confirmed").limit(1);
        if (seen && seen.length) return new Response("ok", {
          status: 200
        });
      }
      // Two kinds of dedicated account now:
      //  - the COMPANY account is what customers are sent to pay for orders (any of the company's media buyers);
      //  - a media buyer's own account is their wallet top-up account, usable from any bank.
      const paystackFee = Number(data.fees ?? 0) / 100;
      const findOrder = async (scope, strict)=>{
        const own = (q)=>scope.buyerId ? q.eq("media_buyer_id", scope.buyerId) : q.eq("company_id", scope.companyId);
        // 1. The narration carries the order's payment code.
        const { data: codeOrders } = await own(supabase.from("orders").select("id, payment_narration_code, order_value_naira").not("payment_narration_code", "is", null).in("order_status", ["pending", "valid", "delivered"]));
        for (const o of codeOrders ?? []){
          if (o.payment_narration_code && narration.toUpperCase().includes(o.payment_narration_code)) {
            // A code proves which order, not that the whole price was paid: part payments are left for a person.
            return Number(o.order_value_naira ?? 0) - amountNaira > 1 ? null : o.id;
          }
        }
        // 2. Sender name + exact amount among pending payments.
        const { data: pending } = await own(supabase.from("payments").select("id, order_id, orders!inner(customer_name)").eq("status", "pending").eq("amount_naira", amountNaira));
        const nm = (pending ?? []).filter((p)=>sameName(senderName, normalizeName(p.orders?.customer_name)));
        if (nm.length === 1) return nm[0].order_id;
        // 3. Unpaid orders worth exactly this amount: the sender's name picks one.
        const { data: open } = await own(supabase.from("orders").select("id, customer_name, order_status, payments(status)").in("order_status", ["pending", "valid"]).eq("order_value_naira", amountNaira));
        const unpaid = (open ?? []).filter((o)=>!(o.payments ?? []).some((p)=>p.status === "confirmed"));
        const byName = unpaid.filter((o)=>sameName(senderName, normalizeName(o.customer_name)));
        if (byName.length === 1) return byName[0].id;
        // Only on the company's customer account: a single order at this price that customer care already confirmed is taken as the one.
        if (!strict && unpaid.length === 1 && unpaid[0].order_status === "valid") return unpaid[0].id;
        return null;
      };
      const confirmOrder = async (orderId)=>{
        const { data: ordRow } = await supabase.from("orders").select("company_id, media_buyer_id").eq("id", orderId).maybeSingle();
        const { error } = await supabase.from("payments").update({
          status: "confirmed",
          paid_at: new Date().toISOString(),
          paystack_reference: reference,
          channel: data.channel,
          raw_event: event,
          ...sender
        }).eq("order_id", orderId);
        if (error) { console.error("paystack-webhook update error:", error.message); return; }
        // The order may have had no pending payment row to update; make sure a confirmed one exists.
        const { data: confirmedRow } = await supabase.from("payments").select("id").eq("order_id", orderId).eq("status", "confirmed").limit(1);
        if (!confirmedRow || !confirmedRow.length) {
          await supabase.from("payments").insert({
            company_id: ordRow?.company_id ?? null,
            order_id: orderId,
            media_buyer_id: ordRow?.media_buyer_id ?? null,
            amount_naira: amountNaira,
            status: "confirmed",
            paid_at: new Date().toISOString(),
            channel: data.channel,
            paystack_reference: reference,
            raw_event: event,
            ...sender
          });
        }
        // A matched payment is the proof of delivery: mark the order delivered (never reopen a cancelled/returned one).
        await supabase.from("orders").update({
          order_status: "delivered",
          delivered_at: new Date().toISOString()
        }).eq("id", orderId).in("order_status", ["pending", "valid"]);
        await notifyPaymentConfirmed(orderId);
      };
      const { data: company } = await supabase.from("companies").select("id").eq("paystack_customer_code", customerCode).maybeSingle();
      if (company) {
        const orderId = await findOrder({ companyId: company.id }, false);
        if (orderId) { await confirmOrder(orderId); return new Response("ok", { status: 200 }); }
        // No order matched: the money is real, so it sits in the company funding wallet. An admin can match it to an order later.
        const { error } = await supabase.from("payments").insert({
          company_id: company.id,
          order_id: null,
          media_buyer_id: null,
          amount_naira: amountNaira,
          status: "confirmed",
          source: "admin_topup",
          channel: data.channel,
          paid_at: new Date().toISOString(),
          paystack_reference: reference,
          raw_event: event,
          held_reason: "No order matched this deposit",
          ...sender
        });
        if (error) console.error("paystack-webhook company deposit insert error:", error.message);
        return new Response("ok", { status: 200 });
      }
      const { data: buyer } = await supabase.from("media_buyers").select("id, company_id").eq("paystack_customer_code", customerCode).maybeSingle();
      if (!buyer) {
        await supabase.from("payments").insert({
          company_id: null,
          order_id: null,
          media_buyer_id: null,
          amount_naira: amountNaira,
          status: "unmatched",
          channel: data.channel,
          paystack_reference: reference,
          raw_event: event,
          ...sender
        });
        return new Response("ok", { status: 200 });
      }
      // A media buyer's own account. Customers used to pay here, so a deposit that clearly belongs to one of their orders
      // (the order's payment code, or the customer's name and the exact price) is still applied to that order.
      const legacyOrder = await findOrder({ buyerId: buyer.id, companyId: buyer.company_id }, true);
      if (legacyOrder) { await confirmOrder(legacyOrder); return new Response("ok", { status: 200 }); }
      // Otherwise it is the buyer topping up their wallet from any bank. Paystack's fee and Revora's deposit fee come off what lands.
      const credited = Math.max(0, Math.round((amountNaira - paystackFee) * 100) / 100);
      const { data: seenTop } = await supabase.from("wallet_topups").select("id").eq("reference", reference).limit(1);
      if (seenTop && seenTop.length) return new Response("ok", { status: 200 });
      const { error: topErr } = await supabase.from("wallet_topups").insert({
        company_id: buyer.company_id,
        media_buyer_id: buyer.id,
        amount_naira: credited,
        reference,
        status: "confirmed",
        channel: "bank_transfer",
        created_by: null,
        confirmed_at: new Date().toISOString(),
        charged_naira: amountNaira,
        paystack_fee_naira: paystackFee
      });
      if (topErr) { console.error("paystack-webhook wallet top-up insert error:", topErr.message); return new Response("ok", { status: 200 }); }
      const { data: fee } = await supabase.rpc("rv_fee", { p_kind: "deposit", p_amount: credited });
      const take = Math.min(Number(fee ?? 0), credited);
      if (take > 0) await supabase.rpc("rv_take_fee", { p_kind: "deposit", p_company: buyer.company_id, p_buyer: buyer.id, p_user: null, p_amount: credited, p_fee: take, p_ref: reference, p_note: "Deposit fee on bank transfer" });
      const { data: bprof } = await supabase.from("profiles").select("id").eq("media_buyer_id", buyer.id).eq("role", "buyer").limit(1).maybeSingle();
      await supabase.rpc("rv_notify", { p_company: buyer.company_id, p_category: "money", p_kind: "wallet_deposit", p_title: `💰 ${"₦" + Math.round(credited - take).toLocaleString("en-NG")} added to your wallet`,
        p_body: `Bank transfer received${data.authorization?.sender_name ? " from " + data.authorization.sender_name : ""}. Fees: ₦${Math.round(paystackFee + take).toLocaleString("en-NG")}.`, p_url: "/dashboard_new.html?open=tab:wallet", p_severity: "success", p_data: { reference }, p_dedupe: "dva:" + reference, p_buyer: null, p_user: bprof?.id ?? null, p_push: true });
    }
    return new Response("ok", {
      status: 200
    });
  } catch (err) {
    console.error("paystack-webhook error:", err);
    return new Response("ok", {
      status: 200
    });
  }
});
