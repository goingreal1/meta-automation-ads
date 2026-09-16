import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Lets a human agent reply directly to a Beoliv WhatsApp customer from the
// dashboard's Conversations tab -- used for the "AI hand-off" case where a
// customer needs a real person, not just viewing the read-only thread.
//
// IMPORTANT: this project's generic WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID
// secrets belong to a DIFFERENT WhatsApp Business number ("Drive Shift", +49...),
// confirmed by calling the Graph API's own phone-number-identity endpoint -- not
// the Beoliv customer number. Beoliv's real credentials are stored separately as
// BEOLIV_WHATSAPP_ACCESS_TOKEN / BEOLIV_WHATSAPP_PHONE_NUMBER_ID. Do not switch
// this back to the generic names without re-checking the identity response below.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("BEOLIV_WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_ID = Deno.env.get("BEOLIV_WHATSAPP_PHONE_NUMBER_ID") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v18.0";

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
    return json({ error: "WhatsApp is not configured (missing WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID secrets)." }, 500);
  }

  // DIAGNOSTIC (temporary): report which WhatsApp number these secrets actually
  // belong to on every call, since a reply sent here didn't reach the expected
  // customer's phone and we need to confirm this project's WHATSAPP_* secrets
  // are really the Beoliv bot's number, not a different internal/alerts number.
  let whatsappIdentity: any = null;
  try {
    const idRes = await fetch(
      `${META_GRAPH_BASE}/${WHATSAPP_PHONE_ID}?fields=display_phone_number,verified_name&access_token=${WHATSAPP_TOKEN}`
    );
    whatsappIdentity = await idRes.json();
  } catch (e) {
    whatsappIdentity = { error: String(e) };
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
      .from("beoliv_conversations")
      .select("id, phone")
      .eq("id", conversationId)
      .maybeSingle();

    if (convErr || !conv) {
      return json({ error: "Conversation not found." }, 404);
    }

    const waRes = await fetch(`${META_GRAPH_BASE}/${WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
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
      return json({ error: waData?.error?.message || "WhatsApp send failed.", whatsapp_identity: whatsappIdentity, to: conv.phone }, 502);
    }

    // message_type "agent_text" (not "text") so the dashboard can show it was a
    // human reply, not a bot message -- the bot itself never writes this type.
    // wa_message_id + status power the same read-receipt ticks bot messages
    // get -- was never captured here, so a human agent's replies never showed
    // delivery status at all, only bot ones.
    await supabase.from("beoliv_messages").insert({
      conversation_id: conv.id,
      direction: "outbound",
      message_type: "agent_text",
      content: text,
      wa_message_id: waData?.messages?.[0]?.id ?? null,
      status: "sent",
    });
    await supabase
      .from("beoliv_conversations")
      .update({ last_message_at: new Date().toISOString(), human_handling: true })
      .eq("id", conv.id);

    return json({ success: true, whatsapp_identity: whatsappIdentity, to: conv.phone });
  } catch (err: any) {
    console.error("send-whatsapp-message error:", err);
    return json({ error: err.message }, 500);
  }
});
