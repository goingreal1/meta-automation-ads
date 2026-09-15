import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WEBHOOK_VERIFY_TOKEN") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v20.0";

async function setStatus(objectId: string, status: "ACTIVE" | "DELETED" | "PAUSED") {
  const params = new URLSearchParams({ access_token: META_ACCESS_TOKEN, status });
  const res = await fetch(`${META_GRAPH_BASE}/${objectId}?${params.toString()}`, { method: "POST" });
  return res.json();
}

async function sendWhatsApp(to: string, body: string) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return;
  await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // Meta webhook verification handshake (GET)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const payload = await req.json();

    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message || message.type !== "text") {
      return new Response("ok", { status: 200 });
    }

    const from = message.from; // sender's WhatsApp number
    const text = (message.text?.body ?? "").trim();

    const approveMatch = text.match(/^APPROVE\s+([a-f0-9-]+)/i);
    const rejectMatch = text.match(/^REJECT\s+([a-f0-9-]+)/i);

    if (!approveMatch && !rejectMatch) {
      return new Response("ok", { status: 200 }); // not a command, ignore (lets free chat pass through elsewhere)
    }

    const approvalId = (approveMatch ?? rejectMatch)![1];

    const { data: approval, error } = await supabase
      .from("pending_approvals")
      .select("*")
      .eq("id", approvalId)
      .maybeSingle();

    if (error || !approval) {
      await sendWhatsApp(from, `⚠️ No pending approval found with ID ${approvalId}`);
      return new Response("ok", { status: 200 });
    }

    if (approval.status !== "pending") {
      await sendWhatsApp(from, `⚠️ Approval ${approvalId} was already ${approval.status}.`);
      return new Response("ok", { status: 200 });
    }

    if (approveMatch) {
      const action = approval.proposed_action as any;

      if (approval.approval_type === "launch_test" && action?.meta_campaign_id) {
        // ai-auto-launch-tests stores the ad sets' real Meta ids directly in
        // proposed_action.ad_set_ids -- activate those, not a DB lookup by
        // ad_sets.campaign_id (that column holds the Meta campaign id, not a
        // local campaigns.id, so the old join-based lookup here always matched
        // zero rows and left ad sets stuck PAUSED even after "approval").
        await setStatus(action.meta_campaign_id, "ACTIVE");

        const adSetMetaIds: string[] = Array.isArray(action.ad_set_ids) ? action.ad_set_ids : [];
        for (const metaAdsetId of adSetMetaIds) {
          await setStatus(metaAdsetId, "ACTIVE");
        }

        // campaigns row may not exist yet for a brand-new batch (pull-meta-metrics
        // upserts it on its next hourly sync) -- update is a no-op if so, not an error.
        await supabase.from("campaigns").update({ status: "active", launched_at: new Date().toISOString() }).eq("meta_campaign_id", action.meta_campaign_id);
        if (adSetMetaIds.length) {
          await supabase.from("ad_sets").update({ status: "active" }).in("meta_adset_id", adSetMetaIds);
        }
        await supabase.from("creative_assets").update({ test_status: "testing", tested_at: new Date().toISOString() }).eq("id", approval.creative_asset_id);
      }

      if (approval.approval_type === "scale_winner" && action?.meta_adset_id) {
        await setStatus(action.meta_adset_id, "ACTIVE");
      }

      if (approval.approval_type === "pause_ad" || approval.approval_type === "kill_ad") {
        if (action?.meta_adset_id) await setStatus(action.meta_adset_id, "PAUSED");
      }

      await supabase.from("pending_approvals").update({ status: "approved", responded_at: new Date().toISOString() }).eq("id", approvalId);
      await sendWhatsApp(from, `✅ Approved and launched: ${approval.reason ?? approvalId}`);
    }

    if (rejectMatch) {
      const action = approval.proposed_action as any;
      if (approval.approval_type === "launch_test" && action?.meta_campaign_id) {
        await setStatus(action.meta_campaign_id, "DELETED");
        await supabase.from("creative_assets").update({ test_status: "untested" }).eq("id", approval.creative_asset_id);
      }
      await supabase.from("pending_approvals").update({ status: "rejected", responded_at: new Date().toISOString() }).eq("id", approvalId);
      await sendWhatsApp(from, `❌ Rejected: ${approval.reason ?? approvalId}`);
    }

    return new Response("ok", { status: 200 });
  } catch (err: any) {
    console.error("handle-whatsapp-reply error:", err);
    return new Response("ok", { status: 200 }); // always 200 so Meta doesn't retry-storm
  }
});
