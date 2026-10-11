import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// An owner/admin removes someone from the company (a media buyer who stopped working here, a rider, a care agent).
//   POST { user_id } -> { ok, ... } | { error }
// What happens: they are signed out everywhere, lose access to the company's data, their connected AI apps are disconnected,
// auto-approve is switched off, and any funding request still waiting from them is declined. Their history (orders, ROAS, receipts)
// stays with the company. A removed person can be invited again later.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = token ? await admin.auth.getUser(token) : { data: null as any };
  if (!u?.user) return json({ error: "Not signed in." }, 401);
  const { data: me } = await admin.from("profiles").select("id, role, company_id").eq("id", u.user.id).maybeSingle();
  if (!me?.company_id || (me.role !== "owner" && me.role !== "admin")) return json({ error: "Only an owner or admin can remove people." }, 403);
  const uid = String(b?.user_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(uid)) return json({ error: "Pick a person." }, 400);
  if (uid === me.id) return json({ error: "You cannot remove yourself." }, 400);
  const { data: t } = await admin.from("profiles").select("id, role, company_id, media_buyer_id, display_name").eq("id", uid).eq("company_id", me.company_id).maybeSingle();
  if (!t) return json({ error: "That person is not in your company." }, 404);
  if (t.role === "owner") return json({ error: "The owner cannot be removed." }, 403);
  if (t.role === "admin" && me.role !== "owner") return json({ error: "Only the owner can remove an admin." }, 403);

  const now = new Date().toISOString();
  let declined = 0;
  if (t.media_buyer_id) {
    await admin.from("media_buyers").update({ active: false, auto_send_enabled: false }).eq("id", t.media_buyer_id).eq("company_id", me.company_id);
    const { data: d } = await admin.from("fund_requests").update({ status: "declined", decided_at: now, decided_by: me.id, transfer_error: "The buyer was removed from the company" }).eq("media_buyer_id", t.media_buyer_id).eq("company_id", me.company_id).eq("status", "pending").select("id");
    declined = d?.length ?? 0;
  }
  // Connected AI apps (ChatGPT / Claude) first, then every login session, then detach the profile from the company.
  const { data: apps } = await admin.rpc("ai_apps_list", { p_user: uid });
  for (const a of (apps as any[]) ?? []) await admin.rpc("ai_app_remove", { p_user: uid, p_name: a.app_name });
  await admin.rpc("revoke_user_sessions", { p_user: uid });
  const { error } = await admin.from("profiles").update({ company_id: null, media_buyer_id: null, delivery_agent_id: null }).eq("id", uid).eq("company_id", me.company_id);
  if (error) return json({ error: "Could not remove them: " + error.message }, 500);
  return json({ ok: true, name: t.display_name, role: t.role, pending_requests_declined: declined });
});
