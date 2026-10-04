import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// In-dashboard Approve/Reject for the Approvals tab -- mirrors exactly what
// handle-whatsapp-reply does for an "APPROVE <id>"/"REJECT <id>" WhatsApp
// reply, so someone with no WhatsApp number configured (or who simply isn't
// on WhatsApp) can still launch or kill a pending campaign. Deliberately a
// separate function rather than a refactor of handle-whatsapp-reply -- that
// one is live and working in production; this reimplements the same Meta
// calls against the same pending_approvals rows instead of risking it.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v21.0";
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

async function setStatus(objectId: string, status: "ACTIVE" | "DELETED" | "PAUSED") {
  const params = new URLSearchParams({ access_token: META_ACCESS_TOKEN, status });
  const res = await fetch(`${META_GRAPH_BASE}/${objectId}?${params.toString()}`, { method: "POST" });
  return res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not signed in" }, 401);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return json({ error: "Not signed in" }, 401);

  const { data: profile } = await supabase.from("profiles").select("company_id, role").eq("id", user.id).maybeSingle();
  if (!profile?.company_id) return json({ error: "No company on this account yet" }, 400);
  // Same authority as whoever's WhatsApp number the approval request goes
  // to today -- the account owner/admin, not every role that can merely see
  // the Approvals tab.
  if (!["owner", "admin"].includes(profile.role)) return json({ error: "Only an owner/admin can approve or reject a launch." }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* no body */ }
  const approvalId = (body?.approval_id || "").toString();
  const action = body?.action === "reject" ? "reject" : body?.action === "approve" ? "approve" : null;
  if (!approvalId || !action) return json({ error: "approval_id and action ('approve'|'reject') are required" }, 400);

  const { data: approval, error } = await supabase
    .from("pending_approvals")
    .select("*")
    .eq("id", approvalId)
    .eq("company_id", profile.company_id)
    .maybeSingle();
  if (error || !approval) return json({ error: "Approval not found" }, 404);
  if (approval.status !== "pending") return json({ error: `This was already ${approval.status}.` }, 400);

  const proposed = approval.proposed_action as any;

  if (action === "approve") {
    if (approval.approval_type === "launch_test" && proposed?.meta_campaign_id) {
      await setStatus(proposed.meta_campaign_id, "ACTIVE");
      const adSetMetaIds: string[] = Array.isArray(proposed.ad_set_ids) ? proposed.ad_set_ids : [];
      for (const metaAdsetId of adSetMetaIds) await setStatus(metaAdsetId, "ACTIVE");

      await supabase.from("campaigns").update({ status: "active", launched_at: new Date().toISOString() }).eq("meta_campaign_id", proposed.meta_campaign_id);
      if (adSetMetaIds.length) await supabase.from("ad_sets").update({ status: "active" }).in("meta_adset_id", adSetMetaIds);
      await supabase.from("creative_assets").update({ test_status: "testing", tested_at: new Date().toISOString() }).eq("id", approval.creative_asset_id);
    }
    if (approval.approval_type === "scale_winner" && proposed?.meta_adset_id) {
      await setStatus(proposed.meta_adset_id, "ACTIVE");
    }
    if ((approval.approval_type === "pause_ad" || approval.approval_type === "kill_ad") && proposed?.meta_adset_id) {
      await setStatus(proposed.meta_adset_id, "PAUSED");
    }
    await supabase.from("pending_approvals").update({ status: "approved", responded_at: new Date().toISOString() }).eq("id", approvalId);
    return json({ ok: true, status: "approved" });
  }

  // reject
  if (approval.approval_type === "launch_test" && proposed?.meta_campaign_id) {
    await setStatus(proposed.meta_campaign_id, "DELETED");
    await supabase.from("creative_assets").update({ test_status: "untested" }).eq("id", approval.creative_asset_id);
  }
  await supabase.from("pending_approvals").update({ status: "rejected", responded_at: new Date().toISOString() }).eq("id", approvalId);
  return json({ ok: true, status: "rejected" });
});
