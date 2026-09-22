import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v20.0";

const CAMPAIGN_ID = "6986639072081";
const ADSET_IDS = ["6986639560081", "6986639584281", "6986639609681"];
const AD_IDS = [
  "6986639570881", "6986639573281", "6986639576681",
  "6986639595481", "6986639598481", "6986639602281",
  "6986639627281", "6986639630481", "6986639638681",
];

async function setActive(objectId: string): Promise<{ id: string; ok: boolean; error?: any; effective_status?: string }> {
  const params = new URLSearchParams({ access_token: META_ACCESS_TOKEN, status: "ACTIVE" });
  const res = await fetch(`${META_GRAPH_BASE}/${objectId}?${params.toString()}`, { method: "POST" });
  const data = await res.json();
  if (data.error) return { id: objectId, ok: false, error: data.error };

  const checkParams = new URLSearchParams({ access_token: META_ACCESS_TOKEN, fields: "effective_status" });
  const checkRes = await fetch(`${META_GRAPH_BASE}/${objectId}?${checkParams.toString()}`);
  const checkData = await checkRes.json();
  return { id: objectId, ok: true, effective_status: checkData.effective_status };
}

Deno.serve(async (_req: Request) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const results: Record<string, unknown> = {};

  results.campaign = await setActive(CAMPAIGN_ID);
  await supabase.from("campaigns").update({ status: "active", launched_at: new Date().toISOString() }).eq("meta_campaign_id", CAMPAIGN_ID);

  const adsetResults = [];
  for (const id of ADSET_IDS) {
    const r = await setActive(id);
    adsetResults.push(r);
    if (r.ok) await supabase.from("ad_sets").update({ status: "active" }).eq("meta_adset_id", id);
  }
  results.adsets = adsetResults;

  const adResults = [];
  for (const id of AD_IDS) {
    adResults.push(await setActive(id));
  }
  results.ads = adResults;

  const allOk = results.campaign.ok && adsetResults.every((r) => r.ok) && adResults.every((r) => r.ok);
  return new Response(JSON.stringify({ all_succeeded: allOk, ...results }, null, 2), { headers: { "Content-Type": "application/json" } });
});
