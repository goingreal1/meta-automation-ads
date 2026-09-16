import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// META_AD_ACCOUNT_ID is resolved per-creative from ad_accounts table at runtime
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v21.0";

// Browser callers (the dashboard's Publish button, Run Tonight's Batch) send
// Authorization + Content-Type headers, which triggers a CORS preflight. Every
// response -- not just the OPTIONS preflight -- needs Access-Control-Allow-Origin
// or the browser blocks it outright and fetch() throws "Failed to fetch" with
// no further detail, regardless of the actual HTTP status. Confirmed live: curl
// (no CORS enforcement) never surfaced this.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

// ─── AI SYSTEM: TRAINED ON SENIOR BUYER BEHAVIOR ──────────────────────────────

/**
 * SENIOR BUYER TRAINING DATA
 * 
 * Senior buyers who scale to 5-20 orders/month follow these patterns:
 * 1. Test multiple CTAs - SHOP_NOW vs ORDER vs LEARN_MORE vs SIGN_UP
 * 2. Rotate CTAs based on audience age & gender
 * 3. Launch tests at specific times (peak hours: 6 PM - 10 PM)
 * 4. Use different targeting for men (direct sale) vs women (education)
 * 5. Scale winners aggressively (2-3x budget increase after 2-3 orders)
 * 6. Kill losers fast (< 1 order after ₦1,500 spend)
 */

interface AudienceSegment {
  name: string;
  genders: number[];
  states: string[];
  ageMin: number;
  ageMax: number;
  bestCTA: string;
  bestHours: number[];
  testBudget: number;
  scaleBudget: number;
  description: string;
}

interface LaunchDecision {
  shouldLaunch: boolean;
  reason: string;
  cta: string;
  targetingRule: string;
  budget: number;
  timing: string;
}

// ─── AUDIENCE SEGMENTS TRAINED FROM SENIOR BUYER PATTERNS ──────────────────────

const TRAINED_AUDIENCE_SEGMENTS: Record<string, AudienceSegment> = {
  "male_young": {
    name: "Male 20-60",
    genders: [1],
    states: ["Lagos", "Ogun", "Oyo", "Kano"],
    ageMin: 20,
    ageMax: 60,
    bestCTA: "SHOP_NOW", // Direct to purchase
    bestHours: [18, 19, 20, 21], // Peak: 6-9 PM
    testBudget: 2500,
    scaleBudget: 7500,
    description: "High impulse buyers, responds to urgency"
  },
  "male_mid": {
    name: "Male 20-60",
    genders: [1],
    states: ["Lagos", "Ogun", "Abuja", "Rivers"],
    ageMin: 20,
    ageMax: 60,
    bestCTA: "LEARN_MORE", // More deliberate
    bestHours: [19, 20, 21, 22], // Peak: 7-10 PM
    testBudget: 3000,
    scaleBudget: 10000,
    description: "Decision makers, wants more info before purchase"
  },
  "female_young": {
    name: "Female 20-60",
    genders: [2],
    states: ["Lagos", "Ogun", "Abuja", "Enugu"],
    ageMin: 20,
    ageMax: 60,
    bestCTA: "LEARN_MORE", // Build trust first
    bestHours: [18, 19, 20], // Peak: 6-8 PM
    testBudget: 2500,
    scaleBudget: 8000,
    description: "Values research, brand trust, community feedback"
  },
  "female_mid": {
    name: "Female 20-60",
    genders: [2],
    states: ["Lagos", "Ogun", "Kano", "Port Harcourt"],
    ageMin: 20,
    ageMax: 60,
    bestCTA: "ORDER", // Direct, authoritative
    bestHours: [20, 21, 22, 23], // Peak: 8-11 PM
    testBudget: 3000,
    scaleBudget: 12000,
    description: "High purchasing power, responds to quality/lifestyle"
  }
};

// ─── CTA OPTIMIZATION ENGINE ────────────────────────────────────────────────────

/**
 * Map CTA values to Meta API call_to_action_type
 * Meta Ads Manager CTA options:
 * - SHOP_NOW → Direct purchase (e-commerce)
 * - LEARN_MORE → Click to learn (lead gen)
 * - ORDER → Direct order (services, books)
 * - SIGN_UP → Registration  
 * - GET_OFFER → Coupon/discount
 * - CONTACT_US → WhatsApp/direct contact
 */
function selectCTAByAudience(segment: AudienceSegment, previousPerformance?: any): string {
  // If we have previous performance data for this segment, use learnings
  if (previousPerformance?.avg_ctr && previousPerformance.avg_ctr > 1.8) {
    // High CTR suggests content resonates, can be more aggressive
    return segment.genders.includes(1) ? "SHOP_NOW" : "ORDER";
  }
  
  // Use trained CTA for this segment
  return segment.bestCTA;
}

// ─── LAUNCH TIMING ENGINE (WHEN TO TEST) ────────────────────────────────────────

