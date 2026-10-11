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
    const { data: me } = await db.from("profiles").select("company_id, display_name").eq("id", u.user.id).maybeSingle();
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
    return json({ ok: true, id: t.id });
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
