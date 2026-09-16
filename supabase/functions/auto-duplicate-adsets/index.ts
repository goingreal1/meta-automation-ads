import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const META_AD_ACCOUNT_ID = Deno.env.get("META_AD_ACCOUNT_ID") ?? "1624710972577463";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v18.0";

interface AdSet {
  id: string;
  meta_adset_id: string;
  campaign_id: string;
  adset_name: string;
  targeting_type: string;
  budget_naira: number;
  age_min: number;
  age_max: number;
  genders: number[];
  states: string[];
  interests: Record<string, any>;
  optimization_goal: string;
  bid_strategy: string;
  meta_raw: Record<string, any>;
}

// Copies every ad (and its existing Meta ad-creative -- no re-upload needed)
// from the parent ad set onto the newly-created one, so a "duplicate" actually
// delivers instead of sitting empty like ad sets created by this function used to.
async function copyAdsToNewAdSet(parentMetaAdsetId: string, newMetaAdsetId: string, accountId: string): Promise<number> {
  let copied = 0;
  try {
    const res = await fetch(
      `${META_GRAPH_BASE}/${parentMetaAdsetId}/ads?fields=name,creative{id}&access_token=${META_ACCESS_TOKEN}`
    );
    const data = await res.json();
    for (const ad of data.data ?? []) {
      if (!ad.creative?.id) continue;
      const adRes = await fetch(`${META_GRAPH_BASE}/act_${accountId}/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adset_id: newMetaAdsetId,
          creative: { creative_id: ad.creative.id },
          status: 'PAUSED',
          name: `${ad.name || 'AD'}-copy-${Date.now()}`,
          access_token: META_ACCESS_TOKEN,
        }),
      });
      const adData = await adRes.json();
      if (adData.id) copied++;
      else console.error('Failed to copy ad:', adData);
    }
  } catch (err) {
    console.error('copyAdsToNewAdSet error:', err);
  }
  return copied;
}

async function createNarrowAdSet(
  parentAdSet: AdSet,
  accountId: string,
  narrowType: 'narrow_v1' | 'narrow_v2',
  narrowStates: string[],
  narrowGenders: number[]
): Promise<{ meta_adset_id: string; adset_name: string } | null> {
  try {
    // Build targeting object for Meta API
    const targeting: Record<string, any> = {
      geo_locations: {
        regions: narrowStates.map((state: string) => ({ key: `NG-${state.substring(0, 2).toUpperCase()}` })),
      },
      genders: narrowGenders,
      age_min: parentAdSet.age_min,
      age_max: parentAdSet.age_max,
    };

    // Add interests if parent has them
    if (parentAdSet.interests && Object.keys(parentAdSet.interests).length > 0) {
      targeting.flexible_spec = parentAdSet.interests;
    }

    const narrowAdsetName = `${parentAdSet.adset_name} - ${narrowType.replace('_', ' ').toUpperCase()}`;

    // Duplicating an already-running ad set is a deliberate, manual action (not
    // unattended automation), so this creates ACTIVE like the original always
    // intended -- unlike the nightly auto-launch pipeline, which stays PAUSED
    // until a human approves via WhatsApp.
    const payload = {
      name: narrowAdsetName,
      campaign_id: parentAdSet.campaign_id, // real Meta campaign id -- required, was missing entirely before
      optimization_goal: parentAdSet.optimization_goal || 'OFFSITE_CONVERSIONS',
      bid_strategy: parentAdSet.bid_strategy || 'LOWEST_COST_WITHOUT_CAP',
      billing_event: 'IMPRESSIONS',
      daily_budget: parentAdSet.budget_naira * 100, // Convert to kobo
      targeting: targeting,
      status: 'ACTIVE',
      access_token: META_ACCESS_TOKEN,
    };

    // Fixed: this used to POST to `{campaign_id}/adsets` (wrong resource, and
    // campaign_id was undefined anyway since meta_raw never held it) -- the
    // correct call is POST act_{account}/adsets with campaign_id in the body.
    const res = await fetch(`${META_GRAPH_BASE}/act_${accountId}/adsets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (data.error || !data.id) {
      console.error(`Error creating ${narrowType} on Meta:`, data.error || data);
      return null;
    }

    return {
      meta_adset_id: data.id,
      adset_name: narrowAdsetName,
    };

  } catch (err) {
    console.error(`Error creating ${narrowType}:`, err);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
      }
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json();

    const adSetId: string = body.ad_set_id;
    const narrowRuleV1Id: string = body.narrow_rule_v1_id;
    const narrowRuleV2Id: string = body.narrow_rule_v2_id;

    if (!adSetId || !narrowRuleV1Id || !narrowRuleV2Id) {
      return new Response(
        JSON.stringify({ error: 'Missing ad_set_id or targeting rule IDs' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 1. Fetch the broad ad set (joined to its ad account for the real Meta
    // account id -- this used to fall back to a single hardcoded account,
    // which was wrong for every account except one).
    const { data: broadAdSet, error: adSetError } = await supabase
      .from('ad_sets')
      .select('*, ad_accounts(meta_ad_account_id)')
      .eq('id', adSetId)
      .eq('targeting_type', 'broad')
      .single();

    if (adSetError || !broadAdSet) {
      return new Response(
        JSON.stringify({ error: 'Ad set not found or is not a broad ad set' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const accountId = ((broadAdSet as any).ad_accounts?.meta_ad_account_id || META_AD_ACCOUNT_ID).replace('act_', '');

    // 2. Fetch narrow targeting rules
    const { data: ruleV1 } = await supabase
      .from('targeting_rules')
      .select('*')
      .eq('id', narrowRuleV1Id)
      .single();

    const { data: ruleV2 } = await supabase
      .from('targeting_rules')
      .select('*')
      .eq('id', narrowRuleV2Id)
      .single();

    if (!ruleV1 || !ruleV2) {
      return new Response(
        JSON.stringify({ error: 'Targeting rules not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. Create Narrow V1 on Meta
    const narrowV1Result = await createNarrowAdSet(
      broadAdSet as AdSet,
      accountId,
      'narrow_v1',
      ruleV1.states || [],
      ruleV1.genders || []
    );

    // 4. Create Narrow V2 on Meta
    const narrowV2Result = await createNarrowAdSet(
      broadAdSet as AdSet,
      accountId,
      'narrow_v2',
      ruleV2.states || [],
      ruleV2.genders || []
    );

    if (!narrowV1Result || !narrowV2Result) {
      return new Response(
        JSON.stringify({ error: 'Failed to create narrow ad sets on Meta' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Copy the parent's existing ad(s)/creative onto each new ad set -- no
    // re-upload needed, this is what makes the duplicate actually deliver.
    const [copiedV1, copiedV2] = await Promise.all([
      copyAdsToNewAdSet(broadAdSet.meta_adset_id, narrowV1Result.meta_adset_id, accountId),
      copyAdsToNewAdSet(broadAdSet.meta_adset_id, narrowV2Result.meta_adset_id, accountId),
    ]);

    // 5. Insert Narrow V1 into database
    const { data: narrowV1Data, error: narrowV1Error } = await supabase
      .from('ad_sets')
      .insert({
        campaign_id: broadAdSet.campaign_id,
        meta_adset_id: narrowV1Result.meta_adset_id,
        adset_name: narrowV1Result.adset_name,
        targeting_type: 'narrow_v1',
        parent_adset_id: adSetId,
        created_from: 'auto_duplicate',
        creative_id: broadAdSet.creative_id,
        budget_naira: broadAdSet.budget_naira,
        age_min: ruleV1.age_min,
        age_max: ruleV1.age_max,
        genders: ruleV1.genders,
        states: ruleV1.states,
        interests: ruleV1.interests,
        optimization_goal: ruleV1.optimization_goal || broadAdSet.optimization_goal,
        bid_strategy: ruleV1.bid_strategy || broadAdSet.bid_strategy,
        status: 'ACTIVE',
        meta_raw: {
          campaign_id: broadAdSet.meta_raw?.campaign_id,
          parent_adset_id: adSetId,
          created_at: new Date().toISOString(),
        },
      })
      .select('id')
      .single();

    // 6. Insert Narrow V2 into database
    const { data: narrowV2Data, error: narrowV2Error } = await supabase
      .from('ad_sets')
      .insert({
        campaign_id: broadAdSet.campaign_id,
        meta_adset_id: narrowV2Result.meta_adset_id,
        adset_name: narrowV2Result.adset_name,
        targeting_type: 'narrow_v2',
        parent_adset_id: adSetId,
        created_from: 'auto_duplicate',
        creative_id: broadAdSet.creative_id,
        budget_naira: broadAdSet.budget_naira,
        age_min: ruleV2.age_min,
        age_max: ruleV2.age_max,
        genders: ruleV2.genders,
        states: ruleV2.states,
        interests: ruleV2.interests,
        optimization_goal: ruleV2.optimization_goal || broadAdSet.optimization_goal,
        bid_strategy: ruleV2.bid_strategy || broadAdSet.bid_strategy,
        status: 'ACTIVE',
        meta_raw: {
          campaign_id: broadAdSet.meta_raw?.campaign_id,
          parent_adset_id: adSetId,
          created_at: new Date().toISOString(),
        },
      })
      .select('id')
      .single();

    if (narrowV1Error || narrowV2Error) {
      console.error('Database errors:', narrowV1Error, narrowV2Error);
      return new Response(
        JSON.stringify({ error: 'Failed to save narrow ad sets to database' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        broad_adset_id: adSetId,
        narrow_v1_id: narrowV1Data?.id,
        narrow_v1_meta_id: narrowV1Result.meta_adset_id,
        narrow_v2_id: narrowV2Data?.id,
        narrow_v2_meta_id: narrowV2Result.meta_adset_id,
        ads_copied: { narrow_v1: copiedV1, narrow_v2: copiedV2 },
        message: 'Successfully created narrow ad set duplicates',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('Unhandled error:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
