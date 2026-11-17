import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Creates a Shipbubble delivery for a confirmed (order_status = 'valid') order.
// Triggered by a DB trigger when an order becomes valid (AI call, customer care or manual),
// and by a retry sweep for orders whose first attempt failed.
//
// Body: { order_id?: string, dry_run?: boolean, force?: boolean, sender_override?: {name,email,phone,address} }
//  - no order_id  -> retry sweep of previously failed attempts
//  - dry_run      -> validate addresses + fetch rates only, no shipment, nothing saved
//  - force        -> run even when app_secrets.shipbubble_dispatch = 'off' (manual testing)
//
// Orders with payment_method "Pay on delivery" ship as Shipbubble cash-on-delivery: the courier collects
// order_value_naira from the customer and Shipbubble remits it later (shipment.cod.remitted webhook).
// If the customer already paid an online confirmation deposit (orders.deposit_status = 'paid'), the courier
// collects only what is still owed: order_value_naira minus the deposit.
//
// Key lookup: Edge Function secret SHIPBUBBLE_API_KEY wins; otherwise app_secrets.shipbubble_api_key.
// Key prefix decides the mode: sb_sandbox_* = sandbox, sb_prod_* = live.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const BASE = "https://api.shipbubble.com/v1";
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MIN = 10;
const DEFAULT_WEIGHT_KG = 0.5; // per unit; products have no weight field yet
const DEFAULT_DIM = {
  length: 20,
  width: 15,
  height: 10
}; // cm
const FALLBACK_EMAIL_DOMAIN = Deno.env.get("SHIPBUBBLE_FALLBACK_EMAIL_DOMAIN") ?? "revora.app";
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
async function secret(key) {
  const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}
