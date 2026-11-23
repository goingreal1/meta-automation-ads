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
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const b = await req.json().catch(() => ({}));
    const u = await caller(req);
    if (!u) return json({ error: "Not signed in" }, 401);
    const action = String(b.action ?? "");

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
      const meta_name = `rv_${u.id.replace(/-/g, "").slice(0, 8)}_${slug(title)}_${Math.random().toString(36).slice(2, 6)}`;
      const comp: Record<string, unknown> = { type: "BODY", text };
      if (hasVar) comp.example = { body_text: [["Amaka"]] };
      const r = await fetch(`${GRAPH}/${num.waba_id}/message_templates`, { method: "POST", headers: { Authorization: `Bearer ${num.access_token || FALLBACK_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: meta_name, language: "en", category: category.toUpperCase(), components: [comp] }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) return json({ error: String(j?.error?.error_user_msg || j?.error?.message || "Meta did not accept the template.").slice(0, 300) }, 502);
      const { data: row } = await db.from("wa_templates").insert({ company_id: u.company_id, user_id: u.id, title, meta_name, body: String(b.body).trim(), category, status: String(j?.status ?? "PENDING").toLowerCase(), meta_id: j?.id ?? null }).select("id, title, status").single();
      return json({ success: true, template: row });
    }

    if (action === "sync") {
      const num = await ownNumber(u);
      const { data: rows } = await db.from("wa_templates").select("id, meta_name, status").eq("user_id", u.id).neq("status", "approved");
      if (num?.waba_id) for (const t of rows ?? []) {
        try {
          const r = await fetch(`${GRAPH}/${num.waba_id}/message_templates?name=${encodeURIComponent(t.meta_name)}&fields=status,rejected_reason,id`, { headers: { Authorization: `Bearer ${num.access_token || FALLBACK_TOKEN}` } });
          const j = await r.json(); const m = j?.data?.[0];
          if (m?.status) await db.from("wa_templates").update({ status: String(m.status).toLowerCase(), reject_reason: m.rejected_reason && m.rejected_reason !== "NONE" ? String(m.rejected_reason) : null, meta_id: m.id ?? null, updated_at: new Date().toISOString() }).eq("id", t.id);
        } catch (_) { /* leave it pending; the next sync tries again */ }
      }
      const { data } = await db.from("wa_templates").select("id, title, body, category, status, reject_reason, created_at").eq("user_id", u.id).order("created_at", { ascending: false });
      return json({ success: true, templates: data ?? [] });
    }

    if (action === "send") {
      const { data: t } = await db.from("wa_templates").select("id, meta_name, body, status, language").eq("id", String(b.template_id ?? "")).eq("user_id", u.id).maybeSingle();
      if (!t) return json({ error: "Template not found." }, 404);
      if (t.status !== "approved") return json({ error: "Meta has not approved this template yet." }, 400);
      const { data: conv } = await db.from("conversations").select("id, phone, company_id, media_buyer_id, whatsapp_name, buyer_whatsapp_numbers(phone_number_id, access_token)").eq("id", String(b.conversation_id ?? "")).maybeSingle();
      if (!conv || conv.company_id !== u.company_id || (u.role === "buyer" && conv.media_buyer_id !== u.buyer)) return json({ error: "Conversation not found." }, 404);
      const nr = conv.buyer_whatsapp_numbers as { phone_number_id?: string; access_token?: string } | null;
      if (!nr?.phone_number_id) return json({ error: "No WhatsApp number is connected for this chat." }, 400);
      const first = String(b.first_name ?? conv.whatsapp_name ?? "").trim().split(/\s+/)[0] || "there";
      const hasVar = /\{first_name\}/i.test(t.body);
      const r = await fetch(`${GRAPH}/${nr.phone_number_id}/messages`, { method: "POST", headers: { Authorization: `Bearer ${nr.access_token || FALLBACK_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: conv.phone, type: "template", template: { name: t.meta_name, language: { code: t.language || "en" }, components: hasVar ? [{ type: "body", parameters: [{ type: "text", text: first }] }] : [] } }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: String(j?.error?.error_user_msg || j?.error?.message || "WhatsApp send failed.").slice(0, 300) }, 502);
      await db.from("messages").insert({ conversation_id: conv.id, direction: "outbound", message_type: "agent_text", content: t.body.replace(/\{first_name\}/gi, first), wa_message_id: j?.messages?.[0]?.id ?? null, status: "sent", company_id: conv.company_id });
      await db.from("conversations").update({ last_message_at: new Date().toISOString(), human_handling: true }).eq("id", conv.id);
      return json({ success: true });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) { return json({ error: String((e as Error).message ?? e).slice(0, 300) }, 500); }
});
