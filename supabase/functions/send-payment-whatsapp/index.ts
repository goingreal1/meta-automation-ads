import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Sends WhatsApp payment notices to a customer and their assigned delivery
// agent, via ONE global WhatsApp Business number shared by every company on
// the platform (same posture as the global Meta ads token and Paystack
// account -- a transactional notification channel, not each company's own
// branded line). Two moments trigger this:
//   "payment_request"   -- order just got AI-confirmed (order_status ->
//                           'valid'): tells the customer where to pay, tells
//                           the agent what to expect.
//   "payment_confirmed" -- paystack-webhook matched a real deposit: tells
//                           both sides the money landed.
// Every message is a pre-approved WhatsApp template (required outside the
// 24h free-form window, and these contacts are first-touch) -- this
// function can't create or approve templates, only send existing ones.
// Template names are overridable via secrets; defaults below, with their
// required body text documented alongside for submission in Meta's
// WhatsApp Manager.
//
//   POST { order_id, type: "payment_request" | "payment_confirmed" }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("BEOLIV_WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_ID = Deno.env.get("BEOLIV_WHATSAPP_PHONE_NUMBER_ID") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v18.0";

// "payment_request_customer_v1": Hi {{1}}, please pay NGN {{2}} to {{3}} account {{4}} to complete your order. Include the code {{5}} in your transfer note if your bank app allows it -- it helps us confirm instantly. We'll text you the moment it's received.
const TPL_CUSTOMER_REQUEST = Deno.env.get("WHATSAPP_TPL_CUSTOMER_REQUEST") ?? "payment_request_customer_v1";
// "payment_confirmed_customer_v1": Hi {{1}}, we've received your payment of NGN {{2}}. Thank you! Your order is being processed for delivery.
const TPL_CUSTOMER_CONFIRMED = Deno.env.get("WHATSAPP_TPL_CUSTOMER_CONFIRMED") ?? "payment_confirmed_customer_v1";
// "payment_request_agent_v1": New order for {{1}} -- {{2}}. Customer will pay NGN {{3}} to {{4}} account {{5}}. You'll get a message once it's confirmed.
const TPL_AGENT_REQUEST = Deno.env.get("WHATSAPP_TPL_AGENT_REQUEST") ?? "payment_request_agent_v1";
// "payment_confirmed_agent_v1": Payment confirmed for {{1}}'s order ({{2}}) -- NGN {{3}} received. Please proceed with delivery.
const TPL_AGENT_CONFIRMED = Deno.env.get("WHATSAPP_TPL_AGENT_CONFIRMED") ?? "payment_confirmed_agent_v1";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

async function sendTemplate(toPhone: string, templateName: string, bodyParams: string[]) {
  const res = await fetch(`${META_GRAPH_BASE}/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toPhone,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en" },
        components: [{ type: "body", parameters: bodyParams.map((p) => ({ type: "text", text: p })) }],
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `WhatsApp send failed (template ${templateName})`);
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" },
    });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return json({ error: "WhatsApp isn't configured yet (BEOLIV_WHATSAPP_ACCESS_TOKEN / BEOLIV_WHATSAPP_PHONE_NUMBER_ID)." }, 500);

  try {
    const { order_id, type } = await req.json();
    if (!order_id || !["payment_request", "payment_confirmed"].includes(type)) {
      return json({ error: "order_id and a valid type are required" }, 400);
    }

    const { data: order } = await supabase
      .from("orders")
      .select("id, customer_name, customer_phone, order_value_naira, payment_narration_code, media_buyer_id, delivery_agent_id, media_buyers(name, dedicated_account_number, dedicated_account_bank)")
      .eq("id", order_id)
      .maybeSingle();
    if (!order) return json({ error: "Order not found" }, 404);

    const buyer: any = order.media_buyers;
    const amount = new Intl.NumberFormat("en-NG").format(Number(order.order_value_naira ?? 0));
    const results: Record<string, string> = {};

    if (type === "payment_request") {
      if (!buyer?.dedicated_account_number) return json({ error: "This media buyer has no payment account yet -- call paystack-create-account first." }, 400);
      if (order.customer_phone) {
        try {
          await sendTemplate(order.customer_phone, TPL_CUSTOMER_REQUEST, [
            order.customer_name || "there", amount, buyer.dedicated_account_bank || "", buyer.dedicated_account_number, order.payment_narration_code || "",
          ]);
          results.customer = "sent";
        } catch (err: any) { results.customer = `error: ${err.message}`; }
      }
      if (order.delivery_agent_id) {
        const { data: agent } = await supabase.from("delivery_agents").select("name, phone").eq("id", order.delivery_agent_id).maybeSingle();
        if (agent?.phone) {
          try {
            await sendTemplate(agent.phone, TPL_AGENT_REQUEST, [order.customer_name || "Customer", order.payment_narration_code || order.id.slice(0, 8), amount, buyer.dedicated_account_bank || "", buyer.dedicated_account_number]);
            results.agent = "sent";
          } catch (err: any) { results.agent = `error: ${err.message}`; }
        }
      }
    } else {
      if (order.customer_phone) {
        try {
          await sendTemplate(order.customer_phone, TPL_CUSTOMER_CONFIRMED, [order.customer_name || "there", amount]);
          results.customer = "sent";
        } catch (err: any) { results.customer = `error: ${err.message}`; }
      }
      if (order.delivery_agent_id) {
        const { data: agent } = await supabase.from("delivery_agents").select("phone").eq("id", order.delivery_agent_id).maybeSingle();
        if (agent?.phone) {
          try {
            await sendTemplate(agent.phone, TPL_AGENT_CONFIRMED, [order.customer_name || "Customer", order.payment_narration_code || order.id.slice(0, 8), amount]);
            results.agent = "sent";
          } catch (err: any) { results.agent = `error: ${err.message}`; }
        }
      }
    }

    return json({ ok: true, results });
  } catch (err: any) {
    console.error("send-payment-whatsapp error:", err);
    return json({ error: err.message }, 500);
  }
});
