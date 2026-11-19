import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withR2 } from "../_shared/r2storage.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WEBHOOK_VERIFY_TOKEN") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v20.0";
async function setStatus(objectId, status) {
  const params = new URLSearchParams({
    access_token: META_ACCESS_TOKEN,
    status
  });
  const res = await fetch(`${META_GRAPH_BASE}/${objectId}?${params.toString()}`, {
    method: "POST"
  });
  return res.json();
}
async function sendWhatsApp(to, body) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return;
  await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        body
      }
    })
  });
}
// ---------------------------------------------------------------------------
// Revora's own social posts: the HQ admin approves / skips / edits a waiting post
// from WhatsApp. social-admin sends the message with three buttons whose ids look
// like SOC_APPROVE:<post id>, SOC_SKIP:<post id>, SOC_EDIT:<post id>.
// Edit works in two steps: the Edit button puts the admin in "edit mode" (kept in
// social_settings.wa_edit_post_id for 30 minutes) and their next text message
// becomes the new caption. Everything here is guarded: any problem returns false
// and the normal webhook logic carries on untouched.
// ---------------------------------------------------------------------------
const BEOLIV_WA_TOKEN = Deno.env.get("BEOLIV_WHATSAPP_ACCESS_TOKEN") ?? "";
const BEOLIV_WA_PHONE_ID = Deno.env.get("BEOLIV_WHATSAPP_PHONE_NUMBER_ID") ?? "";
const SOCIAL_SITE_LINK = "https://outreachhq.xyz";
const EDIT_WINDOW_MS = 30 * 60_000;
const onlyDigits = (s)=>String(s ?? "").replace(/\D/g, "");
function sameNumber(a, b) {
  const x = onlyDigits(a), y = onlyDigits(b);
  if (!x || !y) return false;
  return x === y || y.startsWith("0") && "234" + y.slice(1) === x || x.startsWith("0") && "234" + x.slice(1) === y;
}
const socialWat = (iso)=>new Date(new Date(iso).getTime() + 3600_000).toISOString().replace("T", " ").slice(0, 16) + " (Lagos)";
async function socialSend(phoneId, to, body) {
  const tok = phoneId && phoneId === BEOLIV_WA_PHONE_ID && BEOLIV_WA_TOKEN ? BEOLIV_WA_TOKEN : WHATSAPP_TOKEN || BEOLIV_WA_TOKEN;
  if (!tok || !phoneId) return;
  await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tok}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      ...body
    })
  });
}
const socialText = (phoneId, to, text)=>socialSend(phoneId, to, {
    type: "text",
    text: {
      body: text
    }
  });
const socialButtons = (phoneId, to, postId, text)=>socialSend(phoneId, to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: text.slice(0, 1000)
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: `SOC_APPROVE:${postId}`,
              title: "\u2705 Approve"
            }
          },
          {
            type: "reply",
            reply: {
              id: `SOC_SKIP:${postId}`,
              title: "\u23ed Skip"
            }
          },
          {
            type: "reply",
            reply: {
              id: `SOC_EDIT:${postId}`,
              title: "\u270f\ufe0f Edit"
            }
          }
        ]
      }
    }
  });
