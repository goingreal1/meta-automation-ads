import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v20.0";
const META_AD_ACCOUNT_ID = "1624710972577463";
const PAGE_ID = "768082869713485";
const PIXEL_ID = "2251041928961730";
const RETARGETING_AUDIENCE_ID = "6986547463881";
const LINK = "https://appi.com.ng/lunessa/lunessa-1";
const CTA = { type: "SHOP_NOW", value: { link: LINK } };
const THUMBNAIL_HASH = "968411dfaa044cb00d0ab53ce0274959";
const EXISTING_VIDEO_ID = "1602879351486002";
const FEMALE_VIDEO_ID = "1050181824529619";
const MALE_VIDEO_ID = "2316101682522184";

const COPIES: Record<string, { title: string; message: string }[]> = {
  female: [
    { title: "Still Not Sure? Watch What Real Customers Are Saying", message: "STILL not sure? Watch what real customers are saying. \ud83d\ude0a\n\nNobody wants to waste money on something that doesn't work \u2014 that's exactly why we let real customers speak for themselves.\n\nLunessa Herbal Capsules have helped people feel lighter, more energized, and finally comfortable after meals. \ud83c\udf3f\n\n\u2705 Free delivery on every order.\n\n\ud83d\udc49 appi.com.ng/lunessa/lunessa-1\n\ud83d\udc47 Tap \"Shop Now\" and see the difference for yourself." },
    { title: "You've Seen Lunessa Before \u2014 Here's Why People Keep Coming Back", message: "YOU'VE seen Lunessa before \u2014 here's why people keep coming back. \ud83d\ude0a\n\nIt's not just us saying it works \u2014 real customers are feeling the difference every day.\n\nLunessa gives your gut the natural support it needs to feel light again. \ud83c\udf3f\n\n\u2705 Free delivery on every order.\n\n\ud83d\udc49 appi.com.ng/lunessa/lunessa-1\n\ud83d\udc47 Tap \"Shop Now\" and join them today." },
    { title: "Real People. Real Results. No Gimmicks", message: "REAL people. REAL results. No gimmicks. \ud83d\ude0a\n\nWatch why so many are switching to Lunessa for natural, lasting relief.\n\nLunessa Herbal Capsules support your gut so you feel like yourself again. \ud83c\udf3f\n\n\u2705 Free delivery on every order.\n\n\ud83d\udc49 appi.com.ng/lunessa/lunessa-1\n\ud83d\udc47 Tap \"Shop Now\" and experience it yourself." },
  ],
  male: [
    { title: "Stop Letting Bloating Slow You Down", message: "STOP letting bloating slow you down. \ud83d\ude29\n\nThat heavy, uncomfortable feeling after eating shouldn't be part of your daily life.\n\nLunessa Herbal Capsules give your gut the natural support it needs to process meals effortlessly. \ud83c\udf3f\n\n\u2705 Free delivery on every order.\n\n\ud83d\udc49 appi.com.ng/lunessa/lunessa-1\n\ud83d\udc47 Tap \"Shop Now\" and feel the difference today." },
    { title: "Your Energy Shouldn't Disappear After Every Meal", message: "YOUR energy shouldn't disappear after every meal. \ud83d\ude29\n\nBloating and sluggishness after eating isn't something you have to live with.\n\nLunessa works with your body to keep things moving naturally. \ud83c\udf3f\n\n\u2705 Free delivery on every order.\n\n\ud83d\udc49 appi.com.ng/lunessa/lunessa-1\n\ud83d\udc47 Tap \"Shop Now\" and take control of your gut health." },
    { title: "Still Dealing With The Same Discomfort After Every Meal?", message: "STILL dealing with the same discomfort after every meal? \ud83d\ude29\n\nIt's time to try something that actually addresses it.\n\nLunessa Herbal Capsules are made for real, natural relief. \ud83c\udf3f\n\n\u2705 Free delivery on every order.\n\n\ud83d\udc49 appi.com.ng/lunessa/lunessa-1\n\ud83d\udc47 Tap \"Shop Now\" and finally feel normal after eating." },
  ],
  all: [
    { title: "Stop Ignoring What Your Body Is Telling You", message: "STOP ignoring what your body is telling you. \ud83d\ude29\n\nThat bloated, heavy feeling after meals isn't something to just push through.\n\nLunessa Herbal Capsules give your gut the natural herbal support it needs. \ud83c\udf3f\n\n\u2705 Free delivery on every order.\n\n\ud83d\udc49 appi.com.ng/lunessa/lunessa-1\n\ud83d\udc47 Tap \"Shop Now\" and feel light again." },
    { title: "You Deserve To Feel Comfortable After Every Meal", message: "YOU deserve to feel comfortable after every meal. \ud83d\ude29\n\nBloating and discomfort shouldn't be your normal.\n\nLunessa works naturally with your body to help you feel like yourself again. \ud83c\udf3f\n\n\u2705 Free delivery on every order.\n\n\ud83d\udc49 appi.com.ng/lunessa/lunessa-1\n\ud83d\udc47 Tap \"Shop Now\" and start feeling better today." },
    { title: "Nobody Talks About How Much Bloating Affects Your Day", message: "NOBODY talks about how much bloating actually affects your day. \ud83d\ude29\n\nIt drains your energy and your mood more than you realize.\n\nLunessa Herbal Capsules give you the natural support you need. \ud83c\udf3f\n\n\u2705 Free delivery on every order.\n\n\ud83d\udc49 appi.com.ng/lunessa/lunessa-1\n\ud83d\udc47 Tap \"Shop Now\" and discover Lunessa today." },
  ],
};

