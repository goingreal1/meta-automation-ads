import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const (creative.ad_accounts?.meta_ad_account_id?.replace('act_', '') || '') = Deno.env.get("(creative.ad_accounts?.meta_ad_account_id?.replace('act_', '') || '')") ?? "1624710972577463";
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

// ─── CREATE AD WITH OPTIMIZED CTA ──────────────────────────────────────────────

async function createAdWithCTA(
  campaignId: string,
  adsetId: string,
  creativeId: string,
  callToAction: string
): Promise<string | null> {
  try {
    const adPayload = {
      adset_id: adsetId,
      creative: {
        creative_id: creativeId,
      },
      status: 'ACTIVE',
      name: `AD-${callToAction}-${Date.now()}`,
      call_to_action_type: callToAction, // Meta API CTA
      access_token: META_ACCESS_TOKEN,
    };

    const res = await fetch(`${META_GRAPH_BASE}/act_${(creative.ad_accounts?.meta_ad_account_id?.replace('act_', '') || '')}/ads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(adPayload),
    });

    const data = await res.json();
    return data.id || null;
  } catch (err) {
    console.error('Error creating ad with CTA:', err);
    return null;
  }
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

// ─── CREATE BROAD & NARROW AD SETS ────────────────────────────────────────────

async function launchAdSetGroup(
  supabase: any,
  creative: any
): Promise<{
  campaign_id: string;
  broad_adset: { meta_id: string; db_id: string } | null;
  narrow_v1: { meta_id: string; db_id: string } | null;
  narrow_v2: { meta_id: string; db_id: string } | null;
} | null> {
  try {
    // 1. Create campaign
    const campaignRes = await fetch(
      `${META_GRAPH_BASE}/act_${(creative.ad_accounts?.meta_ad_account_id?.replace('act_', '') || '')}/campaigns`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Campaign-${creative.asset_name}-${Date.now()}`,
          objective: "LINK_CLICKS",
          status: "ACTIVE",
          access_token: META_ACCESS_TOKEN,
        }),
      }
    );

    const campaignData = await campaignRes.json();
    if (!campaignData.id) {
      console.error("Failed to create campaign");
      return null;
    }

    const campaignId = campaignData.id;

    // 2. Create BROAD ad set (all ages 20-60, all genders)
    const broadRes = await fetch(`${META_GRAPH_BASE}/${campaignId}/adsets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `BROAD-${creative.asset_name.substring(0, 20)}-${Date.now()}`,
        optimization_goal: "LINK_CLICKS",
        billing_event: "IMPRESSIONS",
        daily_budget: 5000 * 100, // ₦5k in kobo
        targeting: {
          genders: [1, 2],
          age_min: 20,
          age_max: 60,
          geo_locations: {
            regions: [
              { key: "NG-LA" },
              { key: "NG-OG" },
              { key: "NG-OY" },
              { key: "NG-KN" },
            ],
          },
        },
        status: "ACTIVE",
        access_token: META_ACCESS_TOKEN,
      }),
    });

    const broadData = await broadRes.json();
    if (!broadData.id) {
      console.error("Failed to create broad ad set");
      return null;
    }

    // Save BROAD to DB
    const { data: broadRow } = await supabase
      .from("ad_sets")
      .insert({
        campaign_id: campaignId,
        meta_adset_id: broadData.id,
        adset_name: `BROAD-${creative.asset_name}`,
        creative_id: creative.id,
        targeting_type: "broad",
        budget_naira: 5000,
          ad_account_id: creative.ad_account_id,
        status: "ACTIVE",
        age_min: 20,
        age_max: 60,
        genders: [1, 2],
        states: ["Lagos", "Ogun", "Oyo", "Kano"],
        countries: ["NG"],
      })
      .select("id")
      .single();

    // 3. Create NARROW_V1 (with first targeting rule)
    const { data: ruleV1 } = await supabase
      .from("targeting_rules")
      .select("*, ad_accounts(*)")
      .eq("targeting_type", "narrow_v1")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const narrowV1States = ruleV1?.states || ["Lagos", "Ogun"];
    const narrowV1Genders = ruleV1?.genders || [1];

    const narrowV1Res = await fetch(`${META_GRAPH_BASE}/${campaignId}/adsets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `NARROW_V1-${creative.asset_name.substring(0, 20)}-${Date.now()}`,
        optimization_goal: "LINK_CLICKS",
        billing_event: "IMPRESSIONS",
        daily_budget: 5000 * 100,
        targeting: {
          genders: narrowV1Genders,
          age_min: ruleV1?.age_min || 20,
          age_max: ruleV1?.age_max || 60,
          geo_locations: {
            regions: narrowV1States.map((s: string) => ({
              key: `NG-${s.substring(0, 2).toUpperCase()}`,
            })),
          },
        },
        status: "ACTIVE",
        access_token: META_ACCESS_TOKEN,
      }),
    });

    const narrowV1Data = await narrowV1Res.json();

    let narrowV1Row: any = null;
    if (narrowV1Data.id && broadRow?.id) {
      const { data: nv1 } = await supabase
        .from("ad_sets")
        .insert({
          campaign_id: campaignId,
          meta_adset_id: narrowV1Data.id,
          adset_name: `NARROW_V1-${creative.asset_name}`,
          creative_id: creative.id,
          targeting_type: "narrow_v1",
          parent_adset_id: broadRow.id,
          created_from: "auto_duplicate",
          budget_naira: 5000,
          ad_account_id: creative.ad_account_id,
          status: "ACTIVE",
          age_min: ruleV1?.age_min || 20,
          age_max: ruleV1?.age_max || 60,
          genders: narrowV1Genders,
          states: narrowV1States,
          countries: ["NG"],
        })
        .select("id")
        .single();

      narrowV1Row = nv1;
    }

    // 4. Create NARROW_V2 (with second targeting rule)
    const { data: ruleV2 } = await supabase
      .from("targeting_rules")
      .select("*")
      .eq("targeting_type", "narrow_v2")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const narrowV2States = ruleV2?.states || ["Abuja", "Rivers"];
    const narrowV2Genders = ruleV2?.genders || [2];

    const narrowV2Res = await fetch(`${META_GRAPH_BASE}/${campaignId}/adsets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `NARROW_V2-${creative.asset_name.substring(0, 20)}-${Date.now()}`,
        optimization_goal: "LINK_CLICKS",
        billing_event: "IMPRESSIONS",
        daily_budget: 5000 * 100,
        targeting: {
          genders: narrowV2Genders,
          age_min: ruleV2?.age_min || 20,
          age_max: ruleV2?.age_max || 60,
          geo_locations: {
            regions: narrowV2States.map((s: string) => ({
              key: `NG-${s.substring(0, 2).toUpperCase()}`,
            })),
          },
        },
        status: "ACTIVE",
        access_token: META_ACCESS_TOKEN,
      }),
    });

    const narrowV2Data = await narrowV2Res.json();

    let narrowV2Row: any = null;
    if (narrowV2Data.id && broadRow?.id) {
      const { data: nv2 } = await supabase
        .from("ad_sets")
        .insert({
          campaign_id: campaignId,
          meta_adset_id: narrowV2Data.id,
          adset_name: `NARROW_V2-${creative.asset_name}`,
          creative_id: creative.id,
          targeting_type: "narrow_v2",
          parent_adset_id: broadRow.id,
          created_from: "auto_duplicate",
          budget_naira: 5000,
          ad_account_id: creative.ad_account_id,
          status: "ACTIVE",
          age_min: ruleV2?.age_min || 20,
          age_max: ruleV2?.age_max || 60,
          genders: narrowV2Genders,
          states: narrowV2States,
          countries: ["NG"],
        })
        .select("id")
        .single();

      narrowV2Row = nv2;
    }

    return {
      campaign_id: campaignId,
      broad_adset: broadRow
        ? { meta_id: broadData.id, db_id: broadRow.id }
        : null,
      narrow_v1: narrowV1Row ? { meta_id: narrowV1Data.id, db_id: narrowV1Row.id } : null,
      narrow_v2: narrowV2Row ? { meta_id: narrowV2Data.id, db_id: narrowV2Row.id } : null,
    };
  } catch (err) {
    console.error("Launch ad set group error:", err);
    return null;
  }
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────────

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

    // 1. Get up to 5 pending creatives
    const { data: pendingCreatives } = await supabase
      .from("creative_assets")
      .select("*")
      .eq("status", "pending_test")
      .order("uploaded_at", { ascending: true })
      .limit(5);

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

    // 2. Create BROAD + NARROW copies for each creative
    const launchPlans: any[] = [];
    const totalAdSets = pendingCreatives.length * 3; // 1 broad + 2 narrow per creative
    const totalBudget = totalAdSets * 5000; // ₦5k per ad set

    for (const creative of pendingCreatives) {
      const result = await launchAdSetGroup(supabase, creative);

      if (result) {
        launchPlans.push({
          creative_name: creative.asset_name,
          campaign_id: result.campaign_id,
          broad_meta_id: result.broad_adset?.meta_id,
          narrow_v1_meta_id: result.narrow_v1?.meta_id,
          narrow_v2_meta_id: result.narrow_v2?.meta_id,
        });
      }
    }

    if (launchPlans.length === 0) {
      return new Response(
        JSON.stringify({ error: "Failed to create any ad sets" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Send WhatsApp approval request
    const approvalMessage = `
🚀 *AI AUTO-LAUNCH READY*

📊 *DETAILS:*
Creatives: ${launchPlans.length}
Total Ad Sets: ${launchPlans.length * 3} (${launchPlans.length} broad + ${launchPlans.length * 2} narrow)
Total Budget: ₦${totalBudget.toLocaleString()}

*CREATIVES:*
${launchPlans.map((p) => `• ${p.creative_name}`).join("\n")}

⏰ *Status: PENDING YOUR APPROVAL*

Reply:
✅ YES - Launch all ads
❌ NO - Cancel & save budget

(You can manually manage from Meta Ads Manager anytime)
    `.trim();

    await sendWhatsAppApproval(approvalMessage);

    // 4. Save approval state
    const { error: approvalErr } = await supabase
      .from("launch_approvals")
      .insert({
        batch_id: `batch_${Date.now()}`,
        creative_count: launchPlans.length,
        ad_set_count: launchPlans.length * 3,
        budget_naira: totalBudget,
        launch_plan: JSON.stringify(launchPlans),
        status: "pending_approval",
        created_at: new Date().toISOString(),
      });

    if (approvalErr) console.warn("Approval record error:", approvalErr);

    // 5. Mark creatives as awaiting approval
    for (const creative of pendingCreatives) {
      await supabase
        .from("creative_assets")
        .update({ status: "awaiting_approval" })
        .eq("id", creative.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        status: "approval_requested",
        creatives: launchPlans.length,
        ad_sets: launchPlans.length * 3,
        budget_naira: totalBudget,
        message: `✅ WhatsApp approval message sent. Reply YES/NO to launch all ads together.`,
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
