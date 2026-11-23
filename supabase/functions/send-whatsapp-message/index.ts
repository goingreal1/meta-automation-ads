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
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
// Caller must be a signed-in dashboard user (the public anon key is not enough).
async function callerCompany(req, admin) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return null;
  const { data: p } = await admin.from("profiles").select("company_id").eq("id", data.user.id).maybeSingle();
  return p?.company_id ?? null;
}
// Caller's company, role and media-buyer id (buyers only ever touch their own chats and numbers).
async function callerProfile(req, admin) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return null;
  const { data: p } = await admin.from("profiles").select("company_id, role, media_buyer_id").eq("id", data.user.id).maybeSingle();
  return p ?? null;
}
// "Open the chat for this phone number" (from an order, a lead or a booking): finds the customer's chat, or creates an empty one on the
// caller's own WhatsApp number. Nothing is sent. Also says whether free-form messages can still be sent (customer wrote in the last 24h).
async function startConversation(body, req, supabase) {
  const prof = await callerProfile(req, supabase);
  if (!prof?.company_id || !["owner", "admin", "buyer"].includes(String(prof.role))) return json({ error: "Not signed in" }, 401);
  const digits = String(body?.phone ?? "").replace(/\D/g, "");
  const phone = digits.length === 11 && digits[0] === "0" ? "234" + digits.slice(1) : digits;
  if (phone.length < 8) return json({ error: "That phone number does not look right." }, 400);
  const own = prof.role === "buyer";
  let cq = supabase.from("conversations").select("id").eq("company_id", prof.company_id).eq("phone", phone).neq("current_state", "MERGED").order("last_message_at", { ascending: false }).limit(1);
  if (own) cq = cq.eq("media_buyer_id", prof.media_buyer_id);
  let { data: conv } = await cq.maybeSingle();
  let created = false;
  if (!conv) {
    let nq = supabase.from("buyer_whatsapp_numbers").select("id, media_buyer_id").eq("company_id", prof.company_id).eq("status", "active").order("created_at", { ascending: true }).limit(1);
    if (own) nq = nq.eq("media_buyer_id", prof.media_buyer_id);
    const { data: num } = await nq.maybeSingle();
    if (!num) return json({ error: "Connect a WhatsApp number first (Settings, WhatsApp numbers), then open the chat." }, 400);
    const now = new Date().toISOString();
    const ins = await supabase.from("conversations").insert({ phone, current_state: "NEW", source: "organic", started_at: now, last_message_at: now, whatsapp_name: String(body?.name ?? "").slice(0, 80) || null, unread_count: 0, company_id: prof.company_id, buyer_whatsapp_number_id: num.id, media_buyer_id: num.media_buyer_id }).select("id").single();
    if (ins.error?.code === "23505") {
      const again = await supabase.from("conversations").select("id").eq("company_id", prof.company_id).eq("phone", phone).eq("buyer_whatsapp_number_id", num.id).order("started_at", { ascending: false }).limit(1).maybeSingle();
      conv = again.data;
    } else if (ins.error || !ins.data) return json({ error: "Could not open the chat." }, 500);
    else { conv = ins.data; created = true; }
  }
  const { data: last } = await supabase.from("messages").select("created_at").eq("conversation_id", conv.id).eq("direction", "inbound").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const lastIn = last?.created_at ?? null;
  return json({ success: true, conversation_id: conv.id, created, last_inbound_at: lastIn, window_open: !!lastIn && Date.now() - Date.parse(lastIn) < 24 * 3600 * 1000 });
}
// Read-only diagnostic (platform secret only): which Meta permissions the shared token holds, and whether a Page's Messenger inbox can be read.
async function metaPerms(body, req) {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const sec = (await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle()).data?.value ?? "";
  if (!sec || req.headers.get("x-cron-secret") !== sec) return json({ error: "Not allowed" }, 403);
  const T = Deno.env.get("META_ACCESS_TOKEN") ?? "";
  const g = async (p, t) => (await fetch(`${META_GRAPH_BASE}${p}${p.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(t)}`)).json();
  const out = {};
  const perms = await g("/me/permissions?limit=100", T);
  out.permissions = perms?.data ? perms.data.map((x) => `${x.permission}:${x.status}`) : (perms?.error?.message ?? "unknown");
  const pid = String(body?.page_id ?? "").replace(/\D/g, "");
  if (pid) {
    const pt = (await g(`/${pid}?fields=access_token`, T))?.access_token;
    out.page_token = !!pt;
    if (pt) { const c = await g(`/${pid}/conversations?platform=messenger&limit=1&fields=id`, pt); out.messenger = c?.error ? c.error.message : `readable, ${(c.data ?? []).length} found`; }
  }
  return json({ ok: true, ...out });
}
// Read-only debug (platform secret only): one Graph GET made with a Page's own token, to see exactly what Meta answers. Never writes anything.
async function graphProbe(body, req) {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const sec = (await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle()).data?.value ?? "";
  if (!sec || req.headers.get("x-cron-secret") !== sec) return json({ error: "Not allowed" }, 403);
  const T = Deno.env.get("META_ACCESS_TOKEN") ?? "";
  const path = String(body?.path ?? "");
  if (!/^\/[0-9A-Za-z_\-\/]*(\?[0-9A-Za-z_,{}.=\-&%]*)?$/.test(path)) return json({ error: "Bad path" }, 400);
  const pid = String(body?.page_id ?? "").replace(/\D/g, "");
  let tok = T;
  if (pid) { const pt = (await (await fetch(`${META_GRAPH_BASE}/${pid}?fields=access_token&access_token=${encodeURIComponent(T)}`)).json())?.access_token; if (pt) tok = pt; }
  const r = await fetch(`${META_GRAPH_BASE}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(tok)}`);
  const j = await r.json().catch(() => ({}));
  return json({ ok: true, status: r.status, result: JSON.parse(JSON.stringify(j).split(tok).join("***")) });
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    });
  }
  try {
    const body = await req.json().catch(()=>({}));
    if (body?.action === "graph_probe") return await graphProbe(body, req);
    if (body?.action === "meta_perms") return await metaPerms(body, req);
    if (body?.action === "start") return await startConversation(body, req, createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY));
    const conversationId = body?.conversation_id;
    const text = body?.text?.trim();
    if (!conversationId || !text) {
      return json({
        error: "conversation_id and text are required."
      }, 400);
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const callerCo = await callerCompany(req, supabase);
    if (!callerCo) return json({
      error: "Not signed in"
    }, 401);
    const { data: conv, error: convErr } = await supabase.from("conversations").select("id, phone, company_id, buyer_whatsapp_numbers(phone_number_id, access_token)").eq("id", conversationId).maybeSingle();
    if (convErr || !conv || conv.company_id !== callerCo) {
      return json({
        error: "Conversation not found."
      }, 404);
    }
    const numberRow = conv.buyer_whatsapp_numbers;
    const phoneId = numberRow?.phone_number_id || WHATSAPP_PHONE_ID_FALLBACK;
    const token = numberRow?.access_token || WHATSAPP_TOKEN_FALLBACK;
    if (!phoneId || !token) {
      return json({
        error: "No WhatsApp number is connected for this conversation (Settings -> WhatsApp Numbers)."
      }, 500);
    }
    const waRes = await fetch(`${META_GRAPH_BASE}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: conv.phone,
        type: "text",
        text: {
          body: text
        }
      })
    });
    const waData = await waRes.json();
    if (!waRes.ok) {
      console.error("WhatsApp send failed:", waData);
      return json({
        error: waData?.error?.message || "WhatsApp send failed.",
        to: conv.phone
      }, 502);
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
      company_id: conv.company_id
    });
    await supabase.from("conversations").update({
      last_message_at: new Date().toISOString(),
      human_handling: true
    }).eq("id", conv.id);
    return json({
      success: true,
      to: conv.phone
    });
  } catch (err) {
    console.error("send-whatsapp-message error:", err);
    return json({
      error: err.message
    }, 500);
  }
});
