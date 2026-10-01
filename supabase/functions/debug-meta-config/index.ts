import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Temporary debug helper -- probes several Graph API shapes for reading back
// a Facebook Login for Business configuration, since the straightforward
// GET /{config_id} came back "does not exist". Delete once resolved.

const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const META_LOGIN_CONFIG_ID = Deno.env.get("META_LOGIN_CONFIG_ID") ?? "";
const META_BUSINESS_ID = Deno.env.get("META_BUSINESS_ID") ?? "1386477495726326";

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
  if (!META_APP_ID || !META_APP_SECRET) return json({ error: "META_APP_ID/META_APP_SECRET missing" }, 500);
  const appToken = `${META_APP_ID}|${META_APP_SECRET}`;
  const base = "https://graph.facebook.com/v19.0";
  const out: Record<string, unknown> = {};

  await tryFetch("config_minimal", `${base}/${META_LOGIN_CONFIG_ID}?access_token=${appToken}`, out);
  await tryFetch("config_id_name_only", `${base}/${META_LOGIN_CONFIG_ID}?fields=id,name&access_token=${appToken}`, out);
  await tryFetch("app_login_configs_edge", `${base}/${META_APP_ID}/business_login_configurations?access_token=${appToken}`, out);
  await tryFetch("business_configs_edge", `${base}/${META_BUSINESS_ID}/business_configurations?access_token=${appToken}`, out);
  await tryFetch("app_basic", `${base}/${META_APP_ID}?fields=id,name&access_token=${appToken}`, out);
  await tryFetch("business_basic", `${base}/${META_BUSINESS_ID}?fields=id,name&access_token=${appToken}`, out);
  await tryFetch("debug_token", `${base}/debug_token?input_token=${appToken}&access_token=${appToken}`, out);

  return json(out);
});
