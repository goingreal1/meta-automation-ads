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

async function createNarrowAdSet(
  parentAdSet: AdSet,
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

    const payload = {
      name: narrowAdsetName,
      optimization_goal: parentAdSet.optimization_goal || 'LINK_CLICKS',
      billing_event: 'IMPRESSIONS',
      daily_budget: parentAdSet.budget_naira * 100, // Convert to kobo
      targeting: targeting,
      status: 'ACTIVE',
      access_token: META_ACCESS_TOKEN,
    };

    // Call Meta API to create ad set
    const res = await fetch(`${META_GRAPH_BASE}/${parentAdSet.meta_raw?.campaign_id || 'act_' + META_AD_ACCOUNT_ID}/adsets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (data.error) {
      console.error(`Error creating ${narrowType} on Meta:`, data.error);
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

    // 1. Fetch the broad ad set
    const { data: broadAdSet, error: adSetError } = await supabase
      .from('ad_sets')
      .select('*')
      .eq('id', adSetId)
      .eq('targeting_type', 'broad')
      .single();

    if (adSetError || !broadAdSet) {
      return new Response(
        JSON.stringify({ error: 'Ad set not found or is not a broad ad set' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

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
      'narrow_v1',
      ruleV1.states || [],
      ruleV1.genders || []
    );

    // 4. Create Narrow V2 on Meta
    const narrowV2Result = await createNarrowAdSet(
      broadAdSet as AdSet,
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
