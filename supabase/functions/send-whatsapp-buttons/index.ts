import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Lets a human agent send an interactive message (quick-reply buttons, or a
// clickable website link) from the dashboard's Conversations tab -- the
// manual-reply equivalent of the bot's own sendButtons()/sendUrlButton().
// A tapped reply button still arrives back through the bot's normal webhook
// and gets logged, but human_handling=true means the bot itself stays silent
// on it (same as any other agent-sent message) -- the agent sees the tap in
// the thread and acts on it themselves.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("BEOLIV_WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_ID = Deno.env.get("BEOLIV_WHATSAPP_PHONE_NUMBER_ID") ?? "";
const WEBSITE_URL = Deno.env.get("BEOLIV_WEBSITE_URL") ?? "";
// The company's own CRM order form -- must stay in sync with ORDER_FORM_URL
// in beoliv-whatsapp-funnel/src/config/product.ts if that ever changes.
const ORDER_FORM_URL = "https://crmbeyce.clouderp.one/forms?token=6f63e4c34e";
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
    const text = (body?.text as string | undefined)?.trim();
    // Either a small set of reply buttons (max 3, WhatsApp's own limit), or a
    // single clickable link -- these are two different WhatsApp message types
    // (interactive "button" vs "cta_url") and can't be combined in one message.
    const buttons = (body?.buttons as Array<{ id: string; title: string }> | undefined) || null;
    const mode = body?.mode as "website" | "order" | undefined;
    const imageUrl = (body?.image_url as string | undefined)?.trim() || null;

    if (!conversationId || !text) {
      return json({ error: "conversation_id and text are required." }, 400);
    }
    if (!mode && (!buttons || !buttons.length)) {
      return json({ error: "buttons are required unless mode is 'website' or 'order'." }, 400);
    }
    if (mode === "website" && !WEBSITE_URL) {
      return json({ error: "BEOLIV_WEBSITE_URL is not configured." }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: conv, error: convErr } = await supabase
      .from("beoliv_conversations")
      .select("id, phone")
      .eq("id", conversationId)
      .maybeSingle();

    if (convErr || !conv) return json({ error: "Conversation not found." }, 404);

    const interactive: any = mode
      ? {
          type: "cta_url",
          body: { text },
          action: {
            name: "cta_url",
            parameters:
              mode === "order"
                ? { display_text: "Complete Order", url: ORDER_FORM_URL }
                : { display_text: "View Website", url: WEBSITE_URL },
          },
        }
      : {
          type: "button",
          body: { text },
          action: { buttons: buttons!.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
        };
    if (imageUrl) interactive.header = { type: "image", image: { link: imageUrl } };

    const waRes = await fetch(`${META_GRAPH_BASE}/${WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: conv.phone, type: "interactive", interactive }),
    });
    const waData = await waRes.json();

    if (!waRes.ok) {
      console.error("WhatsApp buttons send failed:", waData);
      return json({ error: waData?.error?.message || "WhatsApp send failed." }, 502);
    }

    await supabase.from("beoliv_messages").insert({
      conversation_id: conv.id,
      direction: "outbound",
      message_type: "agent_text",
      content: text,
      metadata: mode
        ? { cta_url: mode === "order" ? ORDER_FORM_URL : WEBSITE_URL, image_url: imageUrl, sent_by: "agent" }
        : { buttons, image_url: imageUrl, sent_by: "agent" },
      wa_message_id: waData?.messages?.[0]?.id ?? null,
      status: "sent",
    });
    await supabase
      .from("beoliv_conversations")
      .update({ last_message_at: new Date().toISOString(), human_handling: true })
      .eq("id", conv.id);

    return json({ success: true });
  } catch (err: any) {
    console.error("send-whatsapp-buttons error:", err);
    return json({ error: err.message }, 500);
  }
});
