import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Lets a human agent reply directly to a WhatsApp customer from the
// dashboard's Conversations tab -- used for the "AI hand-off" case where a
// customer needs a real person, not just viewing the read-only thread.
//
// Resolves which real WhatsApp number to send from per-conversation (via
// conversations.buyer_whatsapp_number_id -> buyer_whatsapp_numbers), not a
// single hardcoded number -- each company can have its own connected
// number (Settings -> WhatsApp Numbers). Falls back to the project's
// generic WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID secrets only if a
// conversation has no connected number row (legacy data).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WHATSAPP_TOKEN_FALLBACK = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_ID_FALLBACK = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v21.0";

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

  try {
    const body = await req.json().catch(() => ({}));
    const conversationId = body?.conversation_id as string | undefined;
    const text = (body?.text as string | undefined)?.trim();

    if (!conversationId || !text) {
      return json({ error: "conversation_id and text are required." }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .select("id, phone, company_id, buyer_whatsapp_numbers(phone_number_id, access_token)")
      .eq("id", conversationId)
      .maybeSingle();

    if (convErr || !conv) {
      return json({ error: "Conversation not found." }, 404);
    }

    const numberRow = conv.buyer_whatsapp_numbers as any;
    const phoneId = numberRow?.phone_number_id || WHATSAPP_PHONE_ID_FALLBACK;
    const token = numberRow?.access_token || WHATSAPP_TOKEN_FALLBACK;

    if (!phoneId || !token) {
      return json({ error: "No WhatsApp number is connected for this conversation (Settings -> WhatsApp Numbers)." }, 500);
    }

    const waRes = await fetch(`${META_GRAPH_BASE}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: conv.phone,
        type: "text",
        text: { body: text },
      }),
    });
    const waData = await waRes.json();

    if (!waRes.ok) {
      console.error("WhatsApp send failed:", waData);
      return json({ error: waData?.error?.message || "WhatsApp send failed.", to: conv.phone }, 502);
    }

    // message_type "agent_text" (not "text") so the dashboard can show it was a
    // human reply, not a bot message -- the bot itself never writes this type.
    // wa_message_id + status power the same read-receipt ticks bot messages get.
    await supabase.from("messages").insert({
      conversation_id: conv.id,
      direction: "outbound",
      message_type: "agent_text",
      content: text,
      wa_message_id: waData?.messages?.[0]?.id ?? null,
      status: "sent",
      company_id: conv.company_id,
    });
    await supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString(), human_handling: true })
      .eq("id", conv.id);

    return json({ success: true, to: conv.phone });
  } catch (err: any) {
    console.error("send-whatsapp-message error:", err);
    return json({ error: err.message }, 500);
  }
});