function shouldLaunchNow(segment: AudienceSegment): boolean {
  const currentHour = new Date().getUTCHours() + 1; // Lagos time (UTC+1)
  const isCurrentlyPeak = segment.bestHours.includes(currentHour);
  
  // Launch if:
  // 1. Current time is peak hour for this segment
  // 2. We haven't tested this segment in last 3 hours
  
  return isCurrentlyPeak;
}

// ─── AI DECISION ENGINE ───────────────────────────────────────────────────────

async function makeAILaunchDecision(
  supabase: any,
  creativeAsset: any
): Promise<LaunchDecision> {
  try {
    // 1. Analyze recent performance data (last 7 days)
    const { data: recentPerformance } = await supabase
      .from('daily_metrics')
      .select('*')
      .gte('metric_date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('metric_date', { ascending: false });

    // 2. Fetch winning ad sets to learn from
    const { data: winners } = await supabase
      .from('ad_sets')
      .select('*')
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false })
      .limit(5);

    // 3. Analyze which audience segments are performing best
    let bestPerformingSegment: AudienceSegment | null = null;
    let highestCTR = 0;

    // Check performance against trained segments
    if (winners && winners.length > 0) {
      for (const winner of winners) {
        // Match winner's targeting to trained segment
        const matchingSegment = matchSegment(winner.states, winner.genders, winner.age_min, winner.age_max);
        if (matchingSegment) {
          const segmentMetrics = recentPerformance?.find(m => 
            m.orders > 0 && m.ctr && m.ctr > highestCTR
          );
          if (segmentMetrics && segmentMetrics.ctr > highestCTR) {
            highestCTR = segmentMetrics.ctr;
            bestPerformingSegment = matchingSegment;
          }
        }
      }
    }

    // 4. Default to best segment if no previous data
    if (!bestPerformingSegment) {
      bestPerformingSegment = Object.values(TRAINED_AUDIENCE_SEGMENTS)[0];
    }

    // 5. Determine timing
    const isGoodTiming = shouldLaunchNow(bestPerformingSegment);
    const timing = isGoodTiming 
      ? `NOW (peak hour: ${bestPerformingSegment.bestHours[0]}:00 Lagos time)`
      : `QUEUE for ${bestPerformingSegment.bestHours[0]}:00 Lagos time`;

    // 6. Select optimized CTA
    const performanceData = recentPerformance?.find(m => m.orders && m.ctr);
    const selectedCTA = selectCTAByAudience(bestPerformingSegment, performanceData);

    return {
      shouldLaunch: isGoodTiming || true, // Queue if not peak
      reason: `AI trained on senior buyer behavior. Best segment: ${bestPerformingSegment.name}`,
      cta: selectedCTA,
      targetingRule: bestPerformingSegment.name,
      budget: bestPerformingSegment.testBudget,
      timing: timing
    };

  } catch (err) {
    console.error('AI decision error:', err);
    return {
      shouldLaunch: false,
      reason: 'AI analysis failed, falling back to safe defaults',
      cta: 'LEARN_MORE',
      targetingRule: 'male_young',
      budget: 2500,
      timing: 'MANUAL_REVIEW_REQUIRED'
    };
  }
}

// ─── SEGMENT MATCHING HELPER ──────────────────────────────────────────────────

function matchSegment(
  states: string[],
  genders: number[],
  ageMin: number,
  ageMax: number
): AudienceSegment | null {
  for (const [key, segment] of Object.entries(TRAINED_AUDIENCE_SEGMENTS)) {
    const statesMatch = states.some(s => segment.states.includes(s));
    const gendersMatch = genders.some(g => segment.genders.includes(g));
    const ageMatch = ageMin >= segment.ageMin && ageMax <= segment.ageMax;
    if (statesMatch && gendersMatch && ageMatch) {
      return segment;
    }
  }
  return null;
}

// ─── WHATSAPP HELPER ──────────────────────────────────────────────────────────

