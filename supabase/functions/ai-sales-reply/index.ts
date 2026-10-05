import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// AI sales agent for WhatsApp. Woken by a database trigger when a customer message lands on a number whose
// agent (ai_sales_agents) is switched on. Replies as a sharp, short-texting salesperson for THAT number's
// business only, then flags hot leads / hands over to the team when needed.
//
// Also serves "test" calls from the Settings screen (no WhatsApp message is sent).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const WHATSAPP_TOKEN_FALLBACK = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_ID_FALLBACK = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";
const MODEL = "gpt-4o"; // the only tier this OpenAI project can use (see ai-chat)
const DEBOUNCE_MS = 8000; // let the customer finish typing before answering
const MAX_AI_MESSAGES_PER_DAY = 40; // per conversation, a runaway-loop safety net
const REPLY_TYPES = ["text", "audio", "image", "button", "interactive", "document", "video"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Agent = {
  mode?: string; business_name?: string | null; agent_name?: string | null; business_type?: string | null; offer?: string | null;
  proof?: string | null; how_to_buy?: string | null; faqs?: string | null; rules?: string | null; opener?: string | null; system_prompt?: string | null;
};
type Turn = { role: "user" | "assistant"; content: string; image?: string };
type Think = { messages: string[]; lead_type: string; stage: string; notify: "none" | "hot_lead" | "needs_human"; reason: string; stop: boolean };

// ── the brain ────────────────────────────────────────────────────────────────

// The persona / sales playbook is NOT in code: it lives in ai_settings ('sales_system_prompt', editable in
// Settings) and can be overridden per number (ai_sales_agents.system_prompt). Only the machine-readable
// output contract below is fixed here, because the code depends on it.
const PROMPT_KEY = "sales_system_prompt";
const FALLBACK_TEMPLATE = "You are {{agent_name}}, the WhatsApp sales assistant for {{business_name}}. Be brief, honest and helpful, sell only what is in the business info, and never invent facts.\n\nBusiness info:\n{{business_info}}\n\nHow to buy:\n{{how_to_buy}}\n\nCustomer: {{customer_name}} ({{chat_source}}). {{conversation_state}}";
const OUTPUT_CONTRACT = `

# Output format (required)
Reply with ONLY a JSON object, keys in this order:
{
 "customer_needs": "what their last message really needs, in a few words (think here)",
 "answer_is_in_business_info": true | false,
 "messages": ["short WhatsApp message 1", "optional message 2", "optional message 3"],
 "lead_type": "prospect" | "seller_pitch" | "spam" | "support" | "other",
 "stage": "new" | "qualifying" | "interested" | "objection" | "ready_to_pay" | "paid" | "lost",
 "notify": "none" | "hot_lead" | "needs_human",
 "reason": "one short line for the team",
 "stop_replying": false
}
Follow the guidance above on when to flag the team. "messages" may be [] only if the customer's message needs no reply at all.`;

async function loadTemplate(admin: any, agent: Agent): Promise<string> {
  if (agent.system_prompt?.trim()) return agent.system_prompt;
  const { data } = await admin.from("ai_settings").select("value").eq("key", PROMPT_KEY).maybeSingle();
  return data?.value?.trim() ? data.value : FALLBACK_TEMPLATE;
}

function renderPrompt(template: string, agent: Agent, ctx: { name: string; source: string; products: string; nowLagos: string; isFirst: boolean }) {
  const none = "(none provided)";
  const v: Record<string, string> = {
    agent_name: agent.agent_name?.trim() || "the team assistant",
    business_name: agent.business_name?.trim() || "this business",
    business_type: agent.business_type?.trim() || "business",
    business_info: agent.offer?.trim() || none,
    proof: agent.proof?.trim() || none,
    how_to_buy: agent.how_to_buy?.trim() || none,
    faqs: agent.faqs?.trim() || none,
    owner_rules: agent.rules?.trim() || none,
    products: ctx.products || none,
    first_reply_example: agent.opener?.trim() || none,
    customer_name: ctx.name || "unknown",
    chat_source: ctx.source,
    time_lagos: ctx.nowLagos,
    conversation_state: ctx.isFirst ? "This is the FIRST reply in this chat." : "The chat is already in progress.",
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in v ? v[k] : m)) + OUTPUT_CONTRACT;
}

