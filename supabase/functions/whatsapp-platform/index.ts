import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// WhatsApp numbers hosted on Revora's own WhatsApp Business Account, so customers never need their own Facebook login.
//   POST { action: "status" | "add" | "resend" | "verify" | "request_number" | "remove", media_buyer_id, access_token, ... }
// Numbers land in buyer_whatsapp_numbers, so the existing webhook routes their messages (by phone_number_id) to the Chats tab.
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const GRAPH = "https://graph.facebook.com/v21.0";
const APP_ID = Deno.env.get("META_APP_ID") ?? "";
const APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") || Deno.env.get("BEOLIV_WHATSAPP_ACCESS_TOKEN") || "";
let waba = Deno.env.get("REVORA_WABA_ID") ?? "";
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

async function graph(path: string, method: "GET" | "POST" = "GET", body?: Record<string, string>) {
  if (method === "GET") { const r = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${TOKEN}`); return { ok: r.ok, data: await r.json().catch(() => ({})) }; }
  const r = await fetch(`${GRAPH}/${path}`, { method, body: new URLSearchParams({ ...(body ?? {}), access_token: TOKEN }) });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}
const errOf = (d: any, fb: string) => d?.error?.error_user_msg || d?.error?.message || fb;
async function getWaba() {
  if (waba) return waba;
  if (!TOKEN || !APP_ID || !APP_SECRET) return "";
  try {
    const r = await fetch(`${GRAPH}/debug_token?` + new URLSearchParams({ input_token: TOKEN, access_token: `${APP_ID}|${APP_SECRET}` }));
    const j = await r.json();
    const g = (j?.data?.granular_scopes ?? []).find((x: any) => x.scope === "whatsapp_business_management");
    waba = String(g?.target_ids?.[0] ?? "");
  } catch (_) { /* unavailable */ }
  return waba;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
  try {
    const body = await req.json().catch(() => ({}));
    const { action, media_buyer_id: buyerId, access_token: session } = body;
    if (!action || !buyerId || !session) return json({ error: "action, media_buyer_id and access_token are required" }, 400);
    const { data: u } = await db.auth.getUser(session);
    if (!u?.user) return json({ error: "Your session has expired -- refresh and try again." }, 401);
    const { data: profile } = await db.from("profiles").select("role, company_id, media_buyer_id").eq("id", u.user.id).maybeSingle();
    if (!profile) return json({ error: "No profile found for this login." }, 403);
    const isAdmin = profile.role === "owner" || profile.role === "admin";
    if (!isAdmin && profile.media_buyer_id !== buyerId) return json({ error: "You can only manage your own WhatsApp numbers." }, 403);
    const { data: buyer } = await db.from("media_buyers").select("id, company_id").eq("id", buyerId).maybeSingle();
    if (!buyer || buyer.company_id !== profile.company_id) return json({ error: "Unknown media buyer." }, 404);

    if (action === "request_number") {
      const note = String(body.note ?? "").slice(0, 500);
      const { error } = await db.from("whatsapp_number_requests").insert({ company_id: buyer.company_id, media_buyer_id: buyerId, requested_by: u.user.id, note });
      if (error) return json({ error: error.message }, 500);
      const { data: admins } = await db.from("profiles").select("id").eq("company_id", buyer.company_id).in("role", ["owner", "admin"]);
      for (const a of admins ?? []) await db.from("ai_inbox").insert({ company_id: buyer.company_id, profile_id: a.id, kind: "info", title: "A WhatsApp number was requested", body: note || "A team member asked for a Revora WhatsApp number.", payload: {} }).then(() => {}, () => {});
      return json({ requested: true });
    }
    if (action === "remove") {
      const { error } = await db.from("buyer_whatsapp_numbers").update({ status: "disconnected" }).eq("id", String(body.id ?? "")).eq("media_buyer_id", buyerId);
      return error ? json({ error: error.message }, 500) : json({ removed: true });
    }

    const w = await getWaba();
    if (action === "status") return json({ available: !!(TOKEN && w) });
    if (!TOKEN || !w) return json({ error: "Revora WhatsApp numbers aren't switched on yet." }, 400);

    if (action === "add") {
      const cc = String(body.cc ?? "").replace(/\D/g, ""), pn = String(body.phone_number ?? "").replace(/\D/g, "").replace(/^0+/, "");
      const name = String(body.verified_name ?? "").trim().slice(0, 60);
      if (!cc || !pn || !name) return json({ error: "Country code, number and business name are required." }, 400);
      const r = await graph(`${w}/phone_numbers`, "POST", { cc, phone_number: pn, verified_name: name });
      if (!r.ok) return json({ error: errOf(r.data, "Could not add that number.") }, 400);
      const rc = await graph(`${r.data.id}/request_code`, "POST", { code_method: body.code_method === "VOICE" ? "VOICE" : "SMS", language: "en_US" });
      if (!rc.ok) return json({ error: errOf(rc.data, "Added, but the code could not be sent."), phone_number_id: r.data.id }, 400);
      return json({ phone_number_id: r.data.id, sent: true });
    }
    const id = String(body.phone_number_id ?? "");
    if (!/^\d+$/.test(id)) return json({ error: "phone_number_id is required." }, 400);
    if (action === "resend") {
      const rc = await graph(`${id}/request_code`, "POST", { code_method: body.code_method === "VOICE" ? "VOICE" : "SMS", language: "en_US" });
      return rc.ok ? json({ sent: true }) : json({ error: errOf(rc.data, "Could not send a code.") }, 400);
    }
    if (action === "verify") {
      const code = String(body.code ?? "").replace(/\D/g, "");
      if (!code) return json({ error: "Enter the code." }, 400);
      // Only a number that really sits on Revora's account can be claimed.
      const info = await graph(`${id}?fields=display_phone_number,verified_name`);
      if (!info.ok) return json({ error: "That number isn't on the Revora account." }, 400);
      const v = await graph(`${id}/verify_code`, "POST", { code });
      if (!v.ok || v.data?.success !== true) return json({ error: errOf(v.data, "That code didn't verify -- check it and try again.") }, 400);
      const reg = await graph(`${id}/register`, "POST", { messaging_product: "whatsapp", pin: String(100000 + Math.floor(Math.random() * 900000)) });
      if (!reg.ok) console.error("register failed:", JSON.stringify(reg.data));
      await graph(`${w}/subscribed_apps`, "POST");
      const { data: row, error } = await db.from("buyer_whatsapp_numbers").upsert({
        company_id: buyer.company_id, media_buyer_id: buyerId, waba_id: w, phone_number_id: id,
        display_phone_number: info.data?.display_phone_number ?? null, nickname: info.data?.verified_name ?? null,
        access_token: TOKEN, verified_at: new Date().toISOString(), status: "active",
      }, { onConflict: "phone_number_id" }).select("id").single();
      if (error) return json({ error: `Verified, but could not save it: ${error.message}` }, 500);
      return json({ saved: true, id: row.id, number: info.data?.display_phone_number ?? null, registered: reg.ok, note: reg.ok ? null : errOf(reg.data, null as any) });
    }
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
