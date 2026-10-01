import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Temporary debug helper -- reads back a Facebook Login for Business
// configuration (and the app's own basic info) via the Graph API using the
// app access token, so we don't have to ask someone to click through the
// Meta dashboard and describe what they see. Delete this function once the
// OAuth issue is resolved; it's not linked from anywhere in the dashboard.

const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const META_LOGIN_CONFIG_ID = Deno.env.get("META_LOGIN_CONFIG_ID") ?? "";

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (!META_APP_ID || !META_APP_SECRET) return json({ error: "META_APP_ID/META_APP_SECRET missing" }, 500);
  const appToken = `${META_APP_ID}|${META_APP_SECRET}`;
  const base = "https://graph.facebook.com/v19.0";

  const out: Record<string, unknown> = {};

  try {
    const appRes = await fetch(`${base}/${META_APP_ID}?fields=name,link,category&access_token=${appToken}`);
    out.app = await appRes.json();
  } catch (e: any) { out.app = { error: e.message }; }

  if (META_LOGIN_CONFIG_ID) {
    try {
      const cfgRes = await fetch(`${base}/${META_LOGIN_CONFIG_ID}?fields=name,asset_type,permission_list,default_response_type,enable_multiple_assets,matched_user_ids,platform&access_token=${appToken}`);
      out.login_config = { status: cfgRes.status, body: await cfgRes.json() };
    } catch (e: any) { out.login_config = { error: e.message }; }
  } else {
    out.login_config = "META_LOGIN_CONFIG_ID not set";
  }

  try {
    const permRes = await fetch(`${base}/${META_APP_ID}/permissions?access_token=${appToken}`);
    out.app_permissions = await permRes.json();
  } catch (e: any) { out.app_permissions = { error: e.message }; }

  return json(out);
});
