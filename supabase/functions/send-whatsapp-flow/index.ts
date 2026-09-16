import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// One-click "send the order form" from the dashboard's Conversations tab --
// sends the exact same native WhatsApp Flow message the bot's own
// sendOrderFlow() sends (beoliv-whatsapp-funnel/src/controllers/botController.ts),
// so an agent can hand a customer the real checkout form without typing.
// ORDER_FLOW_ID/SCREEN_ID must stay in sync with
// beoliv-whatsapp-funnel/src/config/product.ts if that ever changes.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("BEOLIV_WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_ID = Deno.env.get("BEOLIV_WHATSAPP_PHONE_NUMBER_ID") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v18.0";

const ORDER_FLOW_ID = "1801858017673906";
const ORDER_FLOW_SCREEN_ID = "ORDER_FORM";

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    return json({ error: "Beoliv WhatsApp secrets are not configured." }, 500);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const conversationId = body?.conversation_id as string | undefined;
    if (!conversationId) return json({ error: "conversation_id is required." }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: conv, error: convErr } = await supabase
      .from("beoliv_conversations")
      .select("id, phone")
      .eq("id", conversationId)
      .maybeSingle();

    if (convErr || !conv) return json({ error: "Conversation not found." }, 404);

    const bodyText = "Tap below to complete your order 👇";
    const flowCta = "Start Order";

    const waRes = await fetch(`${META_GRAPH_BASE}/${WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: conv.phone,
        type: "interactive",
        interactive: {
          type: "flow",
          body: { text: bodyText },
          action: {
            name: "flow",
            parameters: {
              flow_message_version: "3",
              flow_token: conv.id,
              flow_id: ORDER_FLOW_ID,
              flow_cta: flowCta,
              flow_action: "navigate",
              flow_action_payload: { screen: ORDER_FLOW_SCREEN_ID },
            },
          },
        },
      }),
    });
    const waData = await waRes.json();

    if (!waRes.ok) {
      console.error("WhatsApp flow send failed:", waData);
      return json({ error: waData?.error?.message || "WhatsApp send failed." }, 502);
    }

    await supabase.from("beoliv_messages").insert({
      conversation_id: conv.id,
      direction: "outbound",
      message_type: "flow",
      content: "order_flow",
      metadata: { flow_cta: flowCta, sent_by: "agent" },
      wa_message_id: waData?.messages?.[0]?.id ?? null,
      status: "sent",
    });
    await supabase
      .from("beoliv_conversations")
      .update({ last_message_at: new Date().toISOString(), human_handling: true })
      .eq("id", conv.id);

    return json({ success: true });
  } catch (err: any) {
    console.error("send-whatsapp-flow error:", err);
    return json({ error: err.message }, 500);
  }
});