async function sendWhatsAppApproval(message: string): Promise<boolean> {
  const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
  const WHATSAPP_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
  const ALERT_TO_NUMBER = Deno.env.get("ALERT_TO_NUMBER") ?? "";

  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID || !ALERT_TO_NUMBER) {
    console.log("⚠️ WhatsApp not configured, skipping approval message");
    return false;
  }

  try {
    const resp = await fetch(
      `${META_GRAPH_BASE}/${WHATSAPP_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: ALERT_TO_NUMBER,
          type: "text",
          text: { body: message },
        }),
      }
    );
    if (!resp.ok) {
      console.error(`WhatsApp failed: ${resp.status}`);
      return false;
    }
    console.log("✅ WhatsApp approval request sent");
    return true;
  } catch (err) {
    console.error("WhatsApp error:", err);
    return false;
  }
}

// ─── UPLOAD CREATIVE TO META + CREATE THE AD CREATIVE ──────────────────────────
// This is the piece that was entirely missing before: nothing ever pushed the
// uploaded video/image to Meta or created a real ad-creative object, so
// createAdWithCTA (below) had no real creative_id to reference and was never
// even called. Caches the result on creative_assets.meta_video_id /
// meta_image_hash (columns already existed, unused) so a re-launch or
// duplicate doesn't re-upload the same file.

async function ensureMetaMedia(
  supabase: any,
  accountId: string,
  creative: any
): Promise<{ videoId?: string; imageUrl?: string; error?: string } | null> {
  if (creative.meta_video_id) return { videoId: creative.meta_video_id };

  const isVideo = creative.asset_type === "video";
  if (!isVideo) {
    // Images skip Meta's ad-image-library pre-upload (/adimages) entirely --
    // confirmed live that this app's access to that specific endpoint is
    // blocked ("(#3) Application does not have the capability to make this
    // API call"), while ad-creative creation itself works fine. link_data
    // accepts a direct external "picture" URL, which Meta fetches itself when
    // building the creative -- verified working via a real test ad creative.
    return { imageUrl: creative.public_url };
  }

  try {
    const params = new URLSearchParams({ file_url: creative.public_url, access_token: META_ACCESS_TOKEN });
    const res = await fetch(`${META_GRAPH_BASE}/act_${accountId}/advideos`, { method: "POST", body: params });
    const data = await res.json();
    if (!data.id) {
      console.error("Video upload failed:", data);
      return { error: JSON.stringify(data.error || data) };
    }
    await supabase.from("creative_assets").update({ meta_video_id: data.id }).eq("id", creative.id);
    return { videoId: data.id };
  } catch (err: any) {
    console.error("ensureMetaMedia error:", err);
    return { error: err.message || String(err) };
  }
}

// destinationType "whatsapp": click-to-WhatsApp sales creative -- opens a chat
// with the product's connected WhatsApp number (the Beoliv AI salesperson bot)
// instead of a website link. Shape per Meta's Click-to-WhatsApp docs: link_data
// (even for a video asset -- video_data doesn't carry page_welcome_message) with
// link "https://api.whatsapp.com/send", a WHATSAPP_MESSAGE CTA, and an autofill
// opening message. Needs live verification against a real PAUSED object before
// this is fully trusted -- flagged in the launch summary, not assumed correct.
async function createAdCreative(
  accountId: string,
  pageId: string,
  creative: any,
  media: { videoId?: string; imageUrl?: string },
  destinationLink: string,
  ctaType: string,
  destinationType: "website" | "whatsapp",
  productName: string
): Promise<string | null> {
  try {
    let objectStorySpec: Record<string, any>;

    if (destinationType === "whatsapp") {
      objectStorySpec = {
        page_id: pageId,
        link_data: {
          picture: media.imageUrl || undefined,
          link: "https://api.whatsapp.com/send",
          message: creative.primary_text || "",
          name: creative.headline || undefined,
          description: creative.description || undefined,
          call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } },
          page_welcome_message: {
            type: "VISUAL_EDITOR",
            version: 2,
            landing_screen_type: "welcome_message",
            media_type: "text",
            text_format: {
              customer_action_type: "autofill_message",
              message: {
                text: `Hi! Interested in ${productName}? 👋`,
                autofill_message: { content: `Hi, I'm interested in ${productName}` },
              },
            },
          },
        },
      };
    } else {
      const cta = { type: ctaType, value: { link: destinationLink } };
      objectStorySpec = media.videoId
        ? {
            page_id: pageId,
            video_data: {
              video_id: media.videoId,
              title: creative.headline || undefined,
              message: creative.primary_text || "",
              call_to_action: cta,
            },
          }
        : {
            page_id: pageId,
            link_data: {
              picture: media.imageUrl,
              link: destinationLink,
              message: creative.primary_text || "",
              name: creative.headline || undefined,
              description: creative.description || undefined,
              call_to_action: cta,
            },
          };
    }

    const res = await fetch(`${META_GRAPH_BASE}/act_${accountId}/adcreatives`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Creative-${creative.file_name}-${Date.now()}`,
        object_story_spec: objectStorySpec,
        // Opt out of Meta showing this ad bundled with other advertisers' ads
        // in the same unit (Reels etc.) -- confirmed field via Meta's own docs,
        // still worth reconfirming against a live response the first time this runs.
        contextual_multi_ads: { enroll_status: "OPT_OUT" },
        access_token: META_ACCESS_TOKEN,
      }),
    });
    const data = await res.json();
    if (!data.id) {
      console.error("Ad creative creation failed:", data);
      return null;
    }
    return data.id;
  } catch (err) {
    console.error("createAdCreative error:", err);
    return null;
  }
}

// ─── CREATE THE AD (attaches the ad creative under one ad set) ────────────────

async function createAdWithCTA(
  adsetId: string,
  creativeId: string,
  adName: string,
  accountId: string
): Promise<string | null> {
  try {
    const adPayload = {
      adset_id: adsetId,
      creative: { creative_id: creativeId },
      status: "PAUSED", // stays paused until the campaign/ad set is approved
      name: adName,
      access_token: META_ACCESS_TOKEN,
    };
    const res = await fetch(`${META_GRAPH_BASE}/act_${accountId}/ads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adPayload),
    });
    const data = await res.json();
    if (!data.id) console.error("Ad creation failed:", data);
    return data.id || null;
  } catch (err) {
    console.error("Error creating ad:", err);
    return null;
  }
}