async function isSocialAdmin(supabase, from) {
  const { data: admins } = await supabase.from("platform_admins").select("user_id");
  const ids = (admins ?? []).map((a)=>a.user_id);
  if (!ids.length) return false;
  const { data: profs } = await supabase.from("profiles").select("whatsapp_number").in("id", ids);
  return (profs ?? []).some((p)=>sameNumber(from, p.whatsapp_number));
}
async function clearEditMode(supabase) {
  await supabase.from("social_settings").update({
    wa_edit_post_id: null,
    wa_edit_at: null
  }).eq("id", 1);
}
// Returns true when the message was a social approval action (already answered), false to let the normal logic run.
async function handleSocial(supabase, change, message, from, text) {
  const phoneId = String(change?.value?.metadata?.phone_number_id ?? "");
  const payload = String(message.button?.payload ?? message.interactive?.button_reply?.id ?? "");
  const m = payload.match(/^SOC_(APPROVE|SKIP|EDIT):([0-9a-f-]{36})$/i);
  if (m) {
    if (!await isSocialAdmin(supabase, from)) {
      console.warn("handle-whatsapp-reply: ignored social button from a non-admin sender");
      return true;
    }
    const action = m[1].toUpperCase(), id = m[2];
    const { data: post } = await supabase.from("social_posts").select("id, status, scheduled_for, caption_ig").eq("id", id).maybeSingle();
    if (!post) {
      await socialText(phoneId, from, "I can't find that post any more.");
      return true;
    }
    if (post.status === "posted") {
      await socialText(phoneId, from, "That post is already live, so nothing was changed.");
      return true;
    }
    if (action === "APPROVE") {
      const upd = {
        status: "approved",
        error: null,
        attempts: 0
      };
      const future = post.scheduled_for && new Date(post.scheduled_for).getTime() > Date.now();
      if (!future) upd.scheduled_for = new Date().toISOString();
      const { error } = await supabase.from("social_posts").update(upd).eq("id", id);
      if (error) {
        await socialText(phoneId, from, "Sorry, I could not approve it. Try again or use Revora HQ.");
        return true;
      }
      await socialText(phoneId, from, future ? `\u2705 Approved. It posts at ${socialWat(post.scheduled_for)}.` : "\u2705 Approved. It posts in the next few minutes.");
      return true;
    }
    if (action === "SKIP") {
      const { error } = await supabase.from("social_posts").update({
        status: "skipped",
        error: null,
        attempts: 0
      }).eq("id", id);
      await socialText(phoneId, from, error ? "Sorry, I could not skip it. Try again or use Revora HQ." : "\u23ed Skipped. It will not be posted.");
      return true;
    }
    // EDIT
    const { error } = await supabase.from("social_settings").update({
      wa_edit_post_id: id,
      wa_edit_at: new Date().toISOString()
    }).eq("id", 1);
    await socialText(phoneId, from, error ? "Sorry, I could not start the edit. Use Revora HQ instead." : "\u270f\ufe0f Send the new Instagram caption in your next message. I will update the Facebook one too. Send CANCEL to stop.");
    return true;
  }
  // A plain text message while edit mode is on = the new caption.
  if (message.type === "text") {
    const { data: s } = await supabase.from("social_settings").select("wa_edit_post_id, wa_edit_at").eq("id", 1).maybeSingle();
    if (!s?.wa_edit_post_id || !s.wa_edit_at) return false;
    if (Date.now() - new Date(s.wa_edit_at).getTime() > EDIT_WINDOW_MS) return false;
    if (/^(APPROVE|REJECT)\s/i.test(text)) return false;
    if (!await isSocialAdmin(supabase, from)) return false;
    if (/^cancel$/i.test(text.trim())) {
      await clearEditMode(supabase);
      await socialText(phoneId, from, "Okay, nothing was changed.");
      return true;
    }
    const ig = text.trim().slice(0, 2200);
    if (ig.length < 5) {
      await socialText(phoneId, from, "That is too short for a caption. Send the full caption, or CANCEL.");
      return true;
    }
    const { data: post } = await supabase.from("social_posts").select("id, status, scheduled_for").eq("id", s.wa_edit_post_id).maybeSingle();
    if (!post || post.status === "posted") {
      await clearEditMode(supabase);
      await socialText(phoneId, from, "That post is gone or already live, so I did not change it.");
      return true;
    }
    // Facebook gets the same words: no trailing hashtag line, and "Link in bio" swapped for the link.
    const fb = ig.replace(/\n[ \t]*(#\w+[ \t]*)+$/, "").replace(/link in bio\.?/i, SOCIAL_SITE_LINK).trim();
    const { error } = await supabase.from("social_posts").update({
      caption_ig: ig,
      caption_fb: fb,
      status: "draft",
      error: null,
      attempts: 0
    }).eq("id", post.id);
    if (error) {
      await socialText(phoneId, from, "Sorry, I could not save the new caption. Your edit mode is still on, so try again.");
      return true;
    }
    await clearEditMode(supabase);
    const hook = ig.split("\n")[0].slice(0, 90);
    const when = post.scheduled_for ? socialWat(post.scheduled_for) : "as soon as you approve";
    await socialButtons(phoneId, from, post.id, `\u270f\ufe0f Caption updated.\n\nWhen: ${when}\n"${hook}"\n\nApprove it to post.`);
    return true;
  }
  return false;
}
// Customer media (photos, voice notes, videos, documents) arrives as a Meta
// media id plus a short-lived URL that needs the number's access token to
// fetch -- so the dashboard couldn't show or play any of it. Download it now
// into the public creative-vault bucket (random path) and return a URL the
// dashboard can use directly.
const INBOUND_MEDIA_TYPES = [
  "image",
  "video",
  "audio",
  "document",
  "sticker"
];
const MAX_INBOUND_MEDIA_BYTES = 20 * 1024 * 1024;
const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "application/pdf": "pdf"
};
async function downloadInboundMedia(supabase, token, message) {
  const type = message.type;
  const media = message[type];
  if (!token || !media?.id) return null;
  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${media.id}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
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
  const fileRes = await fetch(meta.url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
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
  const { error } = await supabase.storage.from("creative-vault").upload(path, bytes, {
    contentType: mime,
    upsert: false
  });
  if (error) {
    console.error("Inbound media upload failed:", error);
    return null;
  }
  const { data } = supabase.storage.from("creative-vault").getPublicUrl(path);
  return {
    url: data?.publicUrl,
    media_type: folder,
    mime_type: mime,
    filename: media.filename
  };
}
// Phone notification (Web Push) for staff when a customer messages in. Goes to
// the company's owners/admins/customer care plus the media buyer whose number
// or ads the chat belongs to; each device can switch "messages" off.
function pushPreview(type, content) {
  const c = (content || "").replace(/\s+/g, " ").trim();
  if (type === "image") return "\ud83d\udcf7 " + (c || "Photo");
  if (type === "video") return "\ud83c\udfa5 " + (c || "Video");
  if (type === "audio") return "\ud83c\udfa4 Voice message";
  if (type === "document") return "\ud83d\udcc4 " + (c || "Document");
  if (type === "sticker") return "Sticker";
  if (type === "button" || type === "interactive") return "\ud83d\udc46 " + c;
  return c || "New message";
}
// The push module is loaded lazily and guarded: this function receives every
// customer message from Meta, so a problem in the push code (or its npm
// dependency) must never be able to take the webhook down.
let _push = null;
async function getPush() {
  try {
    if (!_push) _push = (await import("./push.ts")).createPushFromEnv();
    return _push;
  } catch (err) {
    console.error("push module unavailable:", err);
    return null;
  }
}
function notifyInboundMessage(args) {
  const p = getPush().then((push)=>push?.toAudience({
      company_id: args.companyId,
      roles: [
        "owner",
        "admin",
        "customer_care"
      ],
      media_buyer_id: args.mediaBuyerId
    }, "messages", {
      title: args.title,
      body: pushPreview(args.type, args.content),
      url: `/dashboard_new.html?open=conv:${args.convId}`,
      tag: `conv-${args.convId}`
    })).catch((err)=>console.error("push (inbound message) failed:", err));
  // Keep the function alive until the push finishes, without delaying Meta's 200.
  globalThis.EdgeRuntime?.waitUntil?.(p);
}
// Any inbound message that isn't an APPROVE/REJECT admin command -- a real
// customer reply, most often the very first message after tapping "Send
// Message" on a Click-to-WhatsApp ad -- lands here instead of being dropped.
// Finds (or starts) the conversation in the same `conversations`/`messages`
// tables the dashboard's Conversations tab reads from, so a reply shows up
// there without any extra wiring on that side.
async function logInboundMessage(supabase, change, message) {
  const phoneNumberId = change?.value?.metadata?.phone_number_id;
  if (!phoneNumberId) {
    console.warn("Inbound WhatsApp message has no metadata.phone_number_id -- can't attribute it, dropping.");
    return;
  }
  // Which tenant this number belongs to -- set up once in Settings ->
  // WhatsApp Numbers (manage-whatsapp-numbers). A message on a number nobody
  // has connected yet has nowhere to go.
  const { data: numberRow } = await supabase.from("buyer_whatsapp_numbers").select("id, company_id, media_buyer_id, access_token").eq("phone_number_id", phoneNumberId).eq("status", "active").maybeSingle();
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
  let { data: conv } = await supabase.from("conversations").select("id").eq("phone", from).eq("buyer_whatsapp_number_id", numberRow.id).order("started_at", {
    ascending: false
  }).limit(1).maybeSingle();
  if (!conv) {
    const { data: newConv, error: convErr } = await supabase.from("conversations").insert({
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
      media_buyer_id: numberRow.media_buyer_id
    }).select("id").single();
    if (convErr?.code === "23505") {
      // Two messages from the same customer arrived close enough together
      // that both webhook deliveries ran this function concurrently, both
      // saw "no conversation yet" above, and both tried to create one --
      // the unique constraint on (phone, buyer_whatsapp_number_id) is what
      // actually closes that race (the lookup above can't, on its own,
      // between two overlapping requests). Whichever insert loses just
      // reuses the row the other one created, instead of erroring out.
      const { data: existing } = await supabase.from("conversations").select("id").eq("phone", from).eq("buyer_whatsapp_number_id", numberRow.id).order("started_at", {
        ascending: false
      }).limit(1).maybeSingle();
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
    await supabase.from("conversation_customers").upsert({
      phone: from,
      name: whatsappName,
      company_id: numberRow.company_id
    }, {
      onConflict: "phone"
    });
  }
  const type = message.type;
  let content = "";
  if (type === "text") content = message.text?.body ?? "";
  else if (type === "button") content = message.button?.text ?? "";
  else if (type === "interactive") content = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "";
  else content = message[type]?.caption ?? "";
  let metadata = message;
  if (INBOUND_MEDIA_TYPES.includes(type)) {
    try {
      const stored = await downloadInboundMedia(supabase, numberRow.access_token || WHATSAPP_TOKEN, message);
      if (stored) metadata = {
        ...message,
        ...stored
      };
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
    company_id: numberRow.company_id
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
    content
  });
}
// Receipts can arrive out of order (e.g. "read" before "delivered"), so a
// status only ever moves forward; "failed" always wins.
const STATUS_RANK = {
  sent: 1,
  delivered: 2,
  read: 3
};
async function applyStatusUpdates(supabase, statuses) {
  for (const s of statuses){
    const id = s?.id;
    const next = s?.status;
    if (!id || !(next === "failed" || next in STATUS_RANK)) continue;
    const { data: row } = await supabase.from("messages").select("id, status, metadata").eq("wa_message_id", id).eq("direction", "outbound").maybeSingle();
    if (!row) continue;
    if (next !== "failed" && (STATUS_RANK[row.status] ?? 0) >= STATUS_RANK[next]) continue;
    // Keep Meta's reason for a failure so the dashboard can show why (e.g. an
    // unsupported audio format) instead of just a warning icon.
    const update = {
      status: next
    };
    if (next === "failed" && s.errors?.[0]) update.metadata = {
      ...row.metadata ?? {},
      error: s.errors[0]
    };
    const { error } = await supabase.from("messages").update(update).eq("id", row.id);
    if (error) console.error("Failed to update message status:", error);
  }
}
Deno.serve(async (req)=>{
  const url = new URL(req.url);
  // Staff push notifications (PWA): public key, test push, server-to-server sends.
  // Claims only those requests; Meta's webhook traffic falls through untouched.
  // Only requests shaped like push calls are even handed to the push module, so
  // normal webhook traffic never depends on it loading.
  const isPushCall = req.method === "GET" && url.searchParams.get("action") === "public_key" || req.method === "OPTIONS" || req.method === "POST" && /"(type":\s*"test"|audience")/.test(await req.clone().text().catch(()=>""));
  if (isPushCall) {
    const push = await getPush();
    if (!push) return new Response(JSON.stringify({
      error: "push unavailable"
    }), {
      status: 503,
      headers: {
        "Content-Type": "application/json"
      }
    });
    const pushResponse = await push.handle(req);
    if (pushResponse) return pushResponse;
  }
  // Meta webhook verification handshake (GET)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge ?? "", {
        status: 200
      });
    }
    return new Response("Forbidden", {
      status: 403
    });
  }
  try {
    const supabase = withR2(createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY));
    const payload = await req.json();
    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    // Meta delivery receipts for messages we sent (sent/delivered/read/failed).
    // Same webhook URL as inbound messages, but a different payload shape.
    const statuses = change?.value?.statuses;
    if (!message && Array.isArray(statuses) && statuses.length) {
      await supabase.from("wa_status_log").insert(statuses.map((x)=>({ wa_message_id: x?.id ?? null, recipient: x?.recipient_id ?? null, status: x?.status ?? null, error: x?.errors?.[0] ?? null }))).then(()=>{}, ()=>{});
      await applyStatusUpdates(supabase, statuses).catch((err)=>console.error("applyStatusUpdates error:", err));
      return new Response("ok", {
        status: 200
      });
    }
    if (!message) {
      return new Response("ok", {
        status: 200
      });
    }
    // Remember when this person last messaged us (opens WhatsApp's 24h free-reply window for reports).
    if (message?.from) await supabase.from("wa_last_inbound").upsert({ phone: String(message.from).replace(/\D/g, ""), at: new Date().toISOString() }).then(()=>{}, ()=>{});
    const from = message.from; // sender's WhatsApp number
    const text = message.type === "text" ? (message.text?.body ?? "").trim() : "";
    // Revora social-post approvals (Approve / Skip / Edit buttons and the edit reply). Guarded: on any problem it
    // returns false and the normal handling below runs exactly as before.
    const socialHandled = await handleSocial(supabase, change, message, from, text).catch((err)=>{
      console.error("handleSocial error:", err);
      return false;
    });
    if (socialHandled) return new Response("ok", {
      status: 200
    });
    // Ad launch approvals prepared by an AI assistant (launch-wa sends the Launch / Cancel buttons). The tap is checked
    // inside launch-wa (one-time secret in the button id + the requester's own number); this only hands it over.
    const launchPayload = String(message.button?.payload ?? message.interactive?.button_reply?.id ?? "");
    if (/^LAUNCH_(OK|NO):/i.test(launchPayload)) {
      const lp = fetch(`${SUPABASE_URL}/functions/v1/launch-wa`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          event: "reply",
          payload: launchPayload,
          from
        })
      }).catch((err)=>console.error("launch-wa reply failed:", err));
      globalThis.EdgeRuntime?.waitUntil?.(lp);
      return new Response("ok", {
        status: 200
      });
    }
    // "I've paid" quick-reply button on the payment request (send-payment-whatsapp). Re-check the payment right away;
    // notify-customer answers the customer. The payment itself is only ever confirmed by the Paystack webhook.
    const paidPayload = String(message.button?.payload ?? message.interactive?.button_reply?.id ?? "");
    const paidMatch = paidPayload.match(/^PAID:([a-f0-9-]{36})$/i);
    if (paidMatch) {
      const p = fetch(`${SUPABASE_URL}/functions/v1/notify-customer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          order_id: paidMatch[1],
          event: "paid_claimed",
          from
        })
      }).catch((err)=>console.error("notify-customer (paid_claimed) failed:", err));
      globalThis.EdgeRuntime?.waitUntil?.(p);
      return new Response("ok", {
        status: 200
      });
    }
    // "Confirm order" / "Cancel order" buttons on the order-confirmation template, or a short typed yes / no.
    // notify-customer checks the sender really is the customer, then confirms (order -> valid, which starts delivery)
    // or cancels the order. The message is then logged below as normal, so staff still see it in the dashboard.
    const decisionPayload = String(message.button?.payload ?? message.interactive?.button_reply?.id ?? "");
    const decisionMatch = decisionPayload.match(/^(CONFIRM_ORDER|CANCEL_ORDER):([a-f0-9-]{36})$/i);
    if (decisionMatch) {
      const p = fetch(`${SUPABASE_URL}/functions/v1/notify-customer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          order_id: decisionMatch[2],
          event: "order_confirm_tap",
          action: decisionMatch[1].toUpperCase() === "CANCEL_ORDER" ? "cancel" : "confirm",
          from
        })
      }).catch((err)=>console.error("notify-customer (order_confirm_tap) failed:", err));
      globalThis.EdgeRuntime?.waitUntil?.(p);
    } else if (text && text.length <= 30 && !/^(APPROVE|REJECT)\s/i.test(text)) {
      const p = fetch(`${SUPABASE_URL}/functions/v1/notify-customer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          event: "order_text_reply",
          text,
          from
        })
      }).catch((err)=>console.error("notify-customer (order_text_reply) failed:", err));
      globalThis.EdgeRuntime?.waitUntil?.(p);
    }
    const approveMatch = text.match(/^APPROVE\s+([a-f0-9-]+)/i);
    const rejectMatch = text.match(/^REJECT\s+([a-f0-9-]+)/i);
    if (!approveMatch && !rejectMatch) {
      // Not an admin command -- a real customer message (text, image, button
      // tap, etc). Log it into conversations/messages so it shows up in the
      // dashboard's Conversations tab.
      await logInboundMessage(supabase, change, message).catch((err)=>console.error("logInboundMessage error:", err));
      return new Response("ok", {
        status: 200
      });
    }
    const approvalId = (approveMatch ?? rejectMatch)[1];
    const { data: approval, error } = await supabase.from("pending_approvals").select("*").eq("id", approvalId).maybeSingle();
    if (error || !approval) {
      // Say nothing to unknown senders: this webhook URL is public.
      return new Response("ok", {
        status: 200
      });
    }
    // Only the company's own owner/admin may approve or reject: the sender's WhatsApp number must match
    // an owner/admin profile of the company this approval belongs to. (Anyone can POST to this URL, so the
    // "from" field alone proves nothing; the approval id is also not a secret.)
    const fromDigits = String(from ?? "").replace(/\D/g, "");
    const { data: staff } = await supabase.from("profiles").select("whatsapp_number").eq("company_id", approval.company_id).in("role", [
      "owner",
      "admin"
    ]);
    const senderOk = !!fromDigits && (staff ?? []).some((a)=>{
      const d = String(a.whatsapp_number ?? "").replace(/\D/g, "");
      return !!d && (d === fromDigits || d.startsWith("0") && "234" + d.slice(1) === fromDigits);
    });
    if (!senderOk) {
      console.warn(`handle-whatsapp-reply: ignored approval command from non-admin sender for ${approvalId}`);
      return new Response("ok", {
        status: 200
      });
    }
    if (approval.status !== "pending") {
      await sendWhatsApp(from, `\u26a0\ufe0f Approval ${approvalId} was already ${approval.status}.`);
      return new Response("ok", {
        status: 200
      });
    }
    if (approveMatch) {
      const action = approval.proposed_action;
      if (approval.approval_type === "launch_test" && action?.meta_campaign_id) {
        // ai-auto-launch-tests stores the ad sets' real Meta ids directly in
        // proposed_action.ad_set_ids -- activate those, not a DB lookup by
        // ad_sets.campaign_id (that column holds the Meta campaign id, not a
        // local campaigns.id, so the old join-based lookup here always matched
        // zero rows and left ad sets stuck PAUSED even after "approval").
        await setStatus(action.meta_campaign_id, "ACTIVE");
        const adSetMetaIds = Array.isArray(action.ad_set_ids) ? action.ad_set_ids : [];
        for (const metaAdsetId of adSetMetaIds){
          await setStatus(metaAdsetId, "ACTIVE");
        }
        // campaigns row may not exist yet for a brand-new batch (pull-meta-metrics
        // upserts it on its next hourly sync) -- update is a no-op if so, not an error.
        await supabase.from("campaigns").update({
          status: "active",
          launched_at: new Date().toISOString()
        }).eq("meta_campaign_id", action.meta_campaign_id);
        if (adSetMetaIds.length) {
          await supabase.from("ad_sets").update({
            status: "active"
          }).in("meta_adset_id", adSetMetaIds);
        }
        await supabase.from("creative_assets").update({
          test_status: "testing",
          tested_at: new Date().toISOString()
        }).eq("id", approval.creative_asset_id);
      }
      if (approval.approval_type === "scale_winner" && action?.meta_adset_id) {
        await setStatus(action.meta_adset_id, "ACTIVE");
      }
      if (approval.approval_type === "pause_ad" || approval.approval_type === "kill_ad") {
        if (action?.meta_adset_id) await setStatus(action.meta_adset_id, "PAUSED");
      }
      await supabase.from("pending_approvals").update({
        status: "approved",
        responded_at: new Date().toISOString()
      }).eq("id", approvalId);
      await sendWhatsApp(from, `\u2705 Approved and launched: ${approval.reason ?? approvalId}`);
    }
    if (rejectMatch) {
      const action = approval.proposed_action;
      if (approval.approval_type === "launch_test" && action?.meta_campaign_id) {
        await setStatus(action.meta_campaign_id, "DELETED");
        await supabase.from("creative_assets").update({
          test_status: "untested"
        }).eq("id", approval.creative_asset_id);
      }
      await supabase.from("pending_approvals").update({
        status: "rejected",
        responded_at: new Date().toISOString()
      }).eq("id", approvalId);
      await sendWhatsApp(from, `\u274c Rejected: ${approval.reason ?? approvalId}`);
    }
    return new Response("ok", {
      status: 200
    });
  } catch (err) {
    console.error("handle-whatsapp-reply error:", err);
    return new Response("ok", {
      status: 200
    }); // always 200 so Meta doesn't retry-storm
  }
});
