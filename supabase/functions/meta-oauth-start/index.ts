import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { signState } from "../_shared/oauth_state.ts";

// Step 1 of "Connect Meta Business Manager" (per media buyer). The dashboard
// links here directly (a normal <a href>, not fetch -- Facebook's dialog has
// to be a real top-level navigation): the browser lands on this function,
// which 302s straight to Facebook's OAuth dialog. Facebook then redirects
// the browser to meta-oauth-callback when the buyer approves.
//
//   GET /meta-oauth-start?media_buyer_id=<uuid>&access_token=<supabase session token>

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_OAUTH_STATE_SECRET = Deno.env.get("META_OAUTH_STATE_SECRET") ?? "";
// Set once a "Facebook Login for Business" configuration exists on the app
// (App Dashboard -> Facebook Login for Business -> Configurations). Once an
// app has that product added, Facebook's classic scope-string dialog
// ("Feature unavailable: Facebook Login is currently unavailable for this
// app...") gets rejected for non-tester logins -- the config_id-based dialog
// below is what Meta now expects instead. The configuration itself (set up
// in the Meta dashboard, not here) defines which permissions/assets it asks
// for, so SCOPES below is unused whenever this is set.
// Public id of the "Facebook Login for Business" configuration (system-user token that never expires,
// ads_management etc.). The env var, if set, wins; otherwise this default is used.
const META_LOGIN_CONFIG_ID = Deno.env.get("META_LOGIN_CONFIG_ID") || "1784938949217359";

// ads_read: pull spend/insights for the accounts they grant. business_management:
// list accounts, incl. ones held under a Business Manager rather than personally.
// whatsapp_business_management/whatsapp_business_messaging: list/add/verify a
// WhatsApp number on their Business Account and send/receive messages on it
// (see buyer_whatsapp_numbers -- Settings' "Add WhatsApp number"). pages_show_list/
// pages_read_engagement/pages_manage_engagement: list their Pages and reply to
// comments on their own ads. Confirmed Advanced Access already granted on this
// app for all of these (checked directly against /me/permissions).
const SCOPES = "ads_read,business_management,whatsapp_business_management,whatsapp_business_messaging,pages_show_list,pages_read_engagement,pages_manage_engagement";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function html(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req: Request) => {
  if (!META_APP_ID || !META_OAUTH_STATE_SECRET) {
    return html("Meta OAuth isn't configured yet (META_APP_ID / META_OAUTH_STATE_SECRET missing). Ask whoever manages this dashboard to finish setup.", 500);
  }

  const url = new URL(req.url);
  const mediaBuyerId = url.searchParams.get("media_buyer_id");
  const accessToken = url.searchParams.get("access_token");
  if (!mediaBuyerId || !accessToken) {
    return html("Missing media_buyer_id or access_token.", 400);
  }

  // Confirm this is a real, currently-signed-in dashboard session before
  // sending anyone to Facebook -- otherwise a stranger with just a buyer's
  // UUID (visible in the dashboard's own URLs) could kick off a connection.
  const { data: userData, error: authErr } = await supabase.auth.getUser(accessToken);
  if (authErr || !userData?.user) return html("Your dashboard session has expired -- go back and refresh the page, then try again.", 401);

  const { data: buyer } = await supabase.from("media_buyers").select("id, company_id").eq("id", mediaBuyerId).maybeSingle();
  if (!buyer) return html("Unknown media buyer.", 404);

  // Confirming the session exists isn't enough -- it also has to be allowed
  // to connect *this* buyer: an owner/admin of the buyer's own company, or
  // the buyer themselves. Without this, any signed-in user (any company)
  // could pass a different buyer's UUID and hijack their Meta connection.
  const { data: profile } = await supabase.from("profiles").select("role, company_id, media_buyer_id").eq("id", userData.user.id).maybeSingle();
  const isAdmin = profile?.role === "owner" || profile?.role === "admin";
  const sameCompany = profile?.company_id === buyer.company_id;
  const isSelf = profile?.media_buyer_id === mediaBuyerId;
  if (!profile || !sameCompany || !(isAdmin || isSelf)) {
    return html("You don't have permission to connect this buyer's Meta account.", 403);
  }

  const state = await signState(META_OAUTH_STATE_SECRET, mediaBuyerId);
  const redirectUri = `${SUPABASE_URL}/functions/v1/meta-oauth-callback`;

  // Temporary: ?mode=scope forces the classic scope-string dialog even when
  // META_LOGIN_CONFIG_ID is set, to A/B test against the config_id path
  // without touching the secret. Remove once the OAuth issue is resolved.
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

  console.log("meta-oauth-start dialog URL:", dialogUrl.toString());
  return new Response(null, { status: 302, headers: { Location: dialogUrl.toString() } });
});