async function isAuthorised(req) {
  const cron = req.headers.get("x-cron-secret");
  if (cron && cron === await secret("ads_cron_secret")) return true;
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  return !!token && token === SERVICE_KEY;
}
// Nigerian numbers to E.164.
function toE164NG(raw) {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 11) d = "234" + d.slice(1);
  if (d.length === 10 && /^[789]/.test(d)) d = "234" + d;
  if (!/^234[789]\d{9}$/.test(d)) return null;
  return "+" + d;
}
const isCodOrder = (o)=>/pay on delivery|cash on delivery|\bcod\b/i.test(o.payment_method ?? "");
async function sb(apiKey, path, method, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch  {
    j = {
      raw: text
    };
  }
  if (!res.ok || j.status === "failed") {
    const detail = [
      j.message,
      ...Array.isArray(j.errors) ? j.errors : []
    ].filter(Boolean).join("; ") || text.slice(0, 200);
    throw new Error(`Shipbubble ${method} ${path} ${res.status}: ${detail}`);
  }
  return j;
}
async function validateAddress(apiKey, a) {
  const j = await sb(apiKey, "/shipping/address/validate", "POST", a);
  const code = j?.data?.address_code;
  if (!code) throw new Error(`Address could not be validated: ${a.address}`);
  return code;
}
async function pickCategoryId(apiKey) {
  const j = await sb(apiKey, "/shipping/labels/categories", "GET");
  const cats = j?.data ?? [];
  if (!cats.length) throw new Error("No Shipbubble package categories returned");
  const preferred = cats.find((c)=>/health|beauty|personal care|pharma/i.test(c.category)) ?? cats.find((c)=>/other|general|misc/i.test(c.category)) ?? cats[0];
  return preferred.category_id;
}
// Pickup date in Lagos time (UTC+1). After 6 PM Shipbubble schedules for the next day anyway, so ask for tomorrow.
function pickupDate() {
  const wat = new Date(Date.now() + 60 * 60 * 1000);
  if (wat.getUTCHours() >= 18) wat.setUTCDate(wat.getUTCDate() + 1);
  return wat.toISOString().slice(0, 10);
}
// Joins address / city / state without repeating text the customer already typed into an earlier field.
function buildAddress(...fields) {
  const parts = [];
  for (const f of fields){
    const t = (f ?? "").trim();
    if (!t) continue;
    if (parts.join(", ").toLowerCase().includes(t.toLowerCase())) continue;
    parts.push(t);
  }
  return parts.join(", ") + ", Nigeria";
}
async function processOrder(apiKey, mode, orderId, opts) {
  const { data: order, error } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (error || !order) return {
    order_id: orderId,
    error: "order not found"
  };
  if (order.order_status !== "valid" && !opts.force) return {
    order_id: orderId,
    skipped: `order_status is ${order.order_status}`
  };
  if (order.shipbubble_order_id) return {
    order_id: orderId,
    skipped: "already has a shipment",
    shipbubble_order_id: order.shipbubble_order_id
  };
  const fail = async (msg)=>{
    if (!opts.dryRun) await supabase.from("orders").update({
      shipbubble_error: msg.slice(0, 500)
    }).eq("id", orderId);
    return {
      order_id: orderId,
      error: msg
    };
  };
  const cod = isCodOrder(order);
  const orderValue = Number(order.order_value_naira) || 0;
  // A confirmation deposit already paid online comes off what the courier collects.
  const depositPaid = order.deposit_status === "paid" ? Number(order.deposit_amount_naira) || 0 : 0;
  const collectAmount = Math.max(orderValue - depositPaid, 0);
  if (cod && orderValue <= 0) return await fail("Cash-on-delivery order has no order value, so the amount to collect is unknown.");
  if (cod && collectAmount <= 0) return await fail("The confirmation deposit already covers this order, so there is nothing for the courier to collect. Check the order.");
  if (!opts.dryRun) {
    // Claim the attempt so a duplicate trigger / sweep cannot create two shipments.
    const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: claimed } = await supabase.from("orders").update({
      shipbubble_attempts: (order.shipbubble_attempts ?? 0) + 1,
      shipbubble_last_attempt_at: new Date().toISOString(),
      shipbubble_error: null
    }).eq("id", orderId).is("shipbubble_order_id", null).or(`shipbubble_last_attempt_at.is.null,shipbubble_last_attempt_at.lt.${cutoff}`).select("id");
    if (!claimed?.length) return {
      order_id: orderId,
      skipped: "another attempt is in progress"
    };
  }
  try {
    // ---- sender ----
    const { data: company } = await supabase.from("companies").select("name, pickup_name, pickup_phone, pickup_email, pickup_address, shipbubble_sender_address_code").eq("id", order.company_id).maybeSingle();
    let senderCode = mode === "live" ? company?.shipbubble_sender_address_code ?? null : null; // address codes differ between sandbox and live
    if (!senderCode) {
      const s = opts.senderOverride ?? {
        name: company?.pickup_name || company?.name,
        email: company?.pickup_email,
        phone: toE164NG(company?.pickup_phone),
        address: company?.pickup_address
      };
      if (!s?.address || !s?.phone || !s?.email || !s?.name) return await fail("Pickup address not set. Add the company's pickup name, phone, email and address.");
      senderCode = await validateAddress(apiKey, s);
      if (mode === "live" && !opts.senderOverride) await supabase.from("companies").update({
        shipbubble_sender_address_code: senderCode
      }).eq("id", order.company_id);
    }
    // ---- receiver ----
    const phone = toE164NG(order.customer_phone);
    if (!phone) return await fail(`Customer phone is not a valid Nigerian number: ${order.customer_phone}`);
    if (!order.customer_address) return await fail("Customer address is missing.");
    const addr = buildAddress(order.customer_address, order.customer_city, order.customer_state);
    const receiverCode = await validateAddress(apiKey, {
      name: order.customer_name || "Customer",
      email: order.customer_email || `orders+${String(order.id).slice(0, 8)}@${FALLBACK_EMAIL_DOMAIN}`,
      phone,
      address: addr
    });
    // ---- items ----
    const { data: lines } = await supabase.from("order_items").select("*").eq("order_id", orderId);
    const totalQty = Math.max(1, lines?.length ? lines.reduce((n, l)=>n + (l.quantity ?? 1), 0) : order.quantity ?? 1);
    const names = (lines?.length ? lines.map((l)=>l.product_name ?? l.name) : [
      order.product_name
    ]).filter(Boolean);
    let items;
    if (cod) {
      // The courier collects the sum of the package items, so a COD parcel is one line worth exactly what the customer still owes.
      const label = (names.join(", ") || "Order").slice(0, 100);
      items = [
        {
          name: label.slice(0, 60),
          description: label,
          unit_weight: String(DEFAULT_WEIGHT_KG * totalQty),
          unit_amount: collectAmount.toFixed(2),
          quantity: "1"
        }
      ];
    } else {
      const perUnit = Math.max(100, Math.round((orderValue || 1000) / totalQty));
      items = (lines?.length ? lines : [
        {
          product_name: order.product_name,
          quantity: order.quantity ?? 1
        }
      ]).map((l)=>({
          name: String(l.product_name ?? l.name ?? order.product_name ?? "Product").slice(0, 60),
          description: String(l.product_name ?? l.name ?? order.product_name ?? "Product").slice(0, 100),
          unit_weight: String(DEFAULT_WEIGHT_KG),
          unit_amount: String(Math.round(Number(l.unit_price ?? l.price ?? perUnit)) || perUnit),
          quantity: String(l.quantity ?? 1)
        }));
    }
    // ---- rates ----
    const categoryId = await pickCategoryId(apiKey);
    const rates = await sb(apiKey, "/shipping/fetch_rates", "POST", {
      sender_address_code: senderCode,
      reciever_address_code: receiverCode,
      pickup_date: pickupDate(),
      category_id: categoryId,
      package_items: items,
      package_dimension: DEFAULT_DIM,
      delivery_instructions: cod ? `Cash on delivery. Collect the full amount from the customer. Call customer on ${phone} before delivery.` : `Call customer on ${phone} before delivery.`
    });
    const d = rates.data;
    const couriers = d?.couriers ?? [];
    // Automation needs a courier that collects from the seller; drop-off-only rates would need a human to take the parcel to a station.
    const pickups = couriers.filter((c)=>c.service_type === "pickup");
    let pool = pickups.length ? pickups : couriers;
    if (cod) {
      pool = pool.filter((c)=>c.is_cod_available);
      if (!pool.length) return await fail("No cash-on-delivery courier is available for this route. Check that COD is enabled in the Shipbubble dashboard, or confirm payment another way.");
    }
    if (!pool.length) return await fail("Shipbubble returned no couriers for this route.");
    const chosen = [
      ...pool
    ].sort((a, b)=>(a.total ?? 1e12) - (b.total ?? 1e12))[0];
    const packageAmount = Number(d?.checkout_data?.package_amount);
    const codAmount = cod ? Number.isFinite(packageAmount) && packageAmount > 0 ? packageAmount : collectAmount : null;
    if (opts.dryRun) {
      return {
        order_id: orderId,
        dry_run: true,
        mode,
        cod,
        sender_address_code: senderCode,
        receiver_address_code: receiverCode,
        address_used: addr,
        couriers_available: couriers.length,
        pickup_couriers: pickups.length,
        cod_couriers: couriers.filter((c)=>c.is_cod_available).length,
        cod_amount_to_collect: codAmount,
        order_value: orderValue,
        deposit_paid: depositPaid,
        chosen: {
          courier_id: chosen.courier_id,
          courier_name: chosen.courier_name,
          service_code: chosen.service_code,
          service_type: chosen.service_type,
          total: chosen.total,
          cod_fee: chosen.cod_fee ?? null,
          delivery_eta: chosen.delivery_eta,
          is_cod_available: chosen.is_cod_available
        }
      };
    }
    // ---- label ----
    const label = await sb(apiKey, "/shipping/labels", "POST", {
      request_token: d.request_token,
      service_code: chosen.service_code,
      courier_id: String(chosen.courier_id),
      ...cod ? {
        is_cod_label: true
      } : {}
    });
    const s = label.data;
    await supabase.from("orders").update({
      shipbubble_order_id: s.order_id,
      shipbubble_status: s.status ?? "pending",
      shipbubble_courier: s.courier?.name ?? chosen.courier_name,
      shipbubble_tracking_url: s.tracking_url ?? null,
      shipping_fee_naira: s.payment?.shipping_fee ?? chosen.total,
      shipbubble_created_at: new Date().toISOString(),
      shipbubble_error: null,
      shipbubble_mode: mode,
      cod_amount_naira: codAmount,
      cod_fee_naira: cod ? chosen.cod_fee ?? null : null
    }).eq("id", orderId);
    return {
      order_id: orderId,
      created: true,
      mode,
      cod,
      cod_amount: codAmount,
      shipbubble_order_id: s.order_id,
      courier: s.courier?.name,
      fee: s.payment?.shipping_fee,
      tracking_url: s.tracking_url
    };
  } catch (err) {
    console.error(`shipbubble order ${orderId}:`, err);
    return await fail(String(err?.message ?? err));
  }
}
Deno.serve(async (req)=>{
  if (req.method !== "POST") return json({
    error: "POST only"
  }, 405);
  if (!await isAuthorised(req)) return json({
    error: "unauthorized"
  }, 401);
  try {
    const body = await req.json().catch(()=>({}));
    const apiKey = Deno.env.get("SHIPBUBBLE_API_KEY") || await secret("shipbubble_api_key");
    if (!apiKey) return json({
      error: "No Shipbubble API key configured"
    }, 500);
    const mode = apiKey.startsWith("sb_prod") ? "live" : "sandbox";
    const dispatch = await secret("shipbubble_dispatch") ?? "off"; // off | test | live
    if (dispatch === "off" && !body.force) return json({
      skipped: "shipbubble_dispatch is off"
    });
    if (body.order_id) {
      return json(await processOrder(apiKey, mode, body.order_id, {
        dryRun: !!body.dry_run,
        force: !!body.force,
        senderOverride: body.sender_override
      }));
    }
    // Retry sweep: only orders that already failed at least once, so existing orders are never swept up by accident.
    const before = new Date(Date.now() - RETRY_AFTER_MIN * 60 * 1000).toISOString();
    const { data: retry } = await supabase.from("orders").select("id").eq("order_status", "valid").is("shipbubble_order_id", null).gte("shipbubble_attempts", 1).lt("shipbubble_attempts", MAX_ATTEMPTS).lt("shipbubble_last_attempt_at", before).limit(20);
    const results = [];
    for (const o of retry ?? [])results.push(await processOrder(apiKey, mode, o.id, {}));
    return json({
      swept: results.length,
      results
    });
  } catch (err) {
    console.error("create-shipbubble-delivery error:", err);
    return json({
      error: String(err?.message ?? err)
    }, 500);
  }
});
