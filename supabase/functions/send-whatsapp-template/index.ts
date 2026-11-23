import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// WhatsApp-approved templates, private to the person who made them.
//  create: submit a template to Meta for approval (name is prefixed with the owner's id so numbers that share one Meta business account never clash)
//  sync:   refresh the status (pending / approved / rejected) of the caller's templates
//  send:   send an approved template into a chat (the only way to write to a customer after 24 hours of silence, or first)
// Meta charges per template message; Meta approval takes minutes to hours.
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const GRAPH = "https://graph.facebook.com/v21.0";
const FALLBACK_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });
async function caller(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  if (!data?.user) return null;
  const { data: p } = await db.from("profiles").select("company_id, role, media_buyer_id").eq("id", data.user.id).maybeSingle();
  if (!p?.company_id || !["owner", "admin", "buyer"].includes(String(p.role))) return null;
  return { id: data.user.id, company_id: p.company_id as string, role: String(p.role), buyer: (p.media_buyer_id ?? null) as string | null };
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "reply";
async function ownNumber(u: { company_id: string; role: string; buyer: string | null }) {
  let q = db.from("buyer_whatsapp_numbers").select("id, waba_id, phone_number_id, access_token").eq("company_id", u.company_id).eq("status", "active").order("created_at", { ascending: true }).limit(1);
  if (u.role === "buyer") q = q.eq("media_buyer_id", u.buyer);
  return (await q.maybeSingle()).data;
}
type Tpl = { id: string; company_id: string; user_id: string; title: string; meta_name: string; body: string; status: string; language?: string; number_id?: string | null; waba_id?: string | null; resend_conversation_id?: string | null; resend_status?: string | null };
const notify = (t: Tpl, kind: string, title: string, body: string, severity: string, conv?: string | null) =>
  db.rpc("rv_notify", { p_company: t.company_id, p_category: "messages", p_kind: kind, p_title: title, p_body: body, p_url: conv ? `/dashboard_new.html?open=conv:${conv}` : null, p_severity: severity, p_data: { template_id: t.id }, p_dedupe: `tpl:${t.id}:${kind}`, p_buyer: null, p_user: t.user_id, p_push: true }).then(() => null, () => null);
// Send an approved template into one chat with that chat's own WhatsApp number. Used by "send" and by the automatic re-send after Meta approves.
async function sendTemplateTo(t: Tpl, convId: string, firstOverride?: string) {
  const { data: conv } = await db.from("conversations").select("id, phone, company_id, whatsapp_name, buyer_whatsapp_numbers(phone_number_id, access_token)").eq("id", convId).maybeSingle();
  if (!conv || conv.company_id !== t.company_id) return { ok: false, error: "Conversation not found." };
  const nr = conv.buyer_whatsapp_numbers as { phone_number_id?: string; access_token?: string } | null;
  if (!nr?.phone_number_id) return { ok: false, error: "No WhatsApp number is connected for this chat." };
  const first = String(firstOverride ?? conv.whatsapp_name ?? "").trim().split(/\s+/)[0] || "there";
  const hasVar = /\{first_name\}/i.test(t.body);
  const r = await fetch(`${GRAPH}/${nr.phone_number_id}/messages`, { method: "POST", headers: { Authorization: `Bearer ${nr.access_token || FALLBACK_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: conv.phone, type: "template", template: { name: t.meta_name, language: { code: t.language || "en" }, components: hasVar ? [{ type: "body", parameters: [{ type: "text", text: first }] }] : [] } }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: String(j?.error?.error_user_msg || j?.error?.message || "WhatsApp send failed.").slice(0, 300) };
  await db.from("messages").insert({ conversation_id: conv.id, direction: "outbound", message_type: "agent_text", content: t.body.replace(/\{first_name\}/gi, first), wa_message_id: j?.messages?.[0]?.id ?? null, status: "sent", company_id: conv.company_id });
  await db.from("conversations").update({ last_message_at: new Date().toISOString(), human_handling: true }).eq("id", conv.id);
  return { ok: true, name: conv.whatsapp_name as string | null };
}
// Ask Meta where one template stands. When it changes: update the row, tell the person, and (if they asked for it) send it to the waiting chat.
async function refreshTemplate(t: Tpl) {
  let waba = t.waba_id ?? "", token = FALLBACK_TOKEN;
  if (t.number_id) { const { data: n } = await db.from("buyer_whatsapp_numbers").select("waba_id, access_token").eq("id", t.number_id).maybeSingle(); waba = n?.waba_id ?? waba; token = n?.access_token || token; }
  if (!waba) return t.status;
  let m: { status?: string; rejected_reason?: string; id?: string } | undefined;
  try {
    const r = await fetch(`${GRAPH}/${waba}/message_templates?name=${encodeURIComponent(t.meta_name)}&fields=status,rejected_reason,id`, { headers: { Authorization: `Bearer ${token}` } });
    m = (await r.json())?.data?.[0];
  } catch (_) { return t.status; }
  const st = m?.status ? String(m.status).toLowerCase() : "";
  if (!st || st === t.status) return t.status;
  const reason = m?.rejected_reason && m.rejected_reason !== "NONE" ? String(m.rejected_reason) : null;
  await db.from("wa_templates").update({ status: st, reject_reason: reason, meta_id: m?.id ?? null, updated_at: new Date().toISOString() }).eq("id", t.id);
  const conv = t.resend_conversation_id ?? null;
  if (st === "approved") {
    if (conv && t.resend_status === "waiting") {
      const r = await sendTemplateTo(t, conv);
      await db.from("wa_templates").update({ resend_status: r.ok ? "sent" : "failed" }).eq("id", t.id);
      await notify(t, "template_sent", r.ok ? `Sent to ${r.name || "your customer"}` : "Approved, but it could not be sent", r.ok ? `Meta approved “${t.title}” and it has been sent to ${r.name || "the customer"}.` : `Meta approved “${t.title}”, but sending failed: ${r.error}`, r.ok ? "success" : "warn", conv);
    } else await notify(t, "template_approved", `Template approved: ${t.title}`, "Meta approved it. You can send it from any chat now.", "success", null);
  } else if (st === "rejected" || st === "disabled" || st === "paused") {
    if (conv && t.resend_status === "waiting") await db.from("wa_templates").update({ resend_status: "failed" }).eq("id", t.id);
    await notify(t, "template_rejected", `Meta did not approve: ${t.title}`, reason ? `Reason: ${reason}. Edit the message and try again.` : "Edit the message and try again.", "warn", conv);
  }
  return st;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b.action ?? "");
    if (action === "poll") {
      const sec = (await db.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle()).data?.value ?? "";
      if (!sec || req.headers.get("x-cron-secret") !== sec) return json({ error: "Not allowed" }, 403);
      const { data: rows } = await db.from("wa_templates").select("*").eq("status", "pending").limit(100);
      let changed = 0;
      for (const t of rows ?? []) { if ((await refreshTemplate(t as Tpl)) !== "pending") changed++; }
      return json({ ok: true, checked: (rows ?? []).length, changed });
    }
    const u = await caller(req);
    if (!u) return json({ error: "Not signed in" }, 401);

    if (action === "create") {
      const title = String(b.title ?? "").trim().slice(0, 60);
      let text = String(b.body ?? "").trim();
      const category = b.category === "marketing" ? "marketing" : "utility";
      if (!title || !text) return json({ error: "Add a name and a message." }, 400);
      const hasVar = /\{first_name\}/i.test(text);
      text = text.replace(/\{first_name\}/gi, "{{1}}");
      if (/\{\{\s*[02-9]|\{[a-z_]+\}/i.test(text.replace(/\{\{1\}\}/g, ""))) return json({ error: "Only {first_name} can be used as a blank." }, 400);
      if (text.length > 1024) return json({ error: "A template can be at most 1024 characters." }, 400);
      if (hasVar && (/^\{\{1\}\}/.test(text) || /\{\{1\}\}[\s.!?]*$/.test(text))) return json({ error: "Put some words before and after {first_name}. Meta does not allow a template to start or end with it." }, 400);
      const num = await ownNumber(u);
      if (!num?.waba_id) return json({ error: "Connect a WhatsApp number first (Settings, WhatsApp numbers)." }, 400);
      let resendConv: string | null = null;
      if (b.resend_conversation_id) {
        const { data: rc } = await db.from("conversations").select("id, company_id, media_buyer_id").eq("id", String(b.resend_conversation_id)).maybeSingle();
        if (!rc || rc.company_id !== u.company_id || (u.role === "buyer" && rc.media_buyer_id !== u.buyer)) return json({ error: "Conversation not found." }, 404);
        resendConv = rc.id;
      }
      const meta_name = `rv_${u.id.replace(/-/g, "").slice(0, 8)}_${slug(title)}_${Math.random().toString(36).slice(2, 6)}`;
      const comp: Record<string, unknown> = { type: "BODY", text };
      if (hasVar) comp.example = { body_text: [["Amaka"]] };
      const r = await fetch(`${GRAPH}/${num.waba_id}/message_templates`, { method: "POST", headers: { Authorization: `Bearer ${num.access_token || FALLBACK_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: meta_name, language: "en", category: category.toUpperCase(), components: [comp] }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) return json({ error: String(j?.error?.error_user_msg || j?.error?.message || "Meta did not accept the template.").slice(0, 300) }, 502);
      const { data: row } = await db.from("wa_templates").insert({ company_id: u.company_id, user_id: u.id, title, meta_name, body: String(b.body).trim(), category, status: String(j?.status ?? "PENDING").toLowerCase(), meta_id: j?.id ?? null, waba_id: num.waba_id, number_id: num.id, resend_conversation_id: resendConv, resend_status: resendConv ? "waiting" : null }).select("id, title, status").single();
      return json({ success: true, template: row });
    }

    if (action === "sync") {
      const { data: rows } = await db.from("wa_templates").select("*").eq("user_id", u.id).eq("status", "pending");
      for (const t of rows ?? []) await refreshTemplate(t as Tpl);
      const { data } = await db.from("wa_templates").select("id, title, body, category, status, reject_reason, created_at, resend_status").eq("user_id", u.id).order("created_at", { ascending: false });
      return json({ success: true, templates: data ?? [] });
    }

    if (action === "send") {
      const { data: t } = await db.from("wa_templates").select("*").eq("id", String(b.template_id ?? "")).eq("user_id", u.id).maybeSingle();
      if (!t) return json({ error: "Template not found." }, 404);
      if (t.status !== "approved") return json({ error: "Meta has not approved this template yet." }, 400);
      const { data: c } = await db.from("conversations").select("id, company_id, media_buyer_id").eq("id", String(b.conversation_id ?? "")).maybeSingle();
      if (!c || c.company_id !== u.company_id || (u.role === "buyer" && c.media_buyer_id !== u.buyer)) return json({ error: "Conversation not found." }, 404);
      const r = await sendTemplateTo(t as Tpl, c.id, b.first_name ? String(b.first_name) : undefined);
      return r.ok ? json({ success: true }) : json({ error: r.error }, 502);
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) { return json({ error: String((e as Error).message ?? e).slice(0, 300) }, 500); }
});