async function transcribe(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    const form = new FormData();
    form.append("file", new File([blob], "voice.ogg", { type: blob.type || "audio/ogg" }));
    form.append("model", "whisper-1");
    const t = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: form });
    const d = await t.json();
    return t.ok && d?.text ? String(d.text).trim() : null;
  } catch (e) {
    console.error("transcribe failed:", e);
    return null;
  }
}

async function think(template: string, agent: Agent, turns: Turn[], ctx: { name: string; source: string; products: string; isFirst: boolean }): Promise<Think> {
  const nowLagos = new Date(Date.now() + 3600_000).toISOString().replace("T", " ").slice(0, 16) + " (WAT)";
  const messages: any[] = [{ role: "system", content: renderPrompt(template, agent, { ...ctx, nowLagos }) }];
  for (const t of turns) {
    if (t.image && t.role === "user") {
      messages.push({ role: "user", content: [{ type: "text", text: t.content || "(customer sent this image)" }, { type: "image_url", image_url: { url: t.image } }] });
    } else messages.push({ role: t.role, content: t.content });
  }
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.6, max_tokens: 500, response_format: { type: "json_object" } }),
  });
  const out = await r.json();
  if (!r.ok) throw new Error(out?.error?.message || "AI request failed");
  let p: any = {};
  try { p = JSON.parse(out?.choices?.[0]?.message?.content ?? "{}"); } catch { /* fall through with empty */ }
  const msgs = (Array.isArray(p.messages) ? p.messages : []).map((m: any) => String(m ?? "").trim()).filter(Boolean).slice(0, 3).map((m: string) => m.slice(0, 600));
  const notify = p.notify === "hot_lead" || p.notify === "needs_human" ? p.notify : "none";
  return {
    messages: msgs,
    lead_type: String(p.lead_type ?? "other"),
    stage: String(p.stage ?? "qualifying"),
    // the model admitted it lacks a fact -> a person must follow up, whatever else it said
    notify: p.answer_is_in_business_info === false && notify === "none" ? "needs_human" : notify,
    reason: String(p.reason ?? "").slice(0, 200),
    stop: p.stop_replying === true,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

const nairaProducts = (rows: any[]) => rows.map((p) => `- ${p.product_name}${p.default_order_value_naira ? ` — ₦${Number(p.default_order_value_naira).toLocaleString("en-NG")}` : ""}${p.description ? `: ${String(p.description).slice(0, 200)}` : ""}${p.benefits ? ` Benefits: ${String(p.benefits).slice(0, 200)}` : ""}`).join("\n");

async function authorize(admin: any, req: Request): Promise<"cron" | "user" | null> {
  const secret = req.headers.get("x-cron-secret");
  if (secret) {
    const { data } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
    if (data?.value && secret === data.value) return "cron";
  }
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (token) {
    const { data } = await admin.auth.getUser(token);
    if (data?.user?.id) return "user";
  }
  return null;
}

async function pushStaff(conv: any, title: string, body: string) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/handle-whatsapp-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
      body: JSON.stringify({
        audience: { company_id: conv.company_id, roles: ["owner", "admin", "customer_care"], media_buyer_id: conv.media_buyer_id ?? null },
        category: "messages",
        notification: { title, body, url: `/dashboard_new.html?open=conv:${conv.id}`, tag: `ai-${conv.id}` },
      }),
    });
  } catch (e) { console.error("push failed:", e); }
}

// ── a real inbound message ───────────────────────────────────────────────────

