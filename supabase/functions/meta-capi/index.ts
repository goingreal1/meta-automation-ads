import { createClient } from "jsr:@supabase/supabase-js@2";

// Supabase Edge Function: meta-capi
// Server-side relay for browser/iframe events to Meta Conversions API.
// For COD: send Purchase when the order is successfully accepted, not when payment is collected.

const FB_PIXEL_ID = Deno.env.get("META_PIXEL_ID") ?? Deno.env.get("FB_PIXEL_ID");
const FB_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? Deno.env.get("FB_ACCESS_TOKEN");
const GRAPH_API_VERSION = "v22.0";
const ALLOWED_ORIGIN = Deno.env.get("CAPI_ALLOWED_ORIGIN") ?? "*";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const EVENT_NAMES = new Set([
  "PageView",
  "InitiateCheckout",
  "Purchase",
  "Lead",
  "ViewContent",
]);

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const HASHED_FIELDS = [
  "email",
  "phone",
  "firstName",
  "lastName",
  "city",
  "state",
  "zip",
  "country",
  "externalId",
];

const FIELD_MAP: Record<string, string> = {
  email: "em",
  phone: "ph",
  firstName: "fn",
  lastName: "ln",
  city: "ct",
  state: "st",
  zip: "zp",
  country: "country",
  externalId: "external_id",
};

async function buildUserData(raw: Record<string, unknown>, req: Request) {
  const userData: Record<string, unknown> = {};

  for (const key of HASHED_FIELDS) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) {
      userData[FIELD_MAP[key]] = await sha256Hex(value);
    }
  }

  if (typeof raw.fbp === "string" && raw.fbp) userData.fbp = raw.fbp;
  if (typeof raw.fbc === "string" && raw.fbc) userData.fbc = raw.fbc;

  userData.client_ip_address =
    raw.clientIpAddress ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    undefined;
  userData.client_user_agent =
    raw.clientUserAgent ?? req.headers.get("user-agent") ?? undefined;

  return userData;
}

function computeCustomData(raw: Record<string, unknown>) {
  const customData: Record<string, unknown> = { ...raw };
  const unitPrice = raw.unit_price;
  const quantity = typeof raw.quantity === "number" ? raw.quantity : 1;

  customData.currency = typeof raw.currency === "string" ? raw.currency : "NGN";
  if (typeof unitPrice === "number") {
    customData.value = Number((unitPrice * quantity).toFixed(2));
    customData.num_items = quantity;
  } else if (typeof raw.value === "number") {
    customData.value = Number(raw.value.toFixed(2));
  }

  delete customData.unit_price;
  return customData;
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}


