import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v20.0";

async function metaGet(path: string, fields: string) {
  const params = new URLSearchParams({ access_token: META_ACCESS_TOKEN, fields, limit: "200" });
  const results: any[] = [];
  let url: string | null = `${META_GRAPH_BASE}/${path}?${params.toString()}`;
  while (url) {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(`Meta API error [${path}]: ${data.error.message}`);
    results.push(...(data.data ?? []));
    url = data.paging?.next ?? null;
  }
  return results;
}

function extractGenders(targeting: any): string[] {
  if (!targeting?.genders || targeting.genders.length === 0) return ["all"];
  return targeting.genders.map((g: number) => (g === 1 ? "male" : "female"));
}

function extractStates(targeting: any): string[] | null {
  const regions = targeting?.geo_locations?.regions;
  if (!regions) return null;
  return regions.map((r: any) => r.name ?? r.key);
}

function extractCountries(targeting: any): string[] {
  return targeting?.geo_locations?.countries ?? ["NG"];
}

function extractInterests(targeting: any): any {
  const spec = targeting?.flexible_spec;
  if (!spec) return null;
  return spec.flatMap((s: any) => s.interests ?? []).map((i: any) => i.name);
}

Deno.serve(async (_req: Request) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const summary = { campaigns: 0, ad_sets: 0, ads: 0, errors: [] as string[] };

  try {
    const { data: adAccounts } = await supabase.from("ad_accounts").select("*").eq("status", "active");
    if (!adAccounts || adAccounts.length === 0) {
      return json({ message: "No active ad accounts registered" });
    }

    for (const account of adAccounts) {
      // Some ad_accounts rows have meta_ad_account_id stored WITH the "act_"
      // prefix already baked in (data entry inconsistency, not this account's
      // fault) -- strip it first so this never doubles up into "act_act_...",
      // which Meta rejects as a nonexistent object.
      const acctPath = `act_${(account.meta_ad_account_id || "").replace(/^act_/, "")}`;

      // 1. Pull all campaigns for this account
      let metaCampaigns: any[] = [];
      try {
        metaCampaigns = await metaGet(`${acctPath}/campaigns`, "id,name,objective,status,daily_budget,lifetime_budget");
      } catch (e: any) {
        summary.errors.push(`Campaigns fetch (${account.nickname}): ${e.message}`);
        continue;
      }

      for (const c of metaCampaigns) {
        const { data: campaignRow } = await supabase.from("campaigns").upsert({
          meta_campaign_id: c.id,
          campaign_name: c.name,
          campaign_type: (c.name ?? "").toUpperCase().startsWith("SCALE") ? "scaling" : "testing",
          objective: "conversions",
          objective_raw: c.objective,
          daily_budget_naira: c.daily_budget ? Number(c.daily_budget) / 100 : null,
          lifetime_budget_naira: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
          status: (c.status ?? "").toLowerCase(),
          ad_account_id: account.id,
          meta_raw: c,
        }, { onConflict: "meta_campaign_id" }).select().single();
        summary.campaigns++;

        // 2. Pull ad sets for this campaign
        let metaAdSets: any[] = [];
        try {
          metaAdSets = await metaGet(`${c.id}/adsets`, "id,name,status,daily_budget,lifetime_budget,targeting,optimization_goal,bid_strategy,start_time,end_time,promoted_object,destination_type");
        } catch (e: any) {
          summary.errors.push(`AdSets fetch (${c.name}): ${e.message}`);
          continue;
        }

        for (const as of metaAdSets) {
          const targeting = as.targeting ?? {};
          const targetingType = targeting.custom_audiences?.length
            ? "retargeting"
            : targeting.flexible_spec?.length
            ? "interest"
            : "broad";

          const { data: adSetRow } = await supabase.from("ad_sets").upsert({
            meta_adset_id: as.id,
            campaign_id: campaignRow?.id,
            adset_name: as.name,
            targeting_type: targetingType,
            budget_naira: as.daily_budget ? Number(as.daily_budget) / 100 : (as.lifetime_budget ? Number(as.lifetime_budget) / 100 : null),
            status: (as.status ?? "").toLowerCase(),
            age_min: targeting.age_min ?? null,
            age_max: targeting.age_max ?? null,
            genders: extractGenders(targeting),
            states: extractStates(targeting),
            countries: extractCountries(targeting),
            interests: extractInterests(targeting),
            optimization_goal: as.optimization_goal,
            bid_strategy: as.bid_strategy,
            meta_raw: as,
          }, { onConflict: "meta_adset_id" }).select().single();
          summary.ad_sets++;

          // 3. Pull ads (+creative details) for this ad set
          let metaAds: any[] = [];
          try {
            metaAds = await metaGet(
              `${as.id}/ads`,
              "id,name,status,creative{id,object_story_spec,image_url,video_id,body,title,link_url,object_type}"
            );
          } catch (e: any) {
            summary.errors.push(`Ads fetch (${as.name}): ${e.message}`);
            continue;
          }

          for (const ad of metaAds) {
            const creative = ad.creative ?? {};
            const story = creative.object_story_spec ?? {};
            const linkData = story.link_data ?? {};
            const videoData = story.video_data ?? {};

            const primaryText = linkData.message ?? videoData.message ?? creative.body ?? null;
            const headline = linkData.name ?? videoData.title ?? creative.title ?? null;
            const description = linkData.description ?? videoData.link_description ?? null;
            const imageUrl = linkData.picture ?? creative.image_url ?? null;
            const videoId = videoData.video_id ?? creative.video_id ?? null;
            const destLink = linkData.link ?? videoData.call_to_action?.value?.link ?? creative.link_url ?? null;
            const ctaType = linkData.call_to_action?.type ?? videoData.call_to_action?.type ?? null;

            await supabase.from("creatives").upsert({
              meta_ad_id: ad.id,
              creative_name: ad.name,
              // creatives.status has a check constraint allowing only testing/winner/
              // scaling/fatiguing/killed/retired -- Meta's real statuses (PAUSED,
              // ARCHIVED, DELETED, etc.) don't match any of those and were failing
              // this upsert entirely, silently dropping every non-ACTIVE ad's creative.
              status: (ad.status ?? "").toLowerCase() === "active" ? "testing" : "retired",
              post_id: ad.id,
              primary_text: primaryText,
              headline: headline,
              description: description,
              image_url: imageUrl,
              video_id: videoId,
              video_url: imageUrl ?? videoId,
              destination_link: destLink,
              cta_type: ctaType,
              meta_raw: ad,
            }, { onConflict: "meta_ad_id" });
            summary.ads++;

            // Link the ad_set to this creative if not already linked
            if (adSetRow && !adSetRow.creative_id) {
              const { data: creativeRow } = await supabase.from("creatives").select("id").eq("meta_ad_id", ad.id).maybeSingle();
              if (creativeRow) {
                await supabase.from("ad_sets").update({ creative_id: creativeRow.id }).eq("id", adSetRow.id);
              }
            }
          }
        }
      }
    }

    return json({ success: true, summary });
  } catch (err: any) {
    console.error("sync-meta-structure error:", err);
    return json({ error: err.message, summary }, 500);
  }
});

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
