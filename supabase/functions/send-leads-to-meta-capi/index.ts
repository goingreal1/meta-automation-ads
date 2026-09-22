import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PIXEL_ID = "2251041928961730";
const META_GRAPH_BASE = "https://graph.facebook.com/v20.0";

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (_req: Request) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: leads } = await supabase.from("leads").select("*").neq("full_name", "<test lead: dummy data for full_name>");
  const { data: alreadySent } = await supabase.from("event_logs").select("event_id").eq("event_name", "Lead");
  const sentIds = new Set((alreadySent ?? []).map((r: any) => r.event_id));

  const results: any[] = [];
  for (const lead of leads ?? []) {
    const eventId = `lead-${lead.lead_id}`;
    if (sentIds.has(eventId)) { results.push({ lead_id: lead.lead_id, skipped: "already sent" }); continue; }

    const userData: Record<string, unknown> = {};
    if (lead.phone) userData.ph = [await sha256(lead.phone.replace(/\D/g, ""))];
    if (lead.email) userData.em = [await sha256(lead.email)];

    const payload = {
      data: [{
        event_name: "Lead",
        event_time: Math.floor(new Date(lead.created_at ?? Date.now()).getTime() / 1000),
        event_id: eventId,
        action_source: "system_generated",
        user_data: userData,
        custom_data: { lead_event_source: "CloudERP CRM" },
      }],
    };

    const res = await fetch(`${META_GRAPH_BASE}/${PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!data.error) {
      await supabase.from("event_logs").insert({ event_name: "Lead", event_id: eventId, event_source: "server", sent_to_meta: true });
    }
    results.push({ lead_id: lead.lead_id, full_name: lead.full_name, result: data });
  }

  return new Response(JSON.stringify(results, null, 2), { headers: { "Content-Type": "application/json" } });
});
