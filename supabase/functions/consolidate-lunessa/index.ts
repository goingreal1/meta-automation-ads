import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v20.0";

const FEMALE_ADSET_ID = "6986639560081";
const MALE_ADSET_ID = "6986639584281";
const ALL_ADSET_ID = "6986639609681";

// Keep variant 1, delete variants 2 and 3
const FEMALE_ADS_TO_DELETE = ["6986639573281", "6986639576681"];
const FEMALE_AD_TO_KEEP = "6986639570881";

const NEW_DAILY_BUDGET_KOBO = 140000; // ₦1,400/day — above the account's ₦1,322.71 minimum

async function deleteObject(id: string) {
  const params = new URLSearchParams({ access_token: META_ACCESS_TOKEN });
  const res = await fetch(`${META_GRAPH_BASE}/${id}?${params.toString()}`, { method: "DELETE" });
  return res.json();
}

async function updateBudget(id: string, dailyBudgetKobo: number) {
  const params = new URLSearchParams({ access_token: META_ACCESS_TOKEN, daily_budget: String(dailyBudgetKobo) });
  const res = await fetch(`${META_GRAPH_BASE}/${id}?${params.toString()}`, { method: "POST" });
  return res.json();
}

async function verify(id: string, fields: string) {
  const params = new URLSearchParams({ access_token: META_ACCESS_TOKEN, fields });
  const res = await fetch(`${META_GRAPH_BASE}/${id}?${params.toString()}`);
  return res.json();
}

Deno.serve(async (_req: Request) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const results: Record<string, unknown> = {};

  results.male_adset_deleted = await deleteObject(MALE_ADSET_ID);
  await supabase.from("ad_sets").update({ status: "deleted" }).eq("meta_adset_id", MALE_ADSET_ID);

  results.all_adset_deleted = await deleteObject(ALL_ADSET_ID);
  await supabase.from("ad_sets").update({ status: "deleted" }).eq("meta_adset_id", ALL_ADSET_ID);

  const adDeletes = [];
  for (const adId of FEMALE_ADS_TO_DELETE) {
    adDeletes.push({ id: adId, result: await deleteObject(adId) });
  }
  results.female_ads_deleted = adDeletes;

  results.budget_update = await updateBudget(FEMALE_ADSET_ID, NEW_DAILY_BUDGET_KOBO);
  await supabase.from("ad_sets").update({ budget_naira: NEW_DAILY_BUDGET_KOBO / 100 }).eq("meta_adset_id", FEMALE_ADSET_ID);

  // Verify final state directly from Meta
  results.final_adset_state = await verify(FEMALE_ADSET_ID, "name,effective_status,daily_budget,budget_remaining");
  results.final_ad_state = await verify(FEMALE_AD_TO_KEEP, "name,effective_status");

  return new Response(JSON.stringify(results, null, 2), { headers: { "Content-Type": "application/json" } });
});
