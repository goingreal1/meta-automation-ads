import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Temporary debug helper. Delete once resolved.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_BUSINESS_ID = Deno.env.get("META_BUSINESS_ID") ?? "1386477495726326";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { "Content-Type": "application/json" } });
}

async function tryFetch(label: string, url: string, out: Record<string, unknown>) {
  try {
    const res = await fetch(url);
    out[label] = { status: res.status, body: await res.json() };
  } catch (e: any) {
    out[label] = { error: e.message };
  }
}

Deno.serve(async (_req: Request) => {
  const { data: conn } = await supabase
    .from("meta_connections")
    .select("access_token, fb_user_name, status")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conn?.access_token) return json({ error: "No active meta_connections row with a token found" }, 500);

  const token = conn.access_token;
  const base = "https://graph.facebook.com/v19.0";
  const out: Record<string, unknown> = { using_token_for: conn.fb_user_name };

  await tryFetch("agencies", `${base}/${META_BUSINESS_ID}/agencies?access_token=${token}`, out);
  await tryFetch("clients", `${base}/${META_BUSINESS_ID}/clients?access_token=${token}`, out);
  await tryFetch("pending_users", `${base}/${META_BUSINESS_ID}/pending_users?access_token=${token}`, out);
  await tryFetch("business_users", `${base}/${META_BUSINESS_ID}/business_users?access_token=${token}`, out);

  return json(out);
});
