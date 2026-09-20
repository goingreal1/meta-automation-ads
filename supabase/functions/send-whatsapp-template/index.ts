import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Sends an approved WhatsApp message template to re-open a conversation once
// the 24-hour free-form messaging window has closed (WhatsApp's own rule --
// after 24h since the customer's last message, only a pre-approved template
// can reach them, never plain text). Used from the dashboard for exactly
// this: following up with a lead from 1+ days ago. template_name must
// already be APPROVED in Meta's WhatsApp Manager before this will work --
// this function can't create or approve one, only send an existing one.

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
    return json({ error: "Beoliv WhatsApp secrets are not configured." }, 500);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const conversationId = body?.conversation_id as string | undefined;
    const templateName = (body?.template_name as string | undefined)?.trim();
    const languageCode = (body?.language_code as string | undefined)?.trim() || "en";
    // Optional {{1}}, {{2}}... body variables, in order -- e.g. [customerName]
    const bodyParams = (body?.body_params as string[] | undefined) || [];

    if (!conversationId || !templateName) {
      return json({ error: "conversation_id and template_name are required." }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: conv, error: convErr } = await supabase
      .from("beoliv_conversations")
      .select("id, phone")
      .eq("id", conversationId)
      .maybeSingle();

    if (convErr || !conv) return json({ error: "Conversation not found." }, 404);

    const components: any[] = [];
    if (bodyParams.length) {
      components.push({ type: "body", parameters: bodyParams.map((p) => ({ type: "text", text: p })) });
    }
    // beoliv_followup_v1's button is a static FLOW type (opens the order Flow
    // directly, flow_id/screen baked into the template) -- confirmed via the
    // template's own definition (GET /{template_id}). Meta still requires an
    // explicit components entry for it at send time even though there's
    // nothing dynamic to fill in, or the send fails with a misleading
    // "(#131009) Parameter value is not valid" instead of a clearer
    // missing-component error. Same quirk already handled in the bot's own
    // sendTemplate() for the per-package product templates.
    components.push({ type: "button", sub_type: "flow", index: 0, parameters: [{ type: "action", action: {} }] });

    const waRes = await fetch(`${META_GRAPH_BASE}/${WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: conv.phone,
        type: "template",
        template: { name: templateName, language: { code: languageCode }, components },
      }),
    });
    const waData = await waRes.json();

    if (!waRes.ok) {
      console.error("WhatsApp template send failed:", waData);
      return json({ error: waData?.error?.message || "WhatsApp send failed. Is the template approved and named exactly right?" }, 502);
    }

    await supabase.from("beoliv_messages").insert({
      conversation_id: conv.id,
      direction: "outbound",
      message_type: "template",
      content: templateName,
      metadata: { template_name: templateName, body_params: bodyParams, sent_by: "agent" },
      wa_message_id: waData?.messages?.[0]?.id ?? null,
      status: "sent",
    });
    // last_message_at is kept current by the bv_on_message_insert DB trigger
    // on every beoliv_messages insert -- only human_handling needs setting here.
    await supabase.from("beoliv_conversations").update({ human_handling: true }).eq("id", conv.id);

    return json({ success: true });
  } catch (err: any) {
    console.error("send-whatsapp-template error:", err);
    return json({ error: err.message }, 500);
  }
});
