import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyState } from "../_shared/oauth_state.ts";

// Step 2: Facebook redirects the browser here after the buyer approves (or
// denies) the OAuth dialog from meta-oauth-start. Exchanges the code for a
// long-lived user token, lists the ad accounts that token can see, and
// stores it -- then sends the browser back to the dashboard.
//
// This exact URL (SUPABASE_URL/functions/v1/meta-oauth-callback) must be
// added to the Meta App's Valid OAuth Redirect URIs, or Facebook rejects the
// whole flow before it ever reaches this function.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const META_OAUTH_STATE_SECRET = Deno.env.get("META_OAUTH_STATE_SECRET") ?? "";
// Where to send the buyer's browser back to once connected -- e.g.
// https://yourdomain.com/dashboard_new.html. Optional: without it, they see a
// plain "connected, go back to your dashboard" page instead of an auto-redirect.
const DASHBOARD_URL = Deno.env.get("DASHBOARD_URL") ?? "";

const META_GRAPH_BASE = "https://graph.facebook.com/v19.0";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function finish(status: "connected" | "error", detail: string, extra: Record<string, string> = {}) {
  if (DASHBOARD_URL) {
    const u = new URL(DASHBOARD_URL);
    u.searchParams.set("meta_oauth", status);
    u.searchParams.set("detail", detail);
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
    return new Response(null, { status: 302, headers: { Location: u.toString() } });
  }
  const ok = status === "connected";
  return new Response(
    `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:60px 20px;">
      <h2>${ok ? "✅ Connected" : "❌ Something went wrong"}</h2>
      <p>${detail.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))}</p>
      <p>${ok ? "You can close this tab and go back to your dashboard's Settings page." : "Go back to your dashboard and try again."}</p>
    </body></html>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const fbError = url.searchParams.get("error_description") || url.searchParams.get("error");

  if (fbError) return finish("error", `Facebook said: ${fbError}`);
  if (!META_APP_ID || !META_APP_SECRET || !META_OAUTH_STATE_SECRET) {
    return finish("error", "Meta OAuth isn't fully configured on the server (missing META_APP_ID / META_APP_SECRET / META_OAUTH_STATE_SECRET).");
  }
  if (!code) return finish("error", "No authorization code from Facebook.");

  const verified = await verifyState(META_OAUTH_STATE_SECRET, state);
  if (!verified) return finish("error", "This connection link expired or is invalid -- go back to Settings and click Connect Meta again.");
  const { mediaBuyerId } = verified;

  try {
    const redirectUri = `${SUPABASE_URL}/functions/v1/meta-oauth-callback`;

    // code -> short-lived user token
    const shortRes = await fetch(
      `${META_GRAPH_BASE}/oauth/access_token?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${META_APP_SECRET}&code=${code}`,
    );
    const shortData = await shortRes.json();
    if (!shortRes.ok || !shortData.access_token) throw new Error(shortData.error?.message || "Failed to exchange code for a token.");

    // short-lived -> long-lived (~60 days) user token
    const longRes = await fetch(
      `${META_GRAPH_BASE}/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${shortData.access_token}`,
    );
    const longData = await longRes.json();
    if (!longRes.ok || !longData.access_token) throw new Error(longData.error?.message || "Failed to get a long-lived token.");

    const accessToken = longData.access_token as string;
    const expiresAt = longData.expires_in ? new Date(Date.now() + longData.expires_in * 1000).toISOString() : null;

    const meRes = await fetch(`${META_GRAPH_BASE}/me?fields=id,name&access_token=${accessToken}`);
    const me = await meRes.json();
    if (!meRes.ok) throw new Error(me.error?.message || "Could not read the connected Facebook profile.");

    const acctRes = await fetch(
      `${META_GRAPH_BASE}/me/adaccounts?fields=name,account_id,account_status,business_name,currency&limit=200&access_token=${accessToken}`,
    );
    const acctData = await acctRes.json();
    if (!acctRes.ok) throw new Error(acctData.error?.message || "Could not list ad accounts for this Facebook login.");
    // Note: only the first 200 accounts are listed if a Business Manager has
    // more than that -- fine for this use case, but real for very large BMs.
    const discoveredAdAccounts = (acctData.data ?? []).map((a: any) => ({
      account_id: a.account_id,
      name: a.name,
      business_name: a.business_name ?? null,
      account_status: a.account_status,
      currency: a.currency,
    }));

    // Supersede any earlier connection for this same buyer so pull-meta-metrics
    // never has two "active" tokens to choose between for one buyer.
    await supabase.from("meta_connections").update({ status: "revoked" }).eq("media_buyer_id", mediaBuyerId).eq("status", "active");

    const { data: connection, error } = await supabase.from("meta_connections").insert({
      media_buyer_id: mediaBuyerId,
      fb_user_id: me.id,
      fb_user_name: me.name ?? null,
      access_token: accessToken,
      token_expires_at: expiresAt,
      scopes: "ads_read,business_management,whatsapp_business_management,whatsapp_business_messaging,pages_show_list,pages_read_engagement,pages_manage_engagement",
      status: "active",
      discovered_ad_accounts: discoveredAdAccounts,
      last_synced_at: new Date().toISOString(),
    }).select("id").single();
    if (error || !connection) throw new Error(`Could not save the connection: ${error?.message}`);

    return finish("connected", `Connected as ${me.name || me.id}. Found ${discoveredAdAccounts.length} ad account(s) -- pick which ones to add in Settings.`, { connection_id: connection.id });
  } catch (err: any) {
    console.error("meta-oauth-callback error:", err);
    return finish("error", err.message);
  }
});
