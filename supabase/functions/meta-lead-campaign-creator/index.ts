const GRAPH_API_VERSION = "v22.0";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
const RAW_AD_ACCOUNT_ID = Deno.env.get("META_AD_ACCOUNT_ID");
const META_AD_ACCOUNT_ID = RAW_AD_ACCOUNT_ID && RAW_AD_ACCOUNT_ID.startsWith("act_")
  ? RAW_AD_ACCOUNT_ID
  : `act_${RAW_AD_ACCOUNT_ID}`;
const META_PAGE_ID = Deno.env.get("META_PAGE_ID");
const CREATOR_KEY = Deno.env.get("META_CREATOR_KEY");

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

async function create(path: string, params: Record<string, string>) {
  const form = new URLSearchParams({ ...params, access_token: META_ACCESS_TOKEN! });
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function update(path: string, params: Record<string, string>) {
  const form = new URLSearchParams({ ...params, access_token: META_ACCESS_TOKEN! });
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data;
}

function firstValue(value: any) {
  return Array.isArray(value) ? value[0] : value;
}

function leadCreativeSpec(source: any, formId: string) {
  const story = source.object_story_spec ?? {};
  const feed = source.asset_feed_spec ?? {};
  const image = firstValue(feed.images)?.hash;
  const video = firstValue(feed.videos)?.video_id;
  const body = firstValue(feed.bodies)?.text ?? story.link_data?.message ?? "Learn more and request yours today.";
  const title = firstValue(feed.titles)?.text ?? story.link_data?.name ?? "Request more information";
  const link = firstValue(feed.link_urls)?.website_url ?? story.link_data?.link ?? "https://appi.com.ng/beoliv/beoliv-solution/";
  const spec: Record<string, unknown> = {
    page_id: story.page_id ?? META_PAGE_ID,
    link_data: {
      link,
      message: body,
      name: title,
      call_to_action: { type: "SIGN_UP", value: { lead_gen_form_id: formId } },
    },
  };
  if (story.instagram_user_id) spec.instagram_user_id = story.instagram_user_id;
  if (video) {
    (spec.link_data as Record<string, unknown>).video_id = video;
  } else if (image) {
    (spec.link_data as Record<string, unknown>).image_hash = image;
  }
  return spec;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "POST required" }, 405);
  if (!META_ACCESS_TOKEN || !META_AD_ACCOUNT_ID || !META_PAGE_ID || !CREATOR_KEY) {
    return json({ error: "Creator is not configured" }, 500);
  }
  if (request.headers.get("x-creator-key") !== CREATOR_KEY) return json({ error: "Unauthorized" }, 401);

  try {
    const body = await request.json();
    if (body.action === "pause") {
      const campaignId = String(body.campaign_id ?? "");
      if (!campaignId) return json({ error: "campaign_id is required" }, 400);
      const result = await update(campaignId, { status: "PAUSED" });
      return json({ status: "PAUSED", campaign_id: campaignId, meta_response: result });
    }

    const formId = String(body.form_id ?? "");
    const sourceCreatives = Array.isArray(body.source_creatives) ? body.source_creatives : [];
    const campaignName = String(body.campaign_name ?? "BEOLIV Leads - Instant Form");
    const dailyBudget = Number(body.daily_budget ?? 300000);
    const existingCampaignId = String(body.campaign_id ?? "");
    const startTime = String(body.start_time ?? "");
    const launchStatus = "PAUSED";
    if (!formId || sourceCreatives.length !== 5 || !Number.isInteger(dailyBudget) || dailyBudget <= 0) {
      return json({ error: "form_id, exactly five source_creatives, and positive daily_budget are required" }, 400);
    }

    const campaign = existingCampaignId
      ? { id: existingCampaignId }
      : await create(`${META_AD_ACCOUNT_ID}/campaigns`, {
        name: campaignName,
        objective: "OUTCOME_LEADS",
        status: "PAUSED",
        special_ad_categories: "[]",
        is_adset_budget_sharing_enabled: "false",
        ...(startTime ? { start_time: startTime } : {}),
      });

    const targeting = {
      geo_locations: { countries: ["NG"], location_types: ["home", "recent"] },
      age_min: 30,
      age_max: 64,
      publisher_platforms: ["facebook"],
      facebook_positions: ["feed", "facebook_reels"],
      instagram_positions: ["stream", "reels"],
      device_platforms: ["mobile"],
      targeting_automation: { advantage_audience: 0 },
    };
    const adSet = await create(`${META_AD_ACCOUNT_ID}/adsets`, {
      campaign_id: campaign.id,
      name: `${campaignName} - Ad Set`,
      daily_budget: String(dailyBudget),
      billing_event: "IMPRESSIONS",
      optimization_goal: "LEAD_GENERATION",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      is_adset_budget_sharing_enabled: "false",
      status: "PAUSED",
      ...(startTime ? { start_time: startTime } : {}),
      targeting: JSON.stringify(targeting),
      promoted_object: JSON.stringify({ page_id: META_PAGE_ID }),
      destination_type: "ON_AD",
    });

    const ads = [];
    for (let index = 0; index < sourceCreatives.length; index += 1) {
      const creative = await create(`${META_AD_ACCOUNT_ID}/adcreatives`, {
        name: `${campaignName} - Creative ${index + 1}`,
        object_story_spec: JSON.stringify(leadCreativeSpec(sourceCreatives[index], formId)),
      });
      const ad = await create(`${adSet.id}/ads`, {
        name: `${campaignName} - Ad ${index + 1}`,
        status: launchStatus,
        creative: JSON.stringify({ creative_id: creative.id }),
      });
      ads.push({ id: ad.id, creative_id: creative.id });
    }

    await update(campaign.id, { status: "ACTIVE" });
    await update(adSet.id, { status: "ACTIVE" });
    for (const ad of ads) await update(ad.id, { status: "ACTIVE" });

    return json({
      status: "ACTIVE",
      campaign: { id: campaign.id, name: campaignName, objective: "OUTCOME_LEADS" },
      ad_set: { id: adSet.id, daily_budget: dailyBudget, optimization_goal: "LEAD_GENERATION", form_id: formId },
      ads,
      start_time: startTime || "immediate",
      note: "Existing media and copy were rebuilt as Lead creatives with the Instant Form attached.",
    });
  } catch (error) {
    console.error("Lead campaign creation error:", error);
    return json({ error: "Campaign creation failed", detail: String(error) }, 502);
  }
});
