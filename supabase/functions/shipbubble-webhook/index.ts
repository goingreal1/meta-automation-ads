import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Receives Shipbubble shipment webhooks and keeps orders in sync.
// Auth: Shipbubble signs the raw body with HMAC-SHA512 using the account API key
// and sends it in the `x-ship-signature` header (no JWT, so verify_jwt = false).
// Key lookup: Edge Function secret SHIPBUBBLE_API_KEY wins; otherwise app_secrets.shipbubble_api_key.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
async function getApiKeys() {
  const keys = [];
  const env = Deno.env.get("SHIPBUBBLE_API_KEY");
  if (env) keys.push(env);
  const { data } = await supabase.from("app_secrets").select("value").eq("key", "shipbubble_api_key").maybeSingle();
  if (data?.value && !keys.includes(data.value)) keys.push(data.value);
  return keys;
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
async function hmacSha512Hex(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {
    name: "HMAC",
    hash: "SHA-512"
  }, false, [
    "sign"
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [
    ...new Uint8Array(sig)
  ].map((b)=>b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for(let i = 0; i < a.length; i++)d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function classify(status) {
  const s = (status ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if ([
    "completed",
    "delivered"
  ].includes(s)) return "delivered";
  if ([
    "picked_up",
    "in_transit",
    "out_for_delivery",
    "shipped"
  ].includes(s)) return "picked_up";
  if ([
    "cancelled",
    "canceled"
  ].includes(s)) return "cancelled";
  if ([
    "pending",
    "confirmed",
    "processing"
  ].includes(s)) return "pending";
  return "other";
}
// Forward-only progress, so a late or replayed older event cannot move a shipment backwards.
const STATUS_RANK = {
  pending: 0,
  confirmed: 1,
  processing: 1,
  picked_up: 2,
  in_transit: 2,
  out_for_delivery: 2,
  shipped: 2,
  completed: 3,
  delivered: 3
};
function rank(s) {
  const k = (s ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  return k in STATUS_RANK ? STATUS_RANK[k] : null;
}
// Shipment webhooks carry is_cod_order / is_cod_remitted booleans but no payout amount field,
// so unless Shipbubble adds one, the amount we told the courier to collect (orders.cod_amount_naira) is what gets recorded.
function payloadAmount(p) {
  for (const c of [
    p.cod_amount,
    p.remitted_amount,
    p.cod_remitted_amount,
    p.cod?.amount,
    p.cod?.remitted_amount
  ]){
    const n = typeof c === "string" ? Number(c.replace(/[^0-9.\-]/g, "")) : c;
    if (typeof n === "number" && Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
Deno.serve(async (req)=>{
  if (req.method !== "POST") return json({
    error: "POST only"
  }, 405);
  const raw = await req.text();
  const keys = await getApiKeys();
  if (!keys.length) {
    console.error("No Shipbubble API key configured");
    return json({
      error: "not configured"
    }, 500);
  }
  const sig = (req.headers.get("x-ship-signature") ?? "").trim().toLowerCase();
  let valid = false;
  if (sig) for (const k of keys){
    if (safeEqual(sig, await hmacSha512Hex(k, raw))) {
      valid = true;
      break;
    }
  }
  if (!valid) return json({
    error: "invalid signature"
  }, 401);
  let p;
  try {
    p = JSON.parse(raw);
  } catch  {
    return json({
      error: "bad json"
    }, 400);
  }
  const event = p.event ?? "";
  const sbOrderId = p.order_id ?? null;
  const status = p.status ?? null;
  const eventKey = [
    event,
    sbOrderId ?? p.ref_code ?? "",
    status ?? "",
    p.date ?? p.package_status?.at?.(-1)?.datetime ?? "",
    p.courier?.tracking_code ?? "",
    p.is_cod_remitted ? "remitted" : ""
  ].join("|");
  try {
    let order = null;
    if (sbOrderId) {
      const { data, error: lookErr } = await supabase.from("orders").select("id, company_id, media_buyer_id, payment_method, order_status, delivery_stage, shipbubble_status, shipbubble_mode, cod_amount_naira, cod_remitted_at").eq("shipbubble_order_id", sbOrderId).maybeSingle();
      if (lookErr) throw lookErr;
      order = data;
    }
    const { error: insErr } = await supabase.from("shipbubble_events").insert({
      event_key: eventKey,
      event,
      shipbubble_order_id: sbOrderId,
      order_id: order?.id ?? null,
      status,
      payload: p
    });
    if (insErr) {
      if (insErr.code !== "23505") throw insErr;
      // Seen before: only skip it if it was fully processed. An earlier attempt that failed is retried.
      const { data: prev } = await supabase.from("shipbubble_events").select("processed").eq("event_key", eventKey).maybeSingle();
      if (prev?.processed) return json({
        ok: true,
        duplicate: true
      });
    }
    if (!event.startsWith("shipment.") || !sbOrderId) {
      await supabase.from("shipbubble_events").update({
        processed: true
      }).eq("event_key", eventKey);
      if (event === "wallet.threshold.alert" || event === "wallet.auto_topup.failed") console.warn("Shipbubble wallet alert:", raw);
      return json({
        ok: true
      });
    }
    if (!order) {
      await supabase.from("shipbubble_events").update({
        error: "no matching order"
      }).eq("event_key", eventKey);
      return json({
        ok: true,
        ignored: "unknown shipment"
      });
    }
    const now = new Date().toISOString();
    const patch = {
      updated_at: now
    };
    // Remittance is signalled by the cod.remitted event or by is_cod_remitted = true on any shipment event.
    const isRemit = event === "shipment.cod.remitted" || p.is_cod_remitted === true && p.is_cod_order !== false;
    const alreadyRemitted = !!order.cod_remitted_at;
    // A pure remittance event reports the payout, not a delivery status, so it must not move shipbubble_status.
    if (status && event !== "shipment.cod.remitted") {
      const nr = rank(status), cr = rank(order.shipbubble_status);
      const stale = event !== "shipment.cancelled" && nr != null && cr != null && nr < cr;
      if (!stale) patch.shipbubble_status = status;
    }
    if (p.courier?.name) patch.shipbubble_courier = p.courier.name;
    if (p.courier?.tracking_code) patch.shipbubble_tracking_code = String(p.courier.tracking_code);
    if (p.tracking_url) patch.shipbubble_tracking_url = p.tracking_url;
    if (p.payment?.shipping_fee != null) patch.shipping_fee_naira = p.payment.shipping_fee;
    // Sandbox shipments never touch the real order lifecycle or money records.
    const live = order.shipbubble_mode === "live";
    const kind = event === "shipment.cancelled" ? "cancelled" : classify(status ?? "");
    let paymentRecorded = false;
    let remitted = null;
    if (kind === "picked_up" && live && order.order_status === "valid") {
      patch.delivery_stage = "on_the_way";
    } else if (kind === "delivered" && live && order.order_status === "valid") {
      patch.order_status = "delivered";
      patch.delivered_at = now;
    } else if (kind === "cancelled") {
      patch.shipbubble_order_id = null;
      patch.shipbubble_error = `Shipbubble shipment ${sbOrderId} was cancelled`;
      patch.shipbubble_attempts = 0;
      patch.cod_amount_naira = null;
      patch.cod_fee_naira = null;
    }
    const remitNow = isRemit && !alreadyRemitted && kind !== "cancelled";
    if (remitNow) {
      // The payout amount from Shipbubble wins if it ever sends one; otherwise the amount we asked the courier to collect.
      remitted = payloadAmount(p) ?? (order.cod_amount_naira != null ? Number(order.cod_amount_naira) : null);
    }
    // Cash reached the seller: record the payment FIRST. If this fails nothing is marked remitted,
    // so the retry (Shipbubble gets a 500) records it. payments.order_id is unique, so an order already
    // paid by transfer, or a replay of this same event, is left alone (23505).
    if (remitNow && remitted != null && live) {
      const { error: payErr } = await supabase.from("payments").insert({
        company_id: order.company_id,
        order_id: order.id,
        media_buyer_id: order.media_buyer_id ?? null,
        paystack_reference: `shipbubble-cod:${sbOrderId}`,
        amount_naira: remitted,
        status: "confirmed",
        channel: "shipbubble_cod",
        source: "customer_order",
        paid_at: now,
        raw_event: p,
        narration: `Cash on delivery remitted by Shipbubble (${sbOrderId})`
      });
      if (payErr && payErr.code !== "23505") throw payErr;
      paymentRecorded = !payErr;
    }
    if (remitNow) {
      patch.cod_remitted_at = now;
      if (remitted != null) patch.cod_remitted_amount_naira = remitted;
    }
    const { error: updErr } = await supabase.from("orders").update(patch).eq("id", order.id);
    if (updErr) throw updErr;
    await supabase.from("shipbubble_events").update({
      processed: true,
      error: remitNow && remitted == null ? "remitted but no amount known for this order" : null
    }).eq("event_key", eventKey);
    return json({
      ok: true,
      applied_to_order_lifecycle: live,
      remitted: remitNow,
      payment_recorded: paymentRecorded
    });
  } catch (err) {
    console.error("shipbubble-webhook error:", err);
    await supabase.from("shipbubble_events").update({
      error: String(err?.message ?? err)
    }).eq("event_key", eventKey);
    // 500 so Shipbubble retries; the retry is processed because the event is not marked processed.
    return json({
      ok: false,
      error: "processing failed"
    }, 500);
  }
});