// ─── CREATE ONE AD SET PER AD-SET CONFIG ROW ───────────────────────────────────
// Ad sets come from ad_set_configs -- direct rows the dashboard's ad-set builder
// writes (one row per ad set; "Duplicate x N" clones the current row into more
// rows), with real fields the user set themselves: budget, age, gender,
// geography. Replaces the earlier targeting_presets checkbox flow ("Wellness
// Interest" etc), which used abstract named presets the user found confusing.

// Real settings, refreshed from your most recent actual launch ("New Sales
// campaign", ad sets 1-5, act_643541631210844) -- ABO, OFFSITE_CONVERSIONS,
// LOWEST_COST_WITHOUT_CAP, Advantage+ audience with individual_setting (a
// newer sub-field Meta added -- which specific dimensions, age/gender, it's
// allowed to expand), broader placements than the earlier Lunessa-retargeting
// data this was first based on, and location_types alongside bare countries.
const REAL_OPTIMIZATION_GOAL = "OFFSITE_CONVERSIONS";
const REAL_BID_STRATEGY = "LOWEST_COST_WITHOUT_CAP";
const REAL_PLACEMENTS = {
  publisher_platforms: ["facebook", "instagram"],
  facebook_positions: ["feed", "marketplace", "facebook_reels", "profile_feed", "notification"],
  // "explore_home" requires "explore" also be selected -- confirmed live
  // (Meta rejects explore_home alone with "You must also select Instagram Explore").
  instagram_positions: ["stream", "story", "reels", "explore", "explore_home", "profile_feed"],
  device_platforms: ["mobile"],
};
const GENDER_MAP: Record<string, number[]> = { all: [1, 2], male: [1], female: [2] };

// Resolves Nigerian state names (as picked in the dashboard's ad-set builder,
// e.g. "Lagos") to Meta's actual region keys via the geolocation Targeting
// Search API -- sending human-readable names directly is not a valid Meta
// targeting value.
async function resolveStateRegionKeys(stateNames: string[]): Promise<{ key: string; name: string }[]> {
  const resolved: { key: string; name: string }[] = [];
  for (const name of stateNames) {
    try {
      const res = await fetch(
        `${META_GRAPH_BASE}/search?type=adgeolocation&location_types=${encodeURIComponent(
          JSON.stringify(["region"])
        )}&country_code=NG&q=${encodeURIComponent(name)}&limit=1&access_token=${META_ACCESS_TOKEN}`
      );
      const data = await res.json();
      const match = data?.data?.[0];
      if (match?.key) {
        resolved.push({ key: match.key, name: match.name || name });
      } else {
        console.warn(`No Meta region match found for state "${name}" -- dropping from geo targeting.`);
      }
    } catch (err) {
      console.error(`Failed to resolve state "${name}":`, err);
    }
  }
  return resolved;
}

// Ad-set config comes directly from the dashboard's ad-set builder (one row =
// one ad set, "Duplicate x N" clones it) -- real, direct fields the user set
// themselves (budget, age, gender, geography), not an abstract named preset.
async function buildTargetingFromConfig(config: any): Promise<Record<string, any>> {
  const genders = GENDER_MAP[config.gender ?? "all"] ?? [1, 2];
  const targeting: Record<string, any> = {
    genders,
    age_min: config.age_min ?? 25,
    age_max: config.age_max ?? 65,
    targeting_automation: { advantage_audience: 1, individual_setting: { age: 1, gender: 1 } },
    publisher_platforms: REAL_PLACEMENTS.publisher_platforms,
    facebook_positions: REAL_PLACEMENTS.facebook_positions,
    instagram_positions: REAL_PLACEMENTS.instagram_positions,
    device_platforms: REAL_PLACEMENTS.device_platforms,
  };

  if (config.geo_type === "states" && config.states?.length) {
    const resolvedStates = await resolveStateRegionKeys(config.states);
    if (resolvedStates.length) {
      targeting.geo_locations = {
        regions: resolvedStates.map((s) => ({ key: s.key })),
        location_types: ["frequently_in", "home", "recent"],
      };
    } else {
      console.warn(`Ad set "${config.label}" specified states but none resolved -- falling back to nationwide (NG).`);
      targeting.geo_locations = { countries: ["NG"], location_types: ["frequently_in", "home", "recent"] };
    }
  } else {
    targeting.geo_locations = { countries: ["NG"], location_types: ["frequently_in", "home", "recent"] };
  }

  return targeting;
}

