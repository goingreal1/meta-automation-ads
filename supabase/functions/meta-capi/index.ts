// Supabase Edge Function: meta-capi
// Server-side relay for browser/iframe events to Meta Conversions API.
// For COD: send Purchase when the order is successfully accepted, not when payment is collected.

const FB_PIXEL_ID = Deno.env.get("META_PIXEL_ID") ?? Deno.env.get("FB_PIXEL_ID");
const FB_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? Deno.env.get("FB_ACCESS_TOKEN");
const GRAPH_API_VERSION = "v22.0";
const ALLOWED_ORIGIN = Deno.env.get("CAPI_ALLOWED_ORIGIN") ?? "*";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);
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