// Paid-order Purchase: called by the orders trigger (x-cron-secret) when an order becomes delivered.
// Only fires when the order's site is set to "paid" purchase tracking, so a seller never double counts
// (at submit AND at payment). Pixel and token resolve per ad account, exactly like receive-order.
async function sendPaidPurchase(orderId: string, req: Request) {
  const { data: o } = await db.from("orders").select("id, company_id, site_id, event_id, order_value_naira, currency, customer_name, customer_phone, customer_email, customer_city, customer_state, fbclid, ad_account_id, order_status, capi_paid_sent_at, delivered_at, product_name, quantity").eq("id", orderId).maybeSingle();
  if (!o) return { skipped: "order not found" };
  if (o.order_status !== "delivered") return { skipped: "not delivered" };
  if (o.capi_paid_sent_at) return { skipped: "already sent" };
  if (!o.site_id) return { skipped: "order has no site" };
  const { data: site } = await db.from("sites").select("purchase_event, ad_account_id").eq("id", o.site_id).maybeSingle();
  if (site?.purchase_event !== "paid") return { skipped: "site is not set to count purchases when paid" };

  let pixel: string | null = null, token: string | null = null;
  const acctId = o.ad_account_id ?? site?.ad_account_id ?? null;
  if (acctId) {
    const { data: a } = await db.from("ad_accounts").select("meta_pixel_id, meta_connection_id").eq("id", acctId).maybeSingle();
    pixel = a?.meta_pixel_id ?? null;
    if (a?.meta_connection_id) {
      const { data: c } = await db.from("meta_connections").select("access_token, status").eq("id", a.meta_connection_id).maybeSingle();
      if (c?.status === "active") token = c.access_token ?? null;
    }
  }
  if ((!pixel || !token) && o.company_id) {
    const { data: s } = await db.from("company_settings").select("meta_pixel_id, meta_access_token").eq("company_id", o.company_id).maybeSingle();
    pixel = pixel ?? s?.meta_pixel_id ?? null; token = token ?? s?.meta_access_token ?? null;
  }
  if (!pixel || !token) {
    // The platform's own pixel/token belong to the platform's first company only.
    const { data: first } = await db.from("profiles").select("company_id").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (o.company_id && first?.company_id === o.company_id) { pixel = pixel ?? FB_PIXEL_ID ?? null; token = token ?? FB_ACCESS_TOKEN ?? null; }
  }
  if (!pixel || !token) return { skipped: "no pixel or token for this order's ad account" };

  const digits = (o.customer_phone ?? "").replace(/\D/g, "");
  const phone = digits.startsWith("0") ? "234" + digits.slice(1) : digits;
  const names = String(o.customer_name ?? "").trim().split(/\s+/);
  const ud: Record<string, unknown> = {};
  if (phone) ud.ph = [await sha256Hex(phone)];
  if (o.customer_email) ud.em = [await sha256Hex(o.customer_email)];
  if (names[0]) ud.fn = [await sha256Hex(names[0])];
  if (names.length > 1) ud.ln = [await sha256Hex(names.slice(1).join(" "))];
  if (o.customer_city) ud.ct = [await sha256Hex(o.customer_city)];
  if (o.customer_state) ud.st = [await sha256Hex(o.customer_state)];
  ud.country = [await sha256Hex("ng")];
  ud.external_id = [await sha256Hex(o.id)];
  if (o.fbclid) ud.fbc = `fb.1.${Math.floor(new Date(o.delivered_at ?? Date.now()).getTime() / 1000)}.${o.fbclid}`;

  // Meta only accepts events up to 7 days old; an older delivery is stamped now.
  let t = Math.floor(new Date(o.delivered_at ?? Date.now()).getTime() / 1000);
  if (Date.now() / 1000 - t > 6 * 86400) t = Math.floor(Date.now() / 1000);
  const payload = { data: [{
    event_name: "Purchase", event_time: t, action_source: "system_generated",
    event_id: o.event_id ? `${o.event_id}-paid` : `order-${o.id}-paid`,
    user_data: ud,
    custom_data: { currency: o.currency || "NGN", value: Number(o.order_value_naira ?? 0), content_name: o.product_name ?? undefined, num_items: o.quantity ?? 1 },
  }] };
  const r = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${pixel}/events?access_token=${encodeURIComponent(token)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.events_received) { console.error("meta-capi paid purchase failed:", JSON.stringify(j)); return { error: j?.error?.message ?? "Meta rejected the event" }; }
  await db.from("orders").update({ capi_paid_sent_at: new Date().toISOString() }).eq("id", o.id);
  await db.from("event_logs").insert({ event_name: "Purchase", event_id: payload.data[0].event_id, event_source: "server_paid", sent_to_meta: true }).then(() => {}, () => {});
  return { sent: true, events_received: j.events_received };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);

  // Internal call from the orders trigger: authenticated by the shared cron secret.
  const cron = req.headers.get("x-cron-secret");
  if (cron) {
    const { data: sec } = await db.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
    if (!sec?.value || sec.value !== cron) return response({ error: "Unauthorized" }, 401);
    try {
      const b = await req.json();
      if (!/^[0-9a-f-]{36}$/i.test(String(b?.order_id ?? ""))) return response({ error: "order_id required" }, 400);
      return response(await sendPaidPurchase(b.order_id, req));
    } catch (e) { console.error("paid purchase error:", e); return response({ error: "failed" }, 500); }
  }

  if (!FB_PIXEL_ID || !FB_ACCESS_TOKEN) {
    console.error("Missing META_PIXEL_ID or META_ACCESS_TOKEN secret");
    return response({ error: "CAPI is not configured" }, 500);
  }

  try {
    const body = await req.json();
    const {
      event_name: eventName,
      event_id: eventId,
      event_source_url: eventSourceUrl,
      user_data: rawUserData = {},
      custom_data: rawCustomData = {},
      action_source: actionSource = "website",
    } = body;

    if (typeof eventName !== "string" || !EVENT_NAMES.has(eventName)) {
      return response({
        error: "event_name must be one of PageView, InitiateCheckout, Purchase, Lead, ViewContent",
      }, 400);
    }

    const payload = {
      data: [{
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: typeof eventId === "string" && eventId ? eventId : crypto.randomUUID(),
        event_source_url: typeof eventSourceUrl === "string" ? eventSourceUrl : undefined,
        action_source: actionSource,
        user_data: await buildUserData(rawUserData, req),
        custom_data: computeCustomData(rawCustomData),
      }],
    };

    const metaResponse = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${FB_PIXEL_ID}/events?access_token=${encodeURIComponent(FB_ACCESS_TOKEN)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const metaJson = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error("Meta CAPI error:", metaJson);
      return response({ error: metaJson }, metaResponse.status);
    }

    return response({ success: true, meta_response: metaJson });
  } catch (error) {
    console.error("CAPI relay error:", error);
    return response({ error: "Invalid request or CAPI relay failure" }, 500);
  }
});
