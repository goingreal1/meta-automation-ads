import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Lets a human agent send an image, video, or voice note to a Beoliv WhatsApp
// customer from the dashboard's Conversations tab. Uploads to the same
// creative-vault Storage bucket upload-creative already uses, then sends the
// resulting public URL to WhatsApp by link (no separate WhatsApp media-upload
// step needed). Uses the same BEOLIV_WHATSAPP_* secrets as send-whatsapp-message
// -- see that function's header comment for why NOT the generic WHATSAPP_* ones.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("BEOLIV_WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_ID = Deno.env.get("BEOLIV_WHATSAPP_PHONE_NUMBER_ID") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v18.0";

const VALID_TYPES: Record<string, "image" | "video" | "audio"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "video/3gpp": "video",
  "audio/aac": "audio",
  "audio/mp4": "audio",
  "audio/mpeg": "audio",
  "audio/amr": "audio",
  "audio/ogg": "audio",
  "audio/webm": "audio", // browsers commonly record voice notes as webm; WhatsApp
                          // itself doesn't list it, but Meta transcodes on send
};

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
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const conversationId = formData.get("conversation_id") as string | null;
    const caption = (formData.get("caption") as string | null)?.trim() || undefined;

    if (!file || !conversationId) {
      return json({ error: "file and conversation_id are required." }, 400);
    }

    const mediaType = VALID_TYPES[file.type];
    if (!mediaType) {
      return json({ error: `Unsupported file type: ${file.type}` }, 400);
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

    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const safeStem = file.name.replace(/[^a-z0-9.]/gi, "-");
    const bucketPath = `beoliv-agent-media/${mediaType}s/${timestamp}-${random}-${safeStem}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: storageError } = await supabase.storage
      .from("creative-vault")
      .upload(bucketPath, new Uint8Array(arrayBuffer), { contentType: file.type, upsert: false });

    if (storageError) {
      return json({ error: `Storage error: ${storageError.message}` }, 500);
    }

    const { data: urlData } = supabase.storage.from("creative-vault").getPublicUrl(bucketPath);
    const publicUrl = urlData?.publicUrl ?? "";

    const mediaPayload: Record<string, any> = { link: publicUrl };
    if (caption && mediaType !== "audio") mediaPayload.caption = caption; // WhatsApp doesn't support captions on audio

    const waRes = await fetch(`${META_GRAPH_BASE}/${WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: conv.phone,
        type: mediaType,
        [mediaType]: mediaPayload,
      }),
    });
    const waData = await waRes.json();

    if (!waRes.ok) {
      console.error("WhatsApp media send failed:", waData);
      return json({ error: waData?.error?.message || "WhatsApp send failed." }, 502);
    }

    await supabase.from("beoliv_messages").insert({
      conversation_id: conv.id,
      direction: "outbound",
      message_type: "agent_media",
      content: caption || "",
      metadata: { url: publicUrl, media_type: mediaType, caption },
      wa_message_id: waData?.messages?.[0]?.id ?? null,
      status: "sent",
    });
    await supabase
      .from("beoliv_conversations")
      .update({ last_message_at: new Date().toISOString(), human_handling: true })
      .eq("id", conv.id);

    return json({ success: true, url: publicUrl, media_type: mediaType });
  } catch (err: any) {
    console.error("send-whatsapp-media error:", err);
    return json({ error: err.message }, 500);
  }
});
