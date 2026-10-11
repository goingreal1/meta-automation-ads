import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// In-app support chat between each customer company and the Revora team. Plain database threads: no WhatsApp window, no auto-replies.
//   POST { action: "info" | "threads" | "messages" | "send", company_id?, text? }  (Authorization: user session)
// A customer only ever sees their own company's thread. The Revora team (company in app_secrets 'support_company_id') sees every thread.
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" } });
  try {
    const { data: u } = await db.auth.getUser((req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""));
    if (!u?.user) return json({ error: "Not signed in" }, 401);
    const { data: me } = await db.from("profiles").select("company_id, display_name, role").eq("id", u.user.id).maybeSingle();
    if (!me?.company_id) return json({ error: "No profile found." }, 403);
    const sc = (await db.from("app_secrets").select("value").eq("key", "support_company_id").maybeSingle()).data?.value ?? "";
    const staff = !!sc && me.company_id === sc && ["owner", "admin", "buyer", "customer_care"].includes(me.role);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    // Which company's thread this call is about.
    const target: string = staff && body.company_id ? String(body.company_id) : me.company_id;
    const name = me.display_name ?? u.user.email ?? "";

    if (action === "info") {
      const { data: rows } = staff ? await db.from("support_threads").select("unread_staff") : await db.from("support_threads").select("unread_customer").eq("company_id", me.company_id);
      const unread = (rows ?? []).reduce((n: number, r: any) => n + (staff ? r.unread_staff : r.unread_customer), 0);
      return json({ staff, unread });
    }
    if (action === "threads") {
      if (!staff) return json({ error: "Not allowed." }, 403);
      const { data: threads } = await db.from("support_threads").select("*").order("last_message_at", { ascending: false }).limit(200);
      const ids = (threads ?? []).map((t: any) => t.company_id);
      const { data: cos } = ids.length ? await db.from("companies").select("id, name").in("id", ids) : { data: [] as any[] };
      const nm = new Map((cos ?? []).map((c: any) => [c.id, c.name]));
      return json({ threads: (threads ?? []).map((t: any) => ({ ...t, company_name: nm.get(t.company_id) ?? "Company" })) });
    }
    if (action === "messages") {
      const { data: msgs } = await db.from("support_messages").select("id, sender, sender_name, body, created_at").eq("company_id", target).order("created_at", { ascending: true }).limit(300);
      await db.from("support_threads").update(staff ? { unread_staff: 0 } : { unread_customer: 0 }).eq("company_id", target);
      return json({ messages: msgs ?? [] });
    }
    if (action === "send") {
      const text = String(body.text ?? "").trim().slice(0, 4000);
      if (!text) return json({ error: "Write a message first." }, 400);
      if (staff && target === me.company_id) return json({ error: "Pick a customer." }, 400);
      const sender = staff ? "staff" : "customer";
      const { error } = await db.from("support_messages").insert({ company_id: target, sender, user_id: u.user.id, sender_name: name, body: text });
      if (error) return json({ error: error.message }, 500);
      const { data: th } = await db.from("support_threads").select("unread_staff, unread_customer").eq("company_id", target).maybeSingle();
      const row: any = { company_id: target, last_message_at: new Date().toISOString(), last_text: text.slice(0, 120), unread_staff: th?.unread_staff ?? 0, unread_customer: th?.unread_customer ?? 0 };
      if (sender === "customer") { row.unread_staff += 1; row.customer_name = name; } else row.unread_customer += 1;
      await db.from("support_threads").upsert(row, { onConflict: "company_id" });
      if (sender === "customer" && sc) {
        const { data: team } = await db.from("profiles").select("id").eq("company_id", sc).in("role", ["owner", "admin"]);
        for (const p of team ?? []) await db.from("ai_inbox").insert({ company_id: sc, profile_id: p.id, kind: "info", title: "Support chat", body: `${name}: ${text.slice(0, 200)}`, payload: { support_company_id: target }, dedupe_key: `supchat:${target}:${Math.floor(Date.now() / 600000)}` }).then(() => {}, () => {});
      }
      return json({ ok: true });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
