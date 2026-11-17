import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Settings > AI apps. Each signed-in person sees the AI apps (ChatGPT, Claude...) connected to THEIR Revora login and can disconnect them.
//   POST { action: "list" }                    -> { apps: [{ name, logo, connected_at, last_active, active_sessions }], connector_url }
//   POST { action: "disconnect", name? }       -> { ok, removed }   (no name = disconnect every AI app)
// Only the caller's own connections are ever touched. The dashboard login itself is not an AI app session and is never removed.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const CONNECTOR_URL = "https://metaautomationads.vercel.app/mcp";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info"
};
const json = (o, s = 200)=>new Response(JSON.stringify(o), {
    status: s,
    headers: {
      "Content-Type": "application/json",
      ...CORS
    }
  });
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: CORS
  });
  if (req.method !== "POST") return json({
    error: "method_not_allowed"
  }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({
    error: "Sign in first."
  }, 401);
  const { data: ud } = await admin.auth.getUser(token);
  if (!ud?.user) return json({
    error: "Your sign-in expired. Sign in again."
  }, 401);
  let b = {};
  try {
    b = await req.json();
  } catch  {}
  const uid = ud.user.id;
  if (b?.action === "disconnect") {
    const name = b?.name ? String(b.name).slice(0, 120) : null;
    const { data, error } = await admin.rpc("ai_app_remove", {
      p_user: uid,
      p_name: name
    });
    if (error) return json({
      error: "Could not disconnect. Try again."
    }, 500);
    return json({
      ok: true,
      removed: data ?? 0
    });
  }
  const { data, error } = await admin.rpc("ai_apps_list", {
    p_user: uid
  });
  if (error) return json({
    error: "Could not load your connected apps."
  }, 500);
  return json({
    apps: (data ?? []).map((r)=>({
        name: r.app_name,
        logo: r.logo_uri,
        connected_at: r.connected_at,
        last_active: r.last_active,
        active_sessions: r.active_sessions
      })),
    connector_url: CONNECTOR_URL
  });
});
