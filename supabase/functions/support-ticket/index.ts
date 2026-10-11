import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Customer support: customers send a message from Settings -> Help. Stored in support_tickets; the Revora team is alerted in their
// dashboard inbox (the company named in app_secrets 'support_company_id', if set). The direct WhatsApp line comes from app_secrets 'support_whatsapp'.
//   POST { action: "config" | "submit", subject?, message?, page? }  (Authorization: user session)
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
const secret = async (k: string) => (await db.from("app_secrets").select("value").eq("key", k).maybeSingle()).data?.value ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" } });
  try {
    const { data: u } = await db.auth.getUser((req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""));
    if (!u?.user) return json({ error: "Not signed in" }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.action === "config") return json({ whatsapp: String(await secret("support_whatsapp")).replace(/\D/g, "") || null });
    if (body.action !== "submit") return json({ error: "Unknown action" }, 400);
    const message = String(body.message ?? "").trim().slice(0, 4000);
    if (message.length < 5) return json({ error: "Tell us a little more about the problem." }, 400);
    const { data: me } = await db.from("profiles").select("company_id, display_name, whatsapp_number").eq("id", u.user.id).maybeSingle();
    if (!me?.company_id) return json({ error: "No profile found." }, 403);
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await db.from("support_tickets").select("id", { count: "exact", head: true }).eq("user_id", u.user.id).gte("created_at", since);
    if ((count ?? 0) >= 5) return json({ error: "You've sent several messages already. We'll reply soon." }, 429);
    const subject = String(body.subject ?? "").trim().slice(0, 120) || null;
    const { data: t, error } = await db.from("support_tickets").insert({ company_id: me.company_id, user_id: u.user.id, name: me.display_name ?? u.user.email, subject, message, page: String(body.page ?? "").slice(0, 80) || null }).select("id").single();
    if (error) return json({ error: error.message }, 500);
    const sc = await secret("support_company_id");
    if (sc) {
      const { data: staff } = await db.from("profiles").select("id").eq("company_id", sc).in("role", ["owner", "admin"]);
      for (const s of staff ?? []) await db.from("ai_inbox").insert({ company_id: sc, profile_id: s.id, kind: "info", title: `Support: ${subject ?? "new message"}`, body: `${me.display_name ?? u.user.email}: ${message.slice(0, 300)}`, payload: { ticket_id: t.id }, dedupe_key: `support:${t.id}` }).then(() => {}, () => {});
    }
    // Also drop it into the Revora team's Chats tab, so it is answered where the team already works.
    if (sc) {
      try {
        const { data: num } = await db.from("buyer_whatsapp_numbers").select("id, media_buyer_id").eq("company_id", sc).eq("status", "active").order("created_at", { ascending: true }).limit(1).maybeSingle();
        if (num) {
          const phone = String(me.whatsapp_number ?? "").replace(/\D/g, "") || `support-${u.user.id.slice(0, 8)}`;
          const nowIso = new Date().toISOString();
          let { data: conv } = await db.from("conversations").select("id, unread_count").eq("phone", phone).eq("buyer_whatsapp_number_id", num.id).order("started_at", { ascending: false }).limit(1).maybeSingle();
          if (!conv) {
            const ins = await db.from("conversations").insert({ phone, current_state: "NEW", source: "support", started_at: nowIso, last_message_at: nowIso, whatsapp_name: `${me.display_name ?? u.user.email} (support)`, unread_count: 0, company_id: sc, buyer_whatsapp_number_id: num.id, media_buyer_id: num.media_buyer_id, human_handling: true }).select("id, unread_count").single();
            conv = ins.data;
          }
          if (conv) {
            await db.from("messages").insert({ conversation_id: conv.id, company_id: sc, direction: "inbound", message_type: "text", content: `${subject ? subject + "\n" : ""}${message}`, status: "received", metadata: { support_ticket_id: t.id } });
            await db.from("conversations").update({ last_message_at: nowIso, unread_count: (conv.unread_count ?? 0) + 1 }).eq("id", conv.id);
          }
        }
      } catch (_) { /* the ticket is saved either way */ }
    }
    return json({ ok: true, id: t.id });
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