function baseTargeting(genders?: number[]) {
  const t: Record<string, unknown> = {
    age_min: 25, age_max: 55,
    geo_locations: { countries: ["NG"] },
    custom_audiences: [{ id: RETARGETING_AUDIENCE_ID }],
    device_platforms: ["mobile"],
    publisher_platforms: ["facebook", "instagram"],
    facebook_positions: ["feed"],
    instagram_positions: ["stream", "reels"],
  };
  if (genders) t.genders = genders;
  return t;
}

async function createCampaign(name: string): Promise<{ id?: string; error?: string }> {
  const res = await fetch(`${META_GRAPH_BASE}/act_${META_AD_ACCOUNT_ID}/campaigns`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, objective: "OUTCOME_SALES", special_ad_categories: [], status: "PAUSED", is_adset_budget_sharing_enabled: false, access_token: META_ACCESS_TOKEN }),
  });
  const data = await res.json();
  return data.id ? { id: data.id } : { error: JSON.stringify(data.error ?? data) };
}

async function createAdSet(campaignId: string, name: string, genders?: number[]): Promise<{ id?: string; error?: string }> {
  const res = await fetch(`${META_GRAPH_BASE}/act_${META_AD_ACCOUNT_ID}/adsets`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name, campaign_id: campaignId, daily_budget: 300000,
      billing_event: "IMPRESSIONS", optimization_goal: "OFFSITE_CONVERSIONS",
      promoted_object: { pixel_id: PIXEL_ID, custom_event_type: "PURCHASE" },
      bid_strategy: "LOWEST_COST_WITHOUT_CAP", targeting: baseTargeting(genders), status: "PAUSED", access_token: META_ACCESS_TOKEN,
    }),
  });
  const data = await res.json();
  return data.id ? { id: data.id } : { error: JSON.stringify(data.error ?? data) };
}

async function createCreative(videoId: string, copy: { title: string; message: string }): Promise<{ id?: string; error?: string }> {
  const storySpec = { page_id: PAGE_ID, video_data: { video_id: videoId, title: copy.title, message: copy.message, image_hash: THUMBNAIL_HASH, call_to_action: CTA } };
  const res = await fetch(`${META_GRAPH_BASE}/act_${META_AD_ACCOUNT_ID}/adcreatives`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ object_story_spec: storySpec, access_token: META_ACCESS_TOKEN }),
  });
  const data = await res.json();
  return data.id ? { id: data.id } : { error: JSON.stringify(data.error ?? data) };
}

async function createAd(adsetId: string, creativeId: string, name: string): Promise<{ id?: string; error?: string }> {
  const res = await fetch(`${META_GRAPH_BASE}/act_${META_AD_ACCOUNT_ID}/ads`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, adset_id: adsetId, creative: { creative_id: creativeId }, status: "PAUSED", access_token: META_ACCESS_TOKEN }),
  });
  const data = await res.json();
  return data.id ? { id: data.id } : { error: JSON.stringify(data.error ?? data) };
}

Deno.serve(async (_req: Request) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const results: Record<string, unknown> = {};

  const campaign = await createCampaign("LUNESSA RETARGETING CAMPAIGN");
  results.campaign = campaign;
  if (!campaign.id) return new Response(JSON.stringify(results), { status: 500 });

  const { data: acctRow } = await supabase.from("ad_accounts").select("id").eq("meta_ad_account_id", META_AD_ACCOUNT_ID).maybeSingle();
  const { data: campaignRow } = await supabase.from("campaigns").insert({
    meta_campaign_id: campaign.id, campaign_name: "LUNESSA RETARGETING CAMPAIGN", campaign_type: "testing",
    objective: "conversions", objective_raw: "OUTCOME_SALES", status: "paused", ad_account_id: acctRow?.id,
  }).select().single();

  const adSetPlan = [
    { name: "LUNESSA RETARGETING - Female", genders: [2], videoId: FEMALE_VIDEO_ID, copyKey: "female" },
    { name: "LUNESSA RETARGETING - Male", genders: [1], videoId: MALE_VIDEO_ID, copyKey: "male" },
    { name: "LUNESSA RETARGETING - All Genders", genders: undefined, videoId: EXISTING_VIDEO_ID, copyKey: "all" },
  ];

  const adsetResults = [];
  for (const plan of adSetPlan) {
    const adset = await createAdSet(campaign.id, plan.name, plan.genders);
    if (!adset.id) { adsetResults.push({ name: plan.name, error: adset.error }); continue; }

    const { data: adsetRow } = await supabase.from("ad_sets").insert({
      meta_adset_id: adset.id, campaign_id: campaignRow?.id, ad_account_id: acctRow?.id, adset_name: plan.name,
      targeting_type: "retargeting", budget_naira: 3000, status: "paused", age_min: 25, age_max: 55,
      genders: plan.genders ? (plan.genders[0] === 1 ? ["male"] : ["female"]) : ["all"], countries: ["NG"],
    }).select().single();

    const adResults = [];
    for (let i = 0; i < 3; i++) {
      const creative = await createCreative(plan.videoId, COPIES[plan.copyKey][i]);
      if (!creative.id) { adResults.push({ variant: i + 1, error: creative.error }); continue; }
      const ad = await createAd(adset.id, creative.id, `${plan.name} - v${i + 1}`);
      adResults.push({ variant: i + 1, creative_id: creative.id, ad });
    }

    adsetResults.push({ adset_id: adset.id, adset_db_id: adsetRow?.id, name: plan.name, ads: adResults });
  }
  results.adsets = adsetResults;

  return new Response(JSON.stringify(results, null, 2), { headers: { "Content-Type": "application/json" } });
});
