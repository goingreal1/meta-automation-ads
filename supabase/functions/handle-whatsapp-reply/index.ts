import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WEBHOOK_VERIFY_TOKEN") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v20.0";

async function setStatus(objectId: string, status: "ACTIVE" | "DELETED" | "PAUSED") {
  const params = new URLSearchParams({ access_token: META_ACCESS_TOKEN, status });
  const res = await fetch(`${META_GRAPH_BASE}/${objectId}?${params.toString()}`, { method: "POST" });
  return res.json();
}

async function sendWhatsApp(to: string, body: string) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return;
  await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
}

// Customer media (photos, voice notes, videos, documents) arrives as a Meta
// media id plus a short-lived URL that needs the number's access token to
// fetch -- so the dashboard couldn't show or play any of it. Download it now
// into the public creative-vault bucket (random path) and return a URL the
// dashboard can use directly.
const INBOUND_MEDIA_TYPES = ["image", "video", "audio", "document", "sticker"];
const MAX_INBOUND_MEDIA_BYTES = 20 * 1024 * 1024;
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "video/mp4": "mp4", "video/3gpp": "3gp",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr",
  "application/pdf": "pdf",
};

async function downloadInboundMedia(supabase: any, token: string, message: any) {
  const type = message.type;
  const media = message[type];
  if (!token || !media?.id) return null;

  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${media.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meta = await metaRes.json();
  if (!metaRes.ok || !meta?.url) {
    console.error("Inbound media lookup failed:", meta);
    return null;
  }
  if (meta.file_size && Number(meta.file_size) > MAX_INBOUND_MEDIA_BYTES) {
    console.warn(`Inbound ${type} too large to store (${meta.file_size} bytes).`);
    return null;
  }

  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!fileRes.ok) {
    console.error("Inbound media download failed:", fileRes.status);
    return null;
  }
  const bytes = new Uint8Array(await fileRes.arrayBuffer());
  if (bytes.length > MAX_INBOUND_MEDIA_BYTES) return null;

  const mime = (meta.mime_type || media.mime_type || "application/octet-stream").split(";")[0].trim().toLowerCase();
  const ext = EXT_BY_MIME[mime] || mime.split("/")[1] || "bin";
  const folder = type === "sticker" ? "image" : type;
  const path = `inbound-media/${folder}s/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("creative-vault").upload(path, bytes, { contentType: mime, upsert: false });
  if (error) {
    console.error("Inbound media upload failed:", error);
    return null;
  }
  const { data } = supabase.storage.from("creative-vault").getPublicUrl(path);
  return { url: data?.publicUrl as string, media_type: folder, mime_type: mime, filename: media.filename };
}

// Phone notification (Web Push) for staff when a customer messages in. Goes to
// the company's owners/admins/customer care plus the media buyer whose number
// or ads the chat belongs to; each device can switch "messages" off.
function pushPreview(type: string, content: string): string {
  const c = (content || "").replace(/\s+/g, " ").trim();
  if (type === "image") return "📷 " + (c || "Photo");
  if (type === "video") return "🎥 " + (c || "Video");
  if (type === "audio") return "🎤 Voice message";
  if (type === "document") return "📄 " + (c || "Document");
  if (type === "sticker") return "Sticker";
  if (type === "button" || type === "interactive") return "👆 " + c;
  return c || "New message";
}

// The push module is loaded lazily and guarded: this function receives every
// customer message from Meta, so a problem in the push code (or its npm
// dependency) must never be able to take the webhook down.
let _push: any = null;
async function getPush() {
  try {
    if (!_push) _push = (await import("./push.ts")).createPushFromEnv();
    return _push;
  } catch (err) {
    console.error("push module unavailable:", err);
    return null;
  }
}

function notifyInboundMessage(args: { companyId: string; mediaBuyerId: string | null; convId: string; title: string; type: string; content: string }) {
  const p = getPush().then((push) => push?.toAudience(
    { company_id: args.companyId, roles: ["owner", "admin", "customer_care"], media_buyer_id: args.mediaBuyerId },
    "messages",
    {
      title: args.title,
      body: pushPreview(args.type, args.content),
      url: `/dashboard_new.html?open=conv:${args.convId}`,
      tag: `conv-${args.convId}`,
    },
  )).catch((err) => console.error("push (inbound message) failed:", err));
  // Keep the function alive until the push finishes, without delaying Meta's 200.
  (globalThis as any).EdgeRuntime?.waitUntil?.(p);
}

// Any inbound message that isn't an APPROVE/REJECT admin command -- a real
// customer reply, most often the very first message after tapping "Send
// Message" on a Click-to-WhatsApp ad -- lands here instead of being dropped.
// Finds (or starts) the conversation in the same `conversations`/`messages`
// tables the dashboard's Conversations tab reads from, so a reply shows up
// there without any extra wiring on that side.
async function logInboundMessage(supabase: any, change: any, message: any) {
  const phoneNumberId = change?.value?.metadata?.phone_number_id;
  if (!phoneNumberId) {
    console.warn("Inbound WhatsApp message has no metadata.phone_number_id -- can't attribute it, dropping.");
    return;
  }

  // Which tenant this number belongs to -- set up once in Settings ->
  // WhatsApp Numbers (manage-whatsapp-numbers). A message on a number nobody
  // has connected yet has nowhere to go.
  const { data: numberRow } = await supabase
    .from("buyer_whatsapp_numbers")
    .select("id, company_id, media_buyer_id, access_token")
    .eq("phone_number_id", phoneNumberId)
    .eq("status", "active")
    .maybeSingle();
  if (!numberRow) {
    console.warn(`No active buyer_whatsapp_numbers row for phone_number_id ${phoneNumberId} -- message not attributed, dropped.`);
    return;
  }

  const from = message.from;
  const whatsappName = change?.value?.contacts?.[0]?.profile?.name || null;

  // Click-to-WhatsApp ads attach a `referral` block to the first message in a
  // conversation -- source_id is the real Meta ad id, ctwa_clid is the click
  // id Meta uses to tie this conversation back to exactly which ad produced
  // it (both columns already exist on `conversations` for this).
  const referral = message.referral;
  const adId = referral?.source_id || null;
  const ctwaClid = referral?.ctwa_clid || null;

  // .maybeSingle() errors out (not just returns null) if MORE than one row
  // matches -- and that error was being silently dropped here (only `data`
  // was destructured), so once two conversations existed for the same
  // phone+number (see the insert below), every lookup afterward looked like
  // "not found" and created yet ANOTHER new conversation, forever. Confirmed
  // live: this is exactly what turned one customer's ongoing chat into 3
  // separate threads. order+limit(1) makes this tolerant of any duplicates
  // still in the table (old or new), always continuing the most recent one.
  let { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("phone", from)
    .eq("buyer_whatsapp_number_id", numberRow.id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conv) {
    const { data: newConv, error: convErr } = await supabase
      .from("conversations")
      .insert({
        phone: from,
        current_state: "NEW",
        source: adId ? "ad" : "organic",
        ad_id: adId,
        ctwa_clid: ctwaClid,
        started_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        whatsapp_name: whatsappName,
        unread_count: 0,
        company_id: numberRow.company_id,
        buyer_whatsapp_number_id: numberRow.id,
        media_buyer_id: numberRow.media_buyer_id,
      })
      .select("id")
      .single();
    if (convErr?.code === "23505") {
      // Two messages from the same customer arrived close enough together
      // that both webhook deliveries ran this function concurrently, both
      // saw "no conversation yet" above, and both tried to create one --
      // the unique constraint on (phone, buyer_whatsapp_number_id) is what
      // actually closes that race (the lookup above can't, on its own,
      // between two overlapping requests). Whichever insert loses just
      // reuses the row the other one created, instead of erroring out.
      const { data: existing } = await supabase
        .from("conversations")
        .select("id")
        .eq("phone", from)
        .eq("buyer_whatsapp_number_id", numberRow.id)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!existing) {
        console.error("Conversation insert hit a conflict but no existing row was found:", convErr);
        return;
      }
      conv = existing;
    } else if (convErr || !newConv) {
      console.error("Failed to create conversation for inbound WhatsApp message:", convErr);
      return;
    } else {
      conv = newConv;
    }

    await supabase.from("conversation_customers").upsert(
      { phone: from, name: whatsappName, company_id: numberRow.company_id },
      { onConflict: "phone" }
    );
  }

  const type = message.type;
  let content = "";
  if (type === "text") content = message.text?.body ?? "";
  else if (type === "button") content = message.button?.text ?? "";
  else if (type === "interactive") content = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "";
  else content = message[type]?.caption ?? "";

  let metadata: any = message;
  if (INBOUND_MEDIA_TYPES.includes(type)) {
    try {
      const stored = await downloadInboundMedia(supabase, numberRow.access_token || WHATSAPP_TOKEN, message);
      if (stored) metadata = { ...message, ...stored };
    } catch (err) {
      console.error("downloadInboundMedia error:", err);
    }
  }

  const { error: msgErr } = await supabase.from("messages").insert({
    conversation_id: conv.id,
    direction: "inbound",
    message_type: type,
    content,
    metadata,
    wa_message_id: message.id || null,
    company_id: numberRow.company_id,
  });
  if (msgErr) {
    console.error("Failed to insert inbound WhatsApp message:", msgErr);
    return;
  }
  notifyInboundMessage({
    companyId: numberRow.company_id,
    mediaBuyerId: numberRow.media_buyer_id ?? null,
    convId: conv.id,
    title: whatsappName || from,
    type,
    content,
  });
}

// Receipts can arrive out of order (e.g. "read" before "delivered"), so a
// status only ever moves forward; "failed" always wins.
const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

async function applyStatusUpdates(supabase: any, statuses: any[]) {
  for (const s of statuses) {
    const id = s?.id;
    const next = s?.status;
    if (!id || !(next === "failed" || next in STATUS_RANK)) continue;

    const { data: row } = await supabase
      .from("messages")
      .select("id, status, metadata")
      .eq("wa_message_id", id)
      .eq("direction", "outbound")
      .maybeSingle();
    if (!row) continue;

    if (next !== "failed" && (STATUS_RANK[row.status] ?? 0) >= STATUS_RANK[next]) continue;

    // Keep Meta's reason for a failure so the dashboard can show why (e.g. an
    // unsupported audio format) instead of just a warning icon.
    const update: any = { status: next };
    if (next === "failed" && s.errors?.[0]) update.metadata = { ...(row.metadata ?? {}), error: s.errors[0] };
    const { error } = await supabase.from("messages").update(update).eq("id", row.id);
    if (error) console.error("Failed to update message status:", error);
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // Staff push notifications (PWA): public key, test push, server-to-server sends.
  // Claims only those requests; Meta's webhook traffic falls through untouched.
  // Only requests shaped like push calls are even handed to the push module, so
  // normal webhook traffic never depends on it loading.
  const isPushCall = (req.method === "GET" && url.searchParams.get("action") === "public_key") || req.method === "OPTIONS" ||
    (req.method === "POST" && /"(type":\s*"test"|audience")/.test(await req.clone().text().catch(() => "")));
  if (isPushCall) {
    const push = await getPush();
    if (!push) return new Response(JSON.stringify({ error: "push unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } });
    const pushResponse = await push.handle(req);
    if (pushResponse) return pushResponse;
  }

  // Meta webhook verification handshake (GET)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const payload = await req.json();

    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    // Meta delivery receipts for messages we sent (sent/delivered/read/failed).
    // Same webhook URL as inbound messages, but a different payload shape.
    const statuses = change?.value?.statuses;
    if (!message && Array.isArray(statuses) && statuses.length) {
      await applyStatusUpdates(supabase, statuses).catch((err) => console.error("applyStatusUpdates error:", err));
      return new Response("ok", { status: 200 });
    }

    if (!message) {
      return new Response("ok", { status: 200 });
    }

    const from = message.from; // sender's WhatsApp number
    const text = message.type === "text" ? (message.text?.body ?? "").trim() : "";

    const approveMatch = text.match(/^APPROVE\s+([a-f0-9-]+)/i);
    const rejectMatch = text.match(/^REJECT\s+([a-f0-9-]+)/i);

    if (!approveMatch && !rejectMatch) {
      // Not an admin command -- a real customer message (text, image, button
      // tap, etc). Log it into conversations/messages so it shows up in the
      // dashboard's Conversations tab.
      await logInboundMessage(supabase, change, message).catch((err) => console.error("logInboundMessage error:", err));
      return new Response("ok", { status: 200 });
    }

    const approvalId = (approveMatch ?? rejectMatch)![1];

    const { data: approval, error } = await supabase
      .from("pending_approvals")
      .select("*")
      .eq("id", approvalId)
      .maybeSingle();

    if (error || !approval) {
      // Say nothing to unknown senders: this webhook URL is public.
      return new Response("ok", { status: 200 });
    }

    // Only the company's own owner/admin may approve or reject: the sender's WhatsApp number must match
    // an owner/admin profile of the company this approval belongs to. (Anyone can POST to this URL, so the
    // "from" field alone proves nothing; the approval id is also not a secret.)
    const fromDigits = String(from ?? "").replace(/\D/g, "");
    const { data: staff } = await supabase.from("profiles").select("whatsapp_number")
      .eq("company_id", approval.company_id).in("role", ["owner", "admin"]);
    const senderOk = !!fromDigits && (staff ?? []).some((a: any) => {
      const d = String(a.whatsapp_number ?? "").replace(/\D/g, "");
      return !!d && (d === fromDigits || (d.startsWith("0") && "234" + d.slice(1) === fromDigits));
    });
    if (!senderOk) {
      console.warn(`handle-whatsapp-reply: ignored approval command from non-admin sender for ${approvalId}`);
      return new Response("ok", { status: 200 });
    }

    if (approval.status !== "pending") {
      await sendWhatsApp(from, `⚠️ Approval ${approvalId} was already ${approval.status}.`);
      return new Response("ok", { status: 200 });
    }

    if (approveMatch) {
      const action = approval.proposed_action as any;

      if (approval.approval_type === "launch_test" && action?.meta_campaign_id) {
        // ai-auto-launch-tests stores the ad sets' real Meta ids directly in
        // proposed_action.ad_set_ids -- activate those, not a DB lookup by
        // ad_sets.campaign_id (that column holds the Meta campaign id, not a
        // local campaigns.id, so the old join-based lookup here always matched
        // zero rows and left ad sets stuck PAUSED even after "approval").
        await setStatus(action.meta_campaign_id, "ACTIVE");

        const adSetMetaIds: string[] = Array.isArray(action.ad_set_ids) ? action.ad_set_ids : [];
        for (const metaAdsetId of adSetMetaIds) {
          await setStatus(metaAdsetId, "ACTIVE");
        }

        // campaigns row may not exist yet for a brand-new batch (pull-meta-metrics
        // upserts it on its next hourly sync) -- update is a no-op if so, not an error.
        await supabase.from("campaigns").update({ status: "active", launched_at: new Date().toISOString() }).eq("meta_campaign_id", action.meta_campaign_id);
        if (adSetMetaIds.length) {
          await supabase.from("ad_sets").update({ status: "active" }).in("meta_adset_id", adSetMetaIds);
        }
        await supabase.from("creative_assets").update({ test_status: "testing", tested_at: new Date().toISOString() }).eq("id", approval.creative_asset_id);
      }

      if (approval.approval_type === "scale_winner" && action?.meta_adset_id) {
        await setStatus(action.meta_adset_id, "ACTIVE");
      }

      if (approval.approval_type === "pause_ad" || approval.approval_type === "kill_ad") {
        if (action?.meta_adset_id) await setStatus(action.meta_adset_id, "PAUSED");
      }

      await supabase.from("pending_approvals").update({ status: "approved", responded_at: new Date().toISOString() }).eq("id", approvalId);
      await sendWhatsApp(from, `✅ Approved and launched: ${approval.reason ?? approvalId}`);
    }

    if (rejectMatch) {
      const action = approval.proposed_action as any;
      if (approval.approval_type === "launch_test" && action?.meta_campaign_id) {
        await setStatus(action.meta_campaign_id, "DELETED");
        await supabase.from("creative_assets").update({ test_status: "untested" }).eq("id", approval.creative_asset_id);
      }
      await supabase.from("pending_approvals").update({ status: "rejected", responded_at: new Date().toISOString() }).eq("id", approvalId);
      await sendWhatsApp(from, `❌ Rejected: ${approval.reason ?? approvalId}`);
    }

    return new Response("ok", { status: 200 });
  } catch (err: any) {
    console.error("handle-whatsapp-reply error:", err);
    return new Response("ok", { status: 200 }); // always 200 so Meta doesn't retry-storm
  }
});
