import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Lets a human agent send an image, video, or voice note to a Beoliv WhatsApp
// customer from the dashboard's Conversations tab. Uploads to the same
// creative-vault Storage bucket upload-creative already uses, then sends the
// resulting public URL to WhatsApp by link (no separate WhatsApp media-upload
// step needed). Resolves the sending number per-conversation (conversations ->
// buyer_whatsapp_numbers), same as send-whatsapp-message, falling back to the
// generic WHATSAPP_* secrets only for legacy conversations with no number row.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WHATSAPP_TOKEN_FALLBACK = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_ID_FALLBACK = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v21.0";

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
};
// audio/webm is deliberately NOT accepted: WhatsApp doesn't support it, so the
// dashboard converts Chrome's webm recordings to mp3 before uploading.

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
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const conversationId = formData.get("conversation_id") as string | null;
    const caption = (formData.get("caption") as string | null)?.trim() || undefined;

    if (!file || !conversationId) {
      return json({ error: "file and conversation_id are required." }, 400);
    }

    // Browsers append codec params ("audio/ogg;codecs=opus") -- match on the base type.
    const baseType = (file.type || "").split(";")[0].trim().toLowerCase();
    const mediaType = VALID_TYPES[baseType];
    if (!mediaType) {
      return json({ error: `Unsupported file type: ${file.type || "unknown"}` }, 400);
    }
    if (file.size > 16 * 1024 * 1024) {
      return json({ error: "File is too large (WhatsApp's limit is 16 MB)." }, 400);
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

    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const safeStem = file.name.replace(/[^a-z0-9.]/gi, "-");
    const bucketPath = `beoliv-agent-media/${mediaType}s/${timestamp}-${random}-${safeStem}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: storageError } = await supabase.storage
      .from("creative-vault")
      .upload(bucketPath, new Uint8Array(arrayBuffer), { contentType: baseType, upsert: false });

    if (storageError) {
      return json({ error: `Storage error: ${storageError.message}` }, 500);
    }

    const { data: urlData } = supabase.storage.from("creative-vault").getPublicUrl(bucketPath);
    const publicUrl = urlData?.publicUrl ?? "";

    const mediaPayload: Record<string, any> = { link: publicUrl };
    if (caption && mediaType !== "audio") mediaPayload.caption = caption; // WhatsApp doesn't support captions on audio

    const waRes = await fetch(`${META_GRAPH_BASE}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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

    await supabase.from("messages").insert({
      conversation_id: conv.id,
      direction: "outbound",
      message_type: "agent_media",
      content: caption || "",
      metadata: { url: publicUrl, media_type: mediaType, caption },
      wa_message_id: waData?.messages?.[0]?.id ?? null,
      status: "sent",
      company_id: conv.company_id,
    });
    await supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString(), human_handling: true })
      .eq("id", conv.id);

    return json({ success: true, url: publicUrl, media_type: mediaType });
  } catch (err: any) {
    console.error("send-whatsapp-media error:", err);
    return json({ error: err.message }, 500);
  }
});