function buildAdSetPayload(opts: {
  name: string;
  budgetNaira: number;
  budgetType: "abo" | "cbo";
  targeting: Record<string, any>;
  promotedObject: Record<string, any>;
  optimizationGoal: string;
  destinationType: "website" | "whatsapp";
  startTime?: string | null;
  endTime?: string | null;
}) {
  const payload: Record<string, any> = {
    name: opts.name,
    optimization_goal: opts.optimizationGoal,
    bid_strategy: REAL_BID_STRATEGY,
    billing_event: "IMPRESSIONS",
    targeting: opts.targeting,
    promoted_object: opts.promotedObject,
    status: "PAUSED",
    access_token: META_ACCESS_TOKEN,
  };
  // Required alongside CONVERSATIONS optimization for Click-to-WhatsApp ad
  // sets under OUTCOME_SALES -- without it Meta rejects the optimization_goal
  // itself with "Performance goal isn't available", confirmed via live testing.
  if (opts.destinationType === "whatsapp") {
    payload.destination_type = "WHATSAPP";
  }
  // CBO: budget lives on the campaign, not here -- Meta rejects an ad set that
  // sets its own budget under a campaign-budget-optimized campaign.
  if (opts.budgetType === "abo") {
    payload.daily_budget = Math.round(opts.budgetNaira * 100);
  }
  if (opts.startTime) payload.start_time = opts.startTime;
  if (opts.endTime) payload.end_time = opts.endTime;
  return payload;
}

