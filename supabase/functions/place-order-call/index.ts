import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toE164NG } from "../_shared/safety.ts";

// Places the AI order-confirmation call for an order through an ElevenLabs
// agent (outbound over the Twilio number imported into ElevenLabs).
//
//   POST { order_id }        -> queue + (if within calling hours) dial now
//   POST { process_due: true } -> dial every queued call whose time has come
//                               (run from pg_cron every ~10 minutes)
//
// Only the service role (receive-order, cron) or a signed-in dashboard user
// may call this -- the anon key alone is rejected, since every call costs money.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
const ELEVENLABS_AGENT_ID = Deno.env.get("ELEVENLABS_AGENT_ID") ?? "";
const ELEVENLABS_PHONE_NUMBER_ID = Deno.env.get("ELEVENLABS_PHONE_NUMBER_ID") ?? "";
const BUSINESS_NAME = Deno.env.get("BUSINESS_NAME") ?? "our wellness store";

// Don't ring customers at night. Lagos is UTC+1 with no DST.
const CALL_START_HOUR = 8;
const CALL_END_HOUR = 20;
const LAGOS_OFFSET_HOURS = 1;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// Next moment inside calling hours (now, if we're already inside them).
function nextCallableTime(now = new Date()): Date {
  const lagos = new Date(now.getTime() + LAGOS_OFFSET_HOURS * 3600_000);
  const h = lagos.getUTCHours();
  if (h >= CALL_START_HOUR && h < CALL_END_HOUR) return now;
  const next = new Date(lagos);
  if (h >= CALL_END_HOUR) next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(CALL_START_HOUR, 0, 0, 0);
  return new Date(next.getTime() - LAGOS_OFFSET_HOURS * 3600_000);
}

async function isAuthorized(req: Request): Promise<boolean> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return false;
  if (token === SUPABASE_SERVICE_ROLE_KEY) return true;
  const { data } = await supabase.auth.getUser(token);
  return !!data?.user;
}

async function dial(callId: string) {
  const { data: call } = await supabase
    .from("voice_calls")
    .select("id, to_number, order_id, orders(*)")
    .eq("id", callId)
    .single();
  if (!call) return { id: callId, error: "call not found" };
  const o: any = call.orders;

  // Claim it so an overlapping cron run can't dial the same customer twice.
  const { data: claimed } = await supabase
    .from("voice_calls")
    .update({ status: "dialing" })
    .eq("id", callId)
    .eq("status", "queued")
    .select("id");
  if (!claimed?.length) return { id: callId, skipped: "already claimed" };

  const naira = new Intl.NumberFormat("en-NG").format(Number(o?.order_value_naira ?? 0));
  const res = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: ELEVENLABS_AGENT_ID,
      agent_phone_number_id: ELEVENLABS_PHONE_NUMBER_ID,
      to_number: call.to_number,
      conversation_initiation_client_data: {
        // Referenced as {{customer_name}} etc. in the agent's prompt/first message.
        dynamic_variables: {
          business_name: BUSINESS_NAME,
          customer_name: (o?.customer_name ?? "").trim().split(" ")[0] || "there",
          product_name: o?.product_name ?? "your order",
          quantity: String(o?.quantity ?? 1),
          order_value: `${naira} naira`,
          delivery_address: o?.customer_address ?? "",
          delivery_city: o?.customer_city ?? "",
          delivery_state: o?.customer_state ?? "",
          payment_method: o?.payment_method ?? "pay on delivery",
          order_ref: String(o?.id ?? "").slice(0, 8).toUpperCase(),
        },
      },
    }),
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok || body?.success === false) {
    const error = body?.message || body?.detail?.message || JSON.stringify(body).slice(0, 500);
    await supabase.from("voice_calls").update({ status: "failed", error }).eq("id", callId);
    return { id: callId, error };
  }
  await supabase.from("voice_calls").update({
    status: "initiated",
    elevenlabs_conversation_id: body.conversation_id ?? null,
    provider_call_sid: body.callSid ?? null,
  }).eq("id", callId);
  return { id: callId, conversation_id: body.conversation_id };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
      },
    });
  }

  try {
    if (!(await isAuthorized(req))) return json({ error: "Unauthorized" }, 401);
    if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID || !ELEVENLABS_PHONE_NUMBER_ID) {
      return json({ error: "ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID and ELEVENLABS_PHONE_NUMBER_ID must be set." }, 500);
    }

    const body = await req.json().catch(() => ({}));

    if (body?.process_due) {
      if (nextCallableTime().getTime() > Date.now()) return json({ processed: 0, reason: "outside calling hours" });
      const { data: due } = await supabase
        .from("voice_calls")
        .select("id")
        .eq("status", "queued")
        .lte("scheduled_for", new Date().toISOString())
        .order("scheduled_for")
        .limit(20);
      const results = [];
      for (const c of due ?? []) results.push(await dial(c.id));
      return json({ processed: results.length, results });
    }

    const orderId = body?.order_id as string | undefined;
    if (!orderId) return json({ error: "order_id is required" }, 400);

    const { data: order } = await supabase
      .from("orders")
      .select("id, customer_phone, order_status")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return json({ error: "Order not found" }, 404);

    const to = toE164NG(order.customer_phone);
    if (!to) return json({ error: `Not a valid Nigerian phone number: ${order.customer_phone}` }, 400);

    // One automatic call per order; a manual retry from the dashboard passes force.
    if (!body?.force) {
      const { data: existing } = await supabase
        .from("voice_calls").select("id, status").eq("order_id", orderId).limit(1);
      if (existing?.length) return json({ skipped: "order already has a call", call: existing[0] });
    }

    const scheduledFor = nextCallableTime();
    const { data: call, error } = await supabase
      .from("voice_calls")
      .insert({ order_id: orderId, to_number: to, scheduled_for: scheduledFor.toISOString() })
      .select("id")
      .single();
    if (error || !call) throw new Error(`Could not queue call: ${error?.message}`);

    if (scheduledFor.getTime() > Date.now()) {
      return json({ queued: true, call_id: call.id, scheduled_for: scheduledFor.toISOString() });
    }
    return json(await dial(call.id));
  } catch (err: any) {
    console.error("place-order-call error:", err);
    return json({ error: err.message }, 500);
  }
});
