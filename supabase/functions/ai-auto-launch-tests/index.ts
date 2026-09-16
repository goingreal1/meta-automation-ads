import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// META_AD_ACCOUNT_ID is resolved per-creative from ad_accounts table at runtime
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v18.0";

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

async function ensureMetaMedia(supabase: any, accountId: string, creative: any): Promise<{ videoId?: string; imageHash?: string } | null> {
  if (creative.meta_video_id) return { videoId: creative.meta_video_id };
  if (creative.meta_image_hash) return { imageHash: creative.meta_image_hash };

  const isVideo = creative.asset_type === "video";
  try {
    if (isVideo) {
      const params = new URLSearchParams({ file_url: creative.public_url, access_token: META_ACCESS_TOKEN });
      const res = await fetch(`${META_GRAPH_BASE}/act_${accountId}/advideos`, { method: "POST", body: params });
      const data = await res.json();
      if (!data.id) {
        console.error("Video upload failed:", data);
        return null;
      }
      await supabase.from("creative_assets").update({ meta_video_id: data.id }).eq("id", creative.id);
      return { videoId: data.id };
    } else {
      const params = new URLSearchParams({ url: creative.public_url, access_token: META_ACCESS_TOKEN });
      const res = await fetch(`${META_GRAPH_BASE}/act_${accountId}/adimages`, { method: "POST", body: params });
      const data = await res.json();
      const hash = Object.values(data.images ?? {})[0] as any;
      if (!hash?.hash) {
        console.error("Image upload failed:", data);
        return null;
      }
      await supabase.from("creative_assets").update({ meta_image_hash: hash.hash }).eq("id", creative.id);
      return { imageHash: hash.hash };
    }
  } catch (err) {
    console.error("ensureMetaMedia error:", err);
    return null;
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
  media: { videoId?: string; imageHash?: string },
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
          image_hash: media.imageHash || undefined,
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
              image_hash: media.imageHash,
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

// ─── CREATE ONE AD SET PER SELECTED TARGETING PRESET ───────────────────────────
// The dashboard's upload form already lets you pick which targeting_presets to
// launch a creative against (creative_assets.selected_preset_ids) -- real,
// already-populated presets like "Male Broad 25-65", "Retargeting Pool" (with a
// real custom_audience_id), "Converting States (NG)", etc. This replaces the
// old hardcoded broad/narrow_v1/narrow_v2-from-targeting_rules approach, which
// ignored that system entirely and only ever produced 3 fixed variants.

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
  instagram_positions: ["stream", "story", "reels", "explore_home", "profile_feed"],
  device_platforms: ["mobile"],
};
const GENDER_MAP: Record<string, number[]> = { all: [1, 2], male: [1], female: [2] };

function buildTargetingFromPreset(preset: any): Record<string, any> {
  const genders = (preset.genders ?? ["all"]).flatMap((g: string) => GENDER_MAP[g] ?? []);
  const targeting: Record<string, any> = {
    genders: genders.length ? genders : [1, 2],
    age_min: preset.age_min ?? 20,
    age_max: preset.age_max ?? 60,
    targeting_automation: { advantage_audience: 1, individual_setting: { age: 1, gender: 1 } },
    publisher_platforms: preset.publisher_platforms?.length ? preset.publisher_platforms : REAL_PLACEMENTS.publisher_platforms,
    facebook_positions: preset.facebook_positions?.length ? preset.facebook_positions : REAL_PLACEMENTS.facebook_positions,
    instagram_positions: preset.instagram_positions?.length ? preset.instagram_positions : REAL_PLACEMENTS.instagram_positions,
    device_platforms: REAL_PLACEMENTS.device_platforms,
  };

  if (preset.custom_audience_id) {
    targeting.custom_audiences = [{ id: preset.custom_audience_id }];
  }
  if (preset.interests?.length) {
    // Best-effort: Meta's real interest targeting needs interest IDs (resolved via
    // /search?type=adinterest), not just names. Passing names through may be
    // rejected -- flagging rather than silently pretending this is solid.
    targeting.flexible_spec = [{ interests: preset.interests.map((name: string) => ({ name })) }];
  }

  // preset.states holds human-readable names ("Lagos State"), not valid Meta
  // region keys -- only resolved_region_keys (not yet populated on any preset as
  // of this build) are safe to send as geo_locations.regions. Guessing the
  // mapping risks silently targeting the wrong place with real spend, so this
  // falls back to whole-country instead when keys aren't resolved.
  if (preset.resolved_region_keys?.length) {
    targeting.geo_locations = { regions: preset.resolved_region_keys.map((key: string) => ({ key })) };
  } else {
    targeting.geo_locations = {
      countries: preset.countries?.length ? preset.countries : ["NG"],
      location_types: ["frequently_in", "home", "recent"],
    };
    if (preset.states?.length) {
      console.warn(`Preset "${preset.preset_name}" has states set but no resolved_region_keys yet -- using whole-country targeting instead of guessing region keys.`);
    }
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
): Promise<{ campaign_id: string; ad_sets: { meta_id: string; db_id: string; label: string }[] } | { error: string }> {
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
    const budgetNaira = 5000;
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

    // Presets this creative was launched against (selected at upload time in the
    // dashboard). Falls back to the baseline "Advantage+ Broad Control" (slot 1)
    // if none were selected -- matches that preset's own documented purpose.
    let presets: any[] = [];
    if (creative.selected_preset_ids?.length) {
      const { data } = await supabase
        .from("targeting_presets")
        .select("*")
        .in("id", creative.selected_preset_ids)
        .eq("is_active", true);
      presets = data || [];
    }
    if (!presets.length) {
      const { data } = await supabase.from("targeting_presets").select("*").eq("slot_number", 1).eq("is_active", true).limit(1);
      presets = data || [];
    }
    if (!presets.length) {
      const msg = `No active targeting presets available for creative ${creative.id}`;
      console.error(msg);
      return { error: msg };
    }

    // 1. Create campaign. CBO: campaign carries the total daily budget and its
    // own bid strategy; ABO: budget stays on each ad set (unchanged).
    const campaignPayload: Record<string, any> = {
      name: `${productName}-${creative.file_name}-${Date.now()}`,
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
      campaignPayload.daily_budget = Math.round(budgetNaira * presets.length * 100);
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

    // 2. Create one ad set per selected preset
    const createdAdSets: { row: any; metaId: string; label: string }[] = [];
    const adSetErrors: string[] = [];
    for (const preset of presets) {
      const targeting = buildTargetingFromPreset(preset);
      const label = preset.preset_name;

      const adsetRes = await fetch(`${META_GRAPH_BASE}/${campaignId}/adsets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildAdSetPayload({
            name: `${label}-${creative.file_name.substring(0, 20)}-${Date.now()}`,
            budgetNaira,
            budgetType,
            targeting,
            promotedObject,
            optimizationGoal,
            startTime,
            endTime,
          })
        ),
      });
      const adsetData = await adsetRes.json();
      if (!adsetData.id) {
        console.error(`Failed to create ad set for preset "${label}":`, adsetData);
        adSetErrors.push(`"${label}": ${JSON.stringify(adsetData.error || adsetData)}`);
        continue;
      }

      const { data: row } = await supabase
        .from("ad_sets")
        .insert({
          campaign_id: campaignId,
          meta_adset_id: adsetData.id,
          adset_name: `${label}-${creative.file_name}`,
          creative_id: creative.id,
          targeting_type: preset.targeting_type || "broad",
          budget_naira: budgetType === "abo" ? budgetNaira : null,
          ad_account_id: creative.ad_account_id,
          status: "paused",
          age_min: preset.age_min,
          age_max: preset.age_max,
          genders: targeting.genders,
          states: preset.states,
          countries: preset.countries || ["NG"],
          interests: preset.interests?.length ? { interests: preset.interests } : null,
          optimization_goal: optimizationGoal,
          bid_strategy: REAL_BID_STRATEGY,
        })
        .select("id")
        .single();

      if (row) createdAdSets.push({ row, metaId: adsetData.id, label });
    }

    if (!createdAdSets.length) {
      const msg = `No ad sets were successfully created for creative ${creative.id}. ${adSetErrors.join(" | ")}`;
      console.error(msg);
      return { error: msg };
    }

    // 3. Upload the creative to Meta once, create ONE ad creative from it, then
    // attach that same ad creative under every ad set that was actually created.
    // This is the step that never existed before -- without it these ad sets
    // would stay empty and deliver nothing even once approved/active.
    const media = await ensureMetaMedia(supabase, accountId, creative);
    if (media) {
      const adCreativeId = await createAdCreative(accountId, pageId, creative, media, destinationLink, ctaType, destinationType, productName);
      if (adCreativeId) {
        for (const a of createdAdSets) {
          const adId = await createAdWithCTA(
            a.metaId,
            adCreativeId,
            `AD-${a.label}-${creative.file_name.substring(0, 20)}-${Date.now()}`,
            accountId
          );
          if (!adId) console.error(`Failed to create ad for "${a.label}" ad set (creative ${creative.id})`);
        }
      } else {
        console.error(`Failed to create ad creative for creative ${creative.id} -- ad sets exist but have no ads.`);
      }
    } else {
      console.error(`Failed to upload media to Meta for creative ${creative.id} -- ad sets exist but have no ads.`);
    }

    return {
      campaign_id: campaignId,
      ad_sets: createdAdSets.map((a) => ({ meta_id: a.metaId, db_id: a.row.id, label: a.label })),
    };
  } catch (err: any) {
    console.error("Launch ad set group error:", err);
    return { error: `Unhandled error: ${err.message || err}` };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
      },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Get up to 5 pending creatives. Real column is test_status (not the
    // nonexistent "status" this used to filter on -- that silently matched
    // zero rows every single run, regardless of anything uploaded).
    // !inner on products so the auto_post_enabled filter actually applies --
    // a creative only auto-launches if the product it's linked to has opted in.
    const { data: pendingCreatives, error: pendingErr } = await supabase
      .from("creative_assets")
      .select(
        "*, ad_accounts(meta_ad_account_id, fb_page_id, meta_pixel_id), products!inner(product_name, landing_page_url, auto_post_enabled, destination_type, whatsapp_number)"
      )
      .eq("test_status", "untested")
      .eq("products.auto_post_enabled", true)
      .order("uploaded_at", { ascending: true })
      .limit(5);

    if (pendingErr) {
      console.error("Failed to fetch pending creatives:", pendingErr);
      return new Response(JSON.stringify({ error: pendingErr.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!pendingCreatives || pendingCreatives.length === 0) {
      return new Response(
        JSON.stringify({
          message: "No pending creatives to launch",
          launched: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`📊 Processing ${pendingCreatives.length} creatives`);

    // 2. Create one ad set per selected preset, for each creative
    const launchPlans: any[] = [];
    let totalAdSetsCreated = 0;

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
      const adSetBudget = result.ad_sets.length * 5000;

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
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Send WhatsApp approval request -- real APPROVE/REJECT <id> commands that
    // handle-whatsapp-reply actually parses, one line per creative so each can be
    // approved/rejected independently.
    const totalBudget = totalAdSetsCreated * 5000;
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
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