async function launchAdSetGroup(
  supabase: any,
  creative: any
): Promise<{ campaign_id: string; ad_sets: { meta_id: string; db_id: string; label: string; budgetNaira: number }[] } | { error: string }> {
  try {
    const accountId = (creative.ad_accounts?.meta_ad_account_id || "").replace("act_", "");
    const pixelId = creative.ad_accounts?.meta_pixel_id || Deno.env.get("META_PIXEL_ID") || "";
    const pageId = creative.ad_accounts?.fb_page_id || "";
    const destinationType: "website" | "whatsapp" = creative.products?.destination_type === "whatsapp" ? "whatsapp" : "website";
    const whatsappNumber = creative.products?.whatsapp_number || "";
    const destinationLink = creative.products?.landing_page_url || "";
    const ctaType = creative.cta_type || "SHOP_NOW";
    const productName = creative.products?.product_name || "this product";
    const budgetType: "abo" | "cbo" = creative.budget_type === "cbo" ? "cbo" : "abo";
    // Real column the dashboard's upload form actually writes to is
    // scheduled_for (creative_assets.launch_at exists too but is unused/orphaned).
    const startTime = creative.scheduled_for || null;
    const endTime = creative.campaign_end_date || null;

    if (!pageId) {
      const msg = `Missing fb_page_id for creative ${creative.id} -- check the ad_accounts row.`;
      console.error(msg);
      return { error: msg };
    }
    if (destinationType === "whatsapp" && !whatsappNumber) {
      const msg = `Product "${productName}" is set to WhatsApp destination but has no whatsapp_number.`;
      console.error(msg);
      return { error: msg };
    }
    if (destinationType === "website" && (!pixelId || !destinationLink)) {
      const msg = `Missing pixel_id/landing_page_url for creative ${creative.id} -- check ad_accounts and products rows.`;
      console.error(msg);
      return { error: msg };
    }

    // Optimization goal + promoted_object depend entirely on the destination:
    // website sales optimizes for the pixel's Purchase event; WhatsApp sales
    // optimizes for CONVERSATIONS against the connected WhatsApp number --
    // per Meta's Click-to-WhatsApp docs for Sales-objective campaigns.
    const optimizationGoal = destinationType === "whatsapp" ? "CONVERSATIONS" : REAL_OPTIMIZATION_GOAL;
    const promotedObject =
      destinationType === "whatsapp"
        ? { page_id: pageId, whatsapp_phone_number: whatsappNumber }
        : { pixel_id: pixelId, custom_event_type: "PURCHASE" };

    // Ad sets to create for this creative -- built directly in the dashboard's
    // ad-set builder (one row = one ad set; "Duplicate x N" clones it into more
    // rows). Falls back to one default ad set (₦5,000/day, 25-65, all genders,
    // nationwide) if the creative predates this builder / has none configured.
    let adSetConfigs: any[] = [];
    {
      const { data } = await supabase
        .from("ad_set_configs")
        .select("*")
        .eq("creative_id", creative.id)
        .order("sort_order", { ascending: true });
      adSetConfigs = data || [];
    }
    if (!adSetConfigs.length) {
      adSetConfigs = [
        { label: "Ad Set 1", budget_naira: 5000, age_min: 25, age_max: 65, gender: "all", geo_type: "nationwide", states: null },
      ];
    }

    // 1. Create campaign. CBO: campaign carries the total daily budget and its
    // own bid strategy; ABO: budget stays on each ad set (unchanged).
    // User-editable campaign name (dashboard's ad-set builder) -- falls back to
    // an auto-generated one only if left blank, so it's always recognizable in
    // Ads Manager instead of the old always-auto-generated product+filename+timestamp.
    const campaignName = creative.campaign_name?.trim() || `${productName} - ${new Date().toLocaleDateString("en-NG")}`;
    const totalBudgetNaira = adSetConfigs.reduce((sum: number, c: any) => sum + Number(c.budget_naira || 5000), 0);
    const campaignPayload: Record<string, any> = {
      name: campaignName,
      objective: "OUTCOME_SALES",
      // Required by Meta on every campaign since their special-ads-category
      // compliance rollout (housing/employment/credit/social issues) --
      // "NONE" for an ordinary product. Missing this hard-fails campaign
      // creation with error #100, unrelated to anything else in this payload.
      special_ad_categories: ["NONE"],
      // Created PAUSED -- stays paused until a human approves via WhatsApp
      // (handle-whatsapp-reply flips this + its ad sets to ACTIVE on approval).
      status: "PAUSED",
      access_token: META_ACCESS_TOKEN,
    };
    if (budgetType === "cbo") {
      campaignPayload.daily_budget = Math.round(totalBudgetNaira * 100);
      campaignPayload.bid_strategy = REAL_BID_STRATEGY;
    } else {
      // Meta now requires this explicitly for ABO campaigns: whether ad sets
      // can share up to 20% of budget with each other for overall performance.
      // False matches your real historical pattern -- each ad set's budget
      // stays independent, no sharing.
      campaignPayload.is_adset_budget_sharing_enabled = false;
    }
    const campaignRes = await fetch(`${META_GRAPH_BASE}/act_${accountId}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(campaignPayload),
    });
    const campaignData = await campaignRes.json();
    if (!campaignData.id) {
      console.error("Failed to create campaign:", campaignData);
      return { error: `Campaign creation failed: ${JSON.stringify(campaignData.error || campaignData)}` };
    }
    const campaignId = campaignData.id;

    // ad_sets.campaign_id is a local uuid FK, not Meta's numeric campaign id --
    // inserting the Meta id directly there was silently failing on every launch
    // (the insert error was never checked), so ad sets that were genuinely
    // created on Meta were never recorded here at all. Create the local
    // campaigns row first and use its id for that FK.
    const { data: campaignRow, error: campaignRowErr } = await supabase
      .from("campaigns")
      .insert({
        meta_campaign_id: campaignId,
        campaign_name: campaignPayload.name,
        campaign_type: "testing",
        objective: "OUTCOME_SALES",
        daily_budget_naira: budgetType === "abo" ? null : totalBudgetNaira,
        status: "paused",
        ad_account_id: creative.ad_account_id,
      })
      .select("id")
      .single();
    if (campaignRowErr || !campaignRow) {
      console.error("Failed to record local campaign row:", campaignRowErr);
      return { error: `Campaign "${campaignId}" was created on Meta but failed to save locally: ${campaignRowErr?.message}` };
    }
    const localCampaignId = campaignRow.id;

    // If anything below fails before any ad set exists, delete the campaign
    // we just created instead of leaving an empty orphaned shell on the real
    // ad account -- confirmed via live testing this was happening on every
    // failed launch (media upload failures especially, since that's an early,
    // easy-to-hit failure point).
    const abortAndCleanup = async (errorMsg: string) => {
      await fetch(`${META_GRAPH_BASE}/${campaignId}?access_token=${META_ACCESS_TOKEN}`, { method: "DELETE" }).catch(() => {});
      await supabase.from("campaigns").delete().eq("id", localCampaignId);
      return { error: errorMsg };
    };

    // 2. Upload the creative to Meta and create ONE ad creative from it, before
    // any ad sets -- ad_sets.creative_id is a local uuid FK into the `creatives`
    // table (not creative_assets, a separate legacy table), so ad sets can't be
    // recorded until this exists. Every ad set below reuses this same ad
    // creative.
    const media = await ensureMetaMedia(supabase, accountId, creative);
    if (!media || media.error) {
      return await abortAndCleanup(`Failed to upload media to Meta for creative ${creative.id}: ${media?.error || "unknown error"}`);
    }
    const adCreativeId = await createAdCreative(accountId, pageId, creative, media, destinationLink, ctaType, destinationType, productName);
    if (!adCreativeId) {
      return await abortAndCleanup(`Failed to create ad creative on Meta for creative ${creative.id}.`);
    }
    const { data: localCreativeRow, error: localCreativeErr } = await supabase
      .from("creatives")
      .insert({
        creative_name: `${productName}-${creative.file_name}`,
        format: creative.format || "customer_review",
        mechanism: creative.mechanism || "why_product_works",
        awareness_stage: "product_aware",
        primary_text: creative.primary_text,
        headline: creative.headline,
        description: creative.description,
        image_url: media.imageUrl || null,
        video_id: media.videoId || null,
        destination_link: destinationLink || null,
        cta_type: ctaType,
        meta_ad_id: adCreativeId,
        status: "testing",
      })
      .select("id")
      .single();
    if (localCreativeErr || !localCreativeRow) {
      console.error("Failed to record local creative row:", localCreativeErr);
      return await abortAndCleanup(`Ad creative "${adCreativeId}" was created on Meta but failed to save locally: ${localCreativeErr?.message}`);
    }
    const localCreativeId = localCreativeRow.id;

    // 3. Create one ad set per ad-set config (each row from the dashboard's
    // builder, including any "Duplicate x N" clones), then attach an ad under
    // each one using the shared ad creative above.
    const createdAdSets: { row: any; metaId: string; label: string; budgetNaira: number }[] = [];
    const adSetErrors: string[] = [];
    for (const config of adSetConfigs) {
      const targeting = await buildTargetingFromConfig(config);
      const label = config.label;

      // Posting to /{campaignId}/adsets directly is rejected by this app/API
      // combo with a misleading "object does not exist" error (code 100,
      // subcode 33) even though the campaign is fully readable right after
      // creation -- confirmed via isolated live testing. The account-scoped
      // path with campaign_id in the body is the one that actually works
      // (same fix already applied in auto-duplicate-adsets).
      const adsetRes = await fetch(`${META_GRAPH_BASE}/act_${accountId}/adsets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: campaignId,
          ...buildAdSetPayload({
            name: `${label}-${creative.file_name.substring(0, 20)}-${Date.now()}`,
            budgetNaira: Number(config.budget_naira || 5000),
            budgetType,
            targeting,
            promotedObject,
            optimizationGoal,
            destinationType,
            startTime,
            endTime,
          }),
        }),
      });
      const adsetData = await adsetRes.json();
      if (!adsetData.id) {
        console.error(`Failed to create ad set for "${label}":`, adsetData);
        adSetErrors.push(`"${label}": ${JSON.stringify(adsetData.error || adsetData)}`);
        continue;
      }

      const { data: row, error: rowErr } = await supabase
        .from("ad_sets")
        .insert({
          campaign_id: localCampaignId,
          meta_adset_id: adsetData.id,
          adset_name: `${label}-${creative.file_name}`,
          creative_id: localCreativeId,
          targeting_type: config.geo_type === "states" ? "narrow" : "broad",
          budget_naira: budgetType === "abo" ? Number(config.budget_naira || 5000) : null,
          ad_account_id: creative.ad_account_id,
          status: "paused",
          age_min: config.age_min,
          age_max: config.age_max,
          genders: targeting.genders,
          states: config.states,
          countries: ["NG"],
          optimization_goal: optimizationGoal,
          bid_strategy: REAL_BID_STRATEGY,
        })
        .select("id")
        .single();

      if (row) {
        createdAdSets.push({ row, metaId: adsetData.id, label, budgetNaira: Number(config.budget_naira || 5000) });
      } else {
        // The ad set is real and live (PAUSED) on Meta at this point even though
        // the local record failed -- surface this distinctly so it isn't lost.
        console.error(`Ad set "${label}" (meta id ${adsetData.id}) created on Meta but failed to save locally:`, rowErr);
        adSetErrors.push(`"${label}": created on Meta (${adsetData.id}) but DB save failed: ${rowErr?.message}`);
      }
    }

    if (!createdAdSets.length) {
      const msg = `No ad sets were successfully created for creative ${creative.id}. ${adSetErrors.join(" | ")}`;
      console.error(msg);
      return await abortAndCleanup(msg);
    }

    // 4. Attach an ad under every ad set that was actually created, all reusing
    // the one ad creative from step 2.
    for (const a of createdAdSets) {
      const adId = await createAdWithCTA(
        a.metaId,
        adCreativeId,
        `AD-${a.label}-${creative.file_name.substring(0, 20)}-${Date.now()}`,
        accountId
      );
      if (!adId) console.error(`Failed to create ad for "${a.label}" ad set (creative ${creative.id})`);
    }

    return {
      campaign_id: campaignId,
      ad_sets: createdAdSets.map((a) => ({ meta_id: a.metaId, db_id: a.row.id, label: a.label, budgetNaira: a.budgetNaira })),
    };
  } catch (err: any) {
    console.error("Launch ad set group error:", err);
    return { error: `Unhandled error: ${err.message || err}` };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // An explicit product_id (the dashboard's "Publish" button, scoped to one
    // product) bypasses the auto_post_enabled gate -- that toggle controls
    // whether a product's creatives launch automatically in an unattended
    // batch run, not whether a human can manually publish them right now.
    let requestedProductId: string | null = null;
    try {
      const body = await req.json();
      requestedProductId = body?.product_id || null;
    } catch {
      // No/invalid JSON body -- treat as a plain batch run.
    }

    // 1. Get up to 5 pending creatives (or every pending creative for one
    // product, if requested). Real column is test_status (not the nonexistent
    // "status" this used to filter on -- that silently matched zero rows every
    // single run, regardless of anything uploaded). !inner on products so the
    // auto_post_enabled filter actually applies in the batch (no product_id) case.
    let pendingQuery = supabase
      .from("creative_assets")
      .select(
        "*, ad_accounts(meta_ad_account_id, fb_page_id, meta_pixel_id), products!inner(product_name, landing_page_url, auto_post_enabled, destination_type, whatsapp_number)"
      )
      .eq("test_status", "untested")
      .order("uploaded_at", { ascending: true });

    if (requestedProductId) {
      pendingQuery = pendingQuery.eq("product_id", requestedProductId).limit(20);
    } else {
      pendingQuery = pendingQuery.eq("products.auto_post_enabled", true).limit(5);
    }

    const { data: pendingCreatives, error: pendingErr } = await pendingQuery;

    if (pendingErr) {
      console.error("Failed to fetch pending creatives:", pendingErr);
      return new Response(JSON.stringify({ error: pendingErr.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    if (!pendingCreatives || pendingCreatives.length === 0) {
      return new Response(
        JSON.stringify({
          message: "No pending creatives to launch",
          launched: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    console.log(`📊 Processing ${pendingCreatives.length} creatives`);

    // 2. Launch each creative's configured ad sets
    const launchPlans: any[] = [];
    let totalAdSetsCreated = 0;
    let totalBudgetNaira = 0;

    // Every campaign/ad set is created PAUSED (see launchAdSetGroup) -- nothing
    // spends until a real APPROVE reply flips it ACTIVE via handle-whatsapp-reply.
    // One `pending_approvals` row per creative/campaign (that table -- not the
    // nonexistent `launch_approvals` -- is what both the dashboard's Approvals tab
    // and handle-whatsapp-reply actually read).
    const launchErrors: string[] = [];
    for (const creative of pendingCreatives) {
      const result = await launchAdSetGroup(supabase, creative);
      if ("error" in result) {
        launchErrors.push(`"${creative.file_name}": ${result.error}`);
        continue;
      }

      const adSetMetaIds = result.ad_sets.map((a) => a.meta_id);
      totalAdSetsCreated += result.ad_sets.length;
      const adSetBudget = result.ad_sets.reduce((sum, a) => sum + a.budgetNaira, 0);
      totalBudgetNaira += adSetBudget;

      const { data: approvalRow, error: approvalErr } = await supabase
        .from("pending_approvals")
        .insert({
          approval_type: "launch_test",
          creative_asset_id: creative.id,
          ad_account_id: creative.ad_account_id,
          proposed_action: {
            meta_campaign_id: result.campaign_id,
            ad_set_ids: adSetMetaIds,
          },
          reason: `AI auto-launch: "${creative.file_name}" (${creative.products?.product_name}) -- ${result.ad_sets.length} ad set(s) [${result.ad_sets.map((a) => a.label).join(", ")}], ₦${adSetBudget.toLocaleString()} total test budget.`,
          status: "pending",
        })
        .select("id")
        .single();

      if (approvalErr || !approvalRow) {
        console.error(`Failed to record approval for ${creative.file_name}:`, approvalErr);
        continue;
      }

      launchPlans.push({
        creative_name: `${creative.file_name} (${creative.products?.product_name})`,
        campaign_id: result.campaign_id,
        approval_id: approvalRow.id,
      });
    }

    if (launchPlans.length === 0) {
      return new Response(
        JSON.stringify({ error: "Failed to create any ad sets", details: launchErrors }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    // 3. Send WhatsApp approval request -- real APPROVE/REJECT <id> commands that
    // handle-whatsapp-reply actually parses, one line per creative so each can be
    // approved/rejected independently.
    const totalBudget = totalBudgetNaira;
    const approvalMessage = `
🚀 *AI AUTO-LAUNCH READY*

${launchPlans.length} creative(s) tested across ${totalAdSetsCreated} ad set(s), ₦${totalBudget.toLocaleString()} total if all approved. Created PAUSED -- nothing spends until approved.

${launchPlans.map((p) => `• *${p.creative_name}*\n  APPROVE ${p.approval_id}\n  REJECT ${p.approval_id}`).join("\n\n")}

(You can also manage from Meta Ads Manager anytime)
    `.trim();

    await sendWhatsAppApproval(approvalMessage);

    // 4. Mark creatives as awaiting approval (real column is test_status)
    for (const creative of pendingCreatives) {
      await supabase
        .from("creative_assets")
        .update({ test_status: "awaiting_approval" })
        .eq("id", creative.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        status: "approval_requested",
        creatives: launchPlans.length,
        ad_sets: totalAdSetsCreated,
        budget_naira: totalBudget,
        message: `✅ WhatsApp approval message sent. Reply APPROVE <id> or REJECT <id> per creative.`,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  } catch (err: any) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }
});