async function handleInbound(admin: any, messageId: string) {
  const { data: msg } = await admin.from("messages").select("id, conversation_id, direction, message_type, content").eq("id", messageId).maybeSingle();
  if (!msg || msg.direction !== "inbound") return { skipped: "not an inbound message" };
  if (!REPLY_TYPES.includes(msg.message_type)) return { skipped: "message type needs no reply" };

  const loadConv = () => admin.from("conversations")
    .select("id, phone, company_id, human_handling, whatsapp_name, source, ad_id, data, buyer_whatsapp_number_id, media_buyer_id")
    .eq("id", msg.conversation_id).maybeSingle();
  let { data: conv } = await loadConv();
  if (!conv?.buyer_whatsapp_number_id) return { skipped: "no WhatsApp number on this chat" };

  const { data: agent } = await admin.from("ai_sales_agents").select("*").eq("buyer_whatsapp_number_id", conv.buyer_whatsapp_number_id).maybeSingle();
  if (!agent || agent.mode === "off") return { skipped: "AI agent is off for this number" };
  if (conv.human_handling) return { skipped: "a human is handling this chat" };
  if (conv.data?.ai?.stopped) return { skipped: "AI stopped for this chat" };

  await sleep(DEBOUNCE_MS);

  // Only the newest message answers; older ones (customer typing several) bow out.
  const { data: last } = await admin.from("messages").select("id").eq("conversation_id", conv.id).order("created_at", { ascending: false }).limit(1);
  if (last?.[0]?.id !== msg.id) return { skipped: "a newer message will be answered instead" };
  ({ data: conv } = await loadConv());
  if (!conv || conv.human_handling) return { skipped: "a human took over" };

  const { count: outboundCount } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id).eq("direction", "outbound");
  if (agent.mode === "first" && (outboundCount ?? 0) > 0) return { skipped: "first-reply-only mode and a reply was already sent" };
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  const { count: aiToday } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id).eq("direction", "outbound").eq("metadata->>ai", "true").gte("created_at", dayAgo);
  if ((aiToday ?? 0) >= MAX_AI_MESSAGES_PER_DAY) return { skipped: "daily AI message cap reached for this chat" };

  const { data: number } = await admin.from("buyer_whatsapp_numbers").select("phone_number_id, access_token, display_phone_number").eq("id", conv.buyer_whatsapp_number_id).maybeSingle();
  const phoneId = number?.phone_number_id || WHATSAPP_PHONE_ID_FALLBACK;
  const token = number?.access_token || WHATSAPP_TOKEN_FALLBACK;
  if (!phoneId || !token) return { skipped: "no WhatsApp credentials for this number" };

  // history (oldest first)
  const { data: rows } = await admin.from("messages").select("id, direction, message_type, content, metadata, created_at").eq("conversation_id", conv.id).order("created_at", { ascending: false }).limit(40);
  const hist = (rows ?? []).reverse();
  const turns: Turn[] = [];
  const push = (role: Turn["role"], content: string, image?: string) => {
    const prev = turns[turns.length - 1];
    if (prev && prev.role === role && !image && !prev.image) prev.content += "\n" + content;
    else turns.push({ role, content, image });
  };
  let audioBudget = 3;
  let lastImageIdx = -1;
  hist.forEach((m: any, i: number) => { if (m.direction === "inbound" && m.message_type === "image" && m.metadata?.url) lastImageIdx = i; });
  for (let i = hist.length - 1; i >= 0; i--) {
    // newest first so the transcription budget goes to the most recent voice notes
    const m = hist[i];
    if (m.direction === "inbound" && m.message_type === "audio" && !m.content) {
      let t = m.metadata?.transcript as string | undefined;
      if (!t && m.metadata?.url && audioBudget-- > 0) {
        t = (await transcribe(m.metadata.url)) ?? undefined;
        if (t) await admin.from("messages").update({ metadata: { ...(m.metadata ?? {}), transcript: t } }).eq("id", m.id);
      }
      m.content = t ? `[voice note] ${t}` : "[voice note — could not be transcribed]";
    }
  }
  hist.forEach((m: any, i: number) => {
    if (m.direction === "inbound") {
      const label = m.message_type === "image" ? "[photo]" : m.message_type === "video" ? "[video]" : m.message_type === "document" ? "[document]" : "";
      const text = [label, m.content].filter(Boolean).join(" ").trim();
      if (!text) return;
      if (i === lastImageIdx) push("user", text, m.metadata.url);
      else push("user", text);
    } else {
      const text = (m.content || "").trim();
      if (!text || ["template", "flow", "url_button"].includes(m.message_type)) { if (m.message_type === "template" || m.message_type === "flow") push("assistant", `[sent: ${text || m.message_type}]`); return; }
      push("assistant", text);
    }
  });
  if (!turns.length || turns[turns.length - 1].role !== "user") return { skipped: "nothing to answer" };

  const isFirst = (outboundCount ?? 0) === 0;

  // products sold on this number (so a food vendor's AI knows its own menu)
  let products = "";
  const tail = String(number?.display_phone_number ?? "").replace(/\D/g, "").slice(-9);
  if (tail) {
    const { data: prods } = await admin.from("products").select("product_name, default_order_value_naira, description, benefits, whatsapp_number").eq("company_id", conv.company_id).eq("is_active", true).limit(30);
    products = nairaProducts((prods ?? []).filter((p: any) => String(p.whatsapp_number ?? "").replace(/\D/g, "").endsWith(tail)));
  }
  const source = conv.ad_id || conv.source === "ad" ? "came from a Facebook/Instagram ad (click-to-WhatsApp)" : "messaged directly (not from an ad)";
  const result: Think = await think(await loadTemplate(admin, agent), agent, turns, { name: conv.whatsapp_name || "", source, products, isFirst });

  // send
  const sentIds: string[] = [];
  for (let i = 0; i < result.messages.length; i++) {
    if (i > 0) await sleep(1200);
    const text = result.messages[i];
    const wa = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: conv.phone, type: "text", text: { body: text } }),
    });
    const d = await wa.json();
    if (!wa.ok) { console.error("WhatsApp send failed:", d); return { error: d?.error?.message || "WhatsApp send failed", sent: sentIds.length }; }
    const waId = d?.messages?.[0]?.id ?? null;
    sentIds.push(waId ?? "sent");
    await admin.from("messages").insert({
      conversation_id: conv.id, direction: "outbound", message_type: "text", content: text,
      wa_message_id: waId, status: "sent", company_id: conv.company_id, metadata: { ai: true, stage: result.stage },
    });
  }

  const aiState = { ...(conv.data?.ai ?? {}), stage: result.stage, lead_type: result.lead_type, last_reply_at: new Date().toISOString(), stopped: result.stop || undefined };
  const upd: any = { last_message_at: new Date().toISOString(), data: { ...(conv.data ?? {}), ai: aiState } };
  if (result.notify === "needs_human") upd.human_handling = true; // AI steps back; the team is pinged
  await admin.from("conversations").update(upd).eq("id", conv.id);

  if (result.notify === "hot_lead") await pushStaff(conv, `🔥 Hot lead: ${conv.whatsapp_name || conv.phone}`, result.reason || "Ready to start — AI sent the next step.");
  if (result.notify === "needs_human") await pushStaff(conv, `🙋 Needs you: ${conv.whatsapp_name || conv.phone}`, result.reason || "The AI handed this chat over.");

  return { ok: true, sent: sentIds.length, stage: result.stage, notify: result.notify, lead_type: result.lead_type };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const who = await authorize(admin, req);
    if (!who) return json({ error: "Unauthorized" }, 401);
    if (!OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY is not set for this project." }, 500);
    const body = await req.json().catch(() => ({}));

    if (body.test) {
      const history: Turn[] = (Array.isArray(body.history) ? body.history : [])
        .filter((h: any) => (h?.role === "user" || h?.role === "assistant") && String(h?.content ?? "").trim())
        .slice(-30).map((h: any) => ({ role: h.role, content: String(h.content).slice(0, 1500) }));
      if (!history.length || history[history.length - 1].role !== "user") return json({ error: "Send a customer message to test." }, 400);
      const agent: Agent = body.agent ?? {};
      const isFirst = !history.some((h) => h.role === "assistant");
      const r = await think(await loadTemplate(admin, agent), agent, history, { name: String(body.contact_name ?? ""), source: "came from a Facebook/Instagram ad (click-to-WhatsApp)", products: "", isFirst });
      return json({ ok: true, ...r });
    }

    if (who !== "cron") return json({ error: "Forbidden" }, 403);
    return json(await handleInbound(admin, String(body.message_id ?? "")));
  } catch (e: any) {
    console.error("ai-sales-reply error:", e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
