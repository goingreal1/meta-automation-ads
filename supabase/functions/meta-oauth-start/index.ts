import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { signState } from "./_shared/oauth_state.ts";
// Step 1 of "Connect with Facebook" (per media buyer). The dashboard links here directly
// (a normal navigation): this function 302s to Facebook's login dialog, which then
// redirects to meta-oauth-callback.
//   GET /meta-oauth-start?media_buyer_id=<uuid>&access_token=<supabase session token>
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_OAUTH_STATE_SECRET = Deno.env.get("META_OAUTH_STATE_SECRET") ?? "";
// Public id of the "Facebook Login for Business" configuration (system-user token that never expires,
// ads_management etc.). The env var, if set, wins; otherwise this default is used.
const META_LOGIN_CONFIG_ID = Deno.env.get("META_LOGIN_CONFIG_ID") || "1784938949217359";
// Only used when ?mode=scope forces the classic scope dialog.
const SCOPES = "ads_read,business_management,whatsapp_business_management,whatsapp_business_messaging,pages_show_list,pages_read_engagement,pages_manage_engagement";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8"
    }
  });
}
Deno.serve(async (req)=>{
  if (!META_APP_ID || !META_OAUTH_STATE_SECRET) {
    return html("Meta OAuth isn't configured yet (META_APP_ID / META_OAUTH_STATE_SECRET missing). Ask whoever manages this dashboard to finish setup.", 500);
  }
  const url = new URL(req.url);
  const mediaBuyerId = url.searchParams.get("media_buyer_id");
  const accessToken = url.searchParams.get("access_token");
  if (!mediaBuyerId || !accessToken) {
    return html("Missing media_buyer_id or access_token.", 400);
  }
  const { data: userData, error: authErr } = await supabase.auth.getUser(accessToken);
  if (authErr || !userData?.user) return html("Your dashboard session has expired -- go back and refresh the page, then try again.", 401);
  const { data: buyer } = await supabase.from("media_buyers").select("id, company_id").eq("id", mediaBuyerId).maybeSingle();
  if (!buyer) return html("Unknown media buyer.", 404);
  // Must be allowed to connect *this* buyer: an owner/admin of the buyer's company, or the buyer themselves.
  const { data: profile } = await supabase.from("profiles").select("role, company_id, media_buyer_id").eq("id", userData.user.id).maybeSingle();
  const isAdmin = profile?.role === "owner" || profile?.role === "admin";
  const sameCompany = profile?.company_id === buyer.company_id;
  const isSelf = profile?.media_buyer_id === mediaBuyerId;
  if (!profile || !sameCompany || !(isAdmin || isSelf)) {
    return html("You don't have permission to connect this buyer's Meta account.", 403);
  }
  const state = await signState(META_OAUTH_STATE_SECRET, mediaBuyerId);
  const redirectUri = `${SUPABASE_URL}/functions/v1/meta-oauth-callback`;
  const forceScope = url.searchParams.get("mode") === "scope";
  const dialogUrl = new URL("https://www.facebook.com/v19.0/dialog/oauth");
  dialogUrl.searchParams.set("client_id", META_APP_ID);
  dialogUrl.searchParams.set("redirect_uri", redirectUri);
  dialogUrl.searchParams.set("state", state);
  dialogUrl.searchParams.set("response_type", "code");
  if (META_LOGIN_CONFIG_ID && !forceScope) {
    dialogUrl.searchParams.set("config_id", META_LOGIN_CONFIG_ID);
  } else {
    dialogUrl.searchParams.set("scope", SCOPES);
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: dialogUrl.toString()
    }
  });
});
