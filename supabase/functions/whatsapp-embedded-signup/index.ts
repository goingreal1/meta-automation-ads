import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// WhatsApp Embedded Signup: lets a buyer create or connect their own WhatsApp
// Business Account and number from inside the dashboard (Facebook's pop-up),
// with no Business ID typing and no copy-pasting tokens.
//
//   POST { action: "config", access_token }                       -> { app_id, config_id } for FB.init / FB.login
//   POST { action: "complete", access_token, media_buyer_id,
//          code, waba_id, phone_number_id }                       -> exchanges the pop-up's code for the
//        business's own token, registers the number, subscribes our webhook, saves it in buyer_whatsapp_numbers
//
// access_token is always the caller's Supabase session token (proves who is signed in).
// An owner/admin may act for any buyer in their company; a buyer only for themselves.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
// The "Facebook Login for Business" configuration made for Embedded Signup (public, not a secret).
const ES_CONFIG_ID = Deno.env.get("WHATSAPP_ES_CONFIG_ID") ?? "959056356702707";
const GRAPH = "https://graph.facebook.com/v21.0";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

async function graph(path: string, token: string, method: "GET" | "POST" = "GET", body?: Record<string, unknown>) {
  const url = new URL(`${GRAPH}/${path}`);
  if (method === "GET") {
    url.searchParams.set("access_token", token);
    const res = await fetch(url);
    return { ok: res.ok, data: await res.json() };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });
  return { ok: res.ok, data: await res.json() };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info" } });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const { action, access_token: sessionToken } = body;
    if (!sessionToken) return json({ error: "Not signed in." }, 401);
    const { data: userData, error: authErr } = await supabase.auth.getUser(sessionToken);
    if (authErr || !userData?.user) return json({ error: "Your session has expired -- refresh and try again." }, 401);
    const { data: profile } = await supabase.from("profiles").select("role, company_id, media_buyer_id").eq("id", userData.user.id).maybeSingle();
    if (!profile) return json({ error: "No profile found for this login." }, 403);

    if (action === "config") {
      if (!META_APP_ID) return json({ error: "Meta app isn't configured on the server (META_APP_ID missing)." }, 500);
      return json({ app_id: META_APP_ID, config_id: ES_CONFIG_ID });
    }

    if (action === "complete") {
      const { media_buyer_id: mediaBuyerId, code, waba_id: wabaId, phone_number_id: phoneNumberId } = body;
      if (!mediaBuyerId || !code || !wabaId || !phoneNumberId) return json({ error: "media_buyer_id, code, waba_id and phone_number_id are required." }, 400);
      if (!/^\d+$/.test(String(wabaId)) || !/^\d+$/.test(String(phoneNumberId))) return json({ error: "Invalid WhatsApp account details." }, 400);
      const isAdmin = profile.role === "owner" || profile.role === "admin";
      if (!isAdmin && profile.media_buyer_id !== mediaBuyerId) return json({ error: "You can only set up your own WhatsApp number." }, 403);
      const { data: buyer } = await supabase.from("media_buyers").select("id, company_id").eq("id", mediaBuyerId).maybeSingle();
      if (!buyer || buyer.company_id !== profile.company_id) return json({ error: "Unknown media buyer." }, 404);
      if (!META_APP_ID || !META_APP_SECRET) return json({ error: "Meta app isn't configured on the server." }, 500);

      // 1. code -> the business's own token
      const tokRes = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({ client_id: META_APP_ID, client_secret: META_APP_SECRET, code: String(code) }));
      const tok = await tokRes.json();
      if (!tokRes.ok || !tok.access_token) return json({ error: tok?.error?.message || "Meta did not accept the sign-up code. Try again." }, 400);
      const token = tok.access_token as string;

      // 2. make sure this token really owns that WABA / number (never trust ids sent by the browser)
      const num = await graph(`${phoneNumberId}?fields=display_phone_number,verified_name,code_verification_status`, token);
      if (!num.ok) return json({ error: num.data?.error?.message || "Could not read the number you connected." }, 400);

      // 3. subscribe our app to the account's webhooks (incoming messages reach the dashboard)
      const sub = await graph(`${wabaId}/subscribed_apps`, token, "POST");
      if (!sub.ok) console.error("subscribed_apps failed:", JSON.stringify(sub.data));

      // 4. register the number on the Cloud API (needs a 6-digit two-step PIN; we set a random one)
      const pin = String(100000 + Math.floor(Math.random() * 900000));
      const reg = await graph(`${phoneNumberId}/register`, token, "POST", { messaging_product: "whatsapp", pin });
      const regNote = reg.ok ? null : (reg.data?.error?.message || "register failed");
      if (!reg.ok) console.error("register failed:", JSON.stringify(reg.data));

      const { data: row, error } = await supabase.from("buyer_whatsapp_numbers").upsert({
        company_id: buyer.company_id,
        media_buyer_id: mediaBuyerId,
        waba_id: String(wabaId),
        phone_number_id: String(phoneNumberId),
        display_phone_number: num.data?.display_phone_number ?? null,
        nickname: num.data?.verified_name ?? null,
        access_token: token,
        verified_at: new Date().toISOString(),
        status: "active",
      }, { onConflict: "phone_number_id" }).select("id").single();
      if (error) return json({ error: `Could not save it: ${error.message}` }, 500);
      return json({ saved: true, id: row.id, number: num.data?.display_phone_number ?? null, webhook_subscribed: sub.ok, registered: reg.ok, register_note: regNote });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error("whatsapp-embedded-signup error:", e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
