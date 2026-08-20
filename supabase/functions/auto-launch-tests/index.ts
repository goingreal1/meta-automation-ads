import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? Deno.env.get("WHATSAPP_TOKEN") ?? "";
const WHATSAPP_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? Deno.env.get("WHATSAPP_PHONE_ID") ?? "";
const ALERT_TO_NUMBER = Deno.env.get("ALERT_TO_NUMBER") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v21.0";
const MAX_CREATIVES_PER_RUN = 3;
const DEFAULT_TEST_BUDGET_NAIRA = 1500; // fallback if system_settings is unreadable

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// targeting_presets.genders is a text array like ["all"] / ["male"] / ["female"] — Meta wants numeric [1,2]
function mapGenders(genders?: string[] | null): number[] | undefined {
  if (!genders || genders.length === 0 || genders.includes("all")) return undefined; // omit = both
  const out: number[] = [];
  if (genders.includes("male")) out.push(1);
  if (genders.includes("female")) out.push(2);
  return out.length ? out : undefined;
}

async function sendWhatsApp(message: string) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID || !ALERT_TO_NUMBER) return;
  try {
    const resp = await fetch(`${META_GRAPH_BASE}/${WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: ALERT_TO_NUMBER, type: "text", text: { body: message } }),
    });
    if (!resp.ok) console.error("WhatsApp send failed:", resp.status, await resp.text());
  } catch (e) {
    console.error("WhatsApp fetch error:", e);
  }
}

// Upload media to Meta exactly once per creative; cache the returned id/hash so reruns reuse it.
async function ensureMetaMedia(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  creative: any,
  metaAdAccountId: string,
): Promise<{ type: "video" | "image"; id: string }> {
  if (creative.asset_type === "video") {
    if (creative.meta_video_id) return { type: "video", id: creative.meta_video_id };

    const fileRes = await fetch(creative.public_url);
    if (!fileRes.ok) throw new Error(`Could not fetch stored video from ${creative.public_url}`);
    const blob = await fileRes.blob();
    const form = new FormData();
    form.append("source", blob, creative.file_name || "video.mp4");
    form.append("access_token", META_ACCESS_TOKEN);

    const res = await fetch(`${META_GRAPH_BASE}/act_${metaAdAccountId}/advideos`, { method: "POST", body: form });
    const data = await res.json();
    if (!data.id) throw new Error(`Video upload failed: ${data.error?.message ?? JSON.stringify(data)}`);

    await supabase.from("creative_assets").update({ meta_video_id: data.id }).eq("id", creative.id);
    return { type: "video", id: data.id };
  }

  if (creative.meta_image_hash) return { type: "image", id: creative.meta_image_hash };

  const fileRes = await fetch(creative.public_url);
  if (!fileRes.ok) throw new Error(`Could not fetch stored image from ${creative.public_url}`);
  const blob = await fileRes.blob();
  const form = new FormData();
  form.append("source", blob, creative.file_name || "image.jpg");
  form.append("access_token", META_ACCESS_TOKEN);

  const res = await fetch(`${META_GRAPH_BASE}/act_${metaAdAccountId}/adimages`, { method: "POST", body: form });
  const data = await res.json();
  const first = data.images ? (Object.values(data.images)[0] as { hash?: string }) : undefined;
  if (!first?.hash) throw new Error(`Image upload failed: ${data.error?.message ?? JSON.stringify(data)}`);

  await supabase.from("creative_assets").update({ meta_image_hash: first.hash }).eq("id", creative.id);
  return { type: "image", id: first.hash };
}

async function createCampaign(metaAdAccountId: string, name: string, pixelId: string | null): Promise<string> {
  const payload: Record<string, unknown> = {
    name,
    objective: "OUTCOME_SALES",
    special_ad_categories: [],
    status: "PAUSED",
    access_token: META_ACCESS_TOKEN,
  };
  const res = await fetch(`${META_GRAPH_BASE}/act_${metaAdAccountId}/campaigns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.id) throw new Error(`Campaign creation failed: ${data.error?.message ?? JSON.stringify(data)}`);
  return data.id;
}

// Meta interest IDs must come from Targeting Search, not free-text names — resolve + cache per run.
const interestCache = new Map<string, { id: string; name: string } | null>();
async function resolveInterest(name: string): Promise<{ id: string; name: string } | null> {
  if (interestCache.has(name)) return interestCache.get(name)!;
  const params = new URLSearchParams({ type: "adinterest", q: name, limit: "1", access_token: META_ACCESS_TOKEN });
  const res = await fetch(`${META_GRAPH_BASE}/search?${params.toString()}`);
  const data = await res.json();
  const hit = data.data?.[0];
  const result = hit ? { id: hit.id, name: hit.name } : null;
  interestCache.set(name, result);
  return result;
}

// deno-lint-ignore no-explicit-any
async function buildTargeting(preset: any): Promise<Record<string, unknown>> {
  const targeting: Record<string, unknown> = {
    geo_locations: { countries: preset.countries?.length ? preset.countries : ["NG"] },
    age_min: preset.age_min ?? 18,
    age_max: preset.age_max ?? 65,
  };
  const genders = mapGenders(preset.genders);
  if (genders) targeting.genders = genders;

  if (preset.states?.length) {
    // NOTE: these must be real Meta region keys resolved via /search?type=adgeolocation,
    // not hand-built strings. No current preset sets `states`, so this path is inert for now —
    // revisit before using a preset with real state targeting.
    (targeting.geo_locations as Record<string, unknown>).regions = preset.states.map((s: string) => ({ key: s }));
  }

  if (preset.targeting_type === "interest" && preset.interests?.length) {
    const resolved: { id: string; name: string }[] = [];
    for (const name of preset.interests as string[]) {
      const hit = await resolveInterest(name);
      if (hit) resolved.push(hit);
      else console.warn(`Could not resolve interest "${name}" via Targeting Search — skipping it`);
    }
    if (resolved.length) targeting.flexible_spec = [{ interests: resolved }];
  }

  if (preset.targeting_type === "retargeting" && preset.custom_audience_id) {
    targeting.custom_audiences = [{ id: preset.custom_audience_id }];
  }

  return targeting;
}

async function createAdSet(
  metaCampaignId: string,
  name: string,
  targeting: Record<string, unknown>,
  budgetNaira: number,
  pixelId: string | null,
): Promise<string> {
  const payload: Record<string, unknown> = {
    name,
    optimization_goal: pixelId ? "OFFSITE_CONVERSIONS" : "LINK_CLICKS",
    billing_event: "IMPRESSIONS",
    daily_budget: Math.round(budgetNaira * 100),
    targeting,
    status: "PAUSED",
    access_token: META_ACCESS_TOKEN,
  };
  if (pixelId) {
    payload.promoted_object = { pixel_id: pixelId, custom_event_type: "PURCHASE" };
  }
  const res = await fetch(`${META_GRAPH_BASE}/${metaCampaignId}/adsets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.id) throw new Error(`Ad set creation failed: ${data.error?.message ?? JSON.stringify(data)}`);
  return data.id;
}

async function createAdCreative(
  metaAdAccountId: string,
  pageId: string,
  media: { type: "video" | "image"; id: string },
  // deno-lint-ignore no-explicit-any
  creative: any,
  landingPageUrl: string,
): Promise<string> {
  const sep = landingPageUrl.includes("?") ? "&" : "?";
  const link = `${landingPageUrl}${sep}utm_source=meta&utm_medium=paid&utm_campaign=${encodeURIComponent(creative.file_name ?? creative.id)}`;
  const cta = { type: creative.cta_type || "SHOP_NOW", value: { link } };

  const storySpec: Record<string, unknown> = { page_id: pageId };
  if (media.type === "video") {
    storySpec.video_data = {
      video_id: media.id,
      message: creative.primary_text ?? "",
      title: creative.headline ?? "",
      link_description: creative.description ?? "",
      call_to_action: cta,
    };
  } else {
    storySpec.link_data = {
      message: creative.primary_text ?? "",
      link,
      image_hash: media.id,
      name: creative.headline ?? "",
      description: creative.description ?? "",
      call_to_action: cta,
    };
  }

  const res = await fetch(`${META_GRAPH_BASE}/act_${metaAdAccountId}/adcreatives`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ object_story_spec: storySpec, access_token: META_ACCESS_TOKEN }),
  });
  const data = await res.json();
  if (!data.id) throw new Error(`Ad creative failed: ${data.error?.message ?? JSON.stringify(data)}`);
  return data.id;
}

async function createAd(metaAdAccountId: string, metaAdsetId: string, metaCreativeId: string, name: string): Promise<string> {
  const res = await fetch(`${META_GRAPH_BASE}/act_${metaAdAccountId}/ads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      adset_id: metaAdsetId,
      creative: { creative_id: metaCreativeId },
      status: "PAUSED",
      access_token: META_ACCESS_TOKEN,
    }),
  });
  const data = await res.json();
  if (!data.id) throw new Error(`Ad creation failed: ${data.error?.message ?? JSON.stringify(data)}`);
  return data.id;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // deno-lint-ignore no-explicit-any
  const summary: any[] = [];

  try {
    let targetAccountId: string | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        targetAccountId = body?.ad_account_id ?? null;
      } catch {
        // no body — that's fine, means "process every active account" (nightly cron path)
      }
    }

    let acctQuery = supabase.from("ad_accounts").select("*").eq("status", "active");
    if (targetAccountId) acctQuery = acctQuery.eq("id", targetAccountId);
    const { data: accounts, error: acctErr } = await acctQuery;

    if (acctErr || !accounts || accounts.length === 0) {
      return json({ message: "No active ad accounts to process.", processed: 0 });
    }

    const { data: presets } = await supabase
      .from("targeting_presets")
      .select("*")
      .eq("is_active", true)
      .order("slot_number");

    const { data: settingsRow } = await supabase.from("system_settings").select("test_budget_per_creative_naira").eq("id", 1).maybeSingle();
    const testBudget = Number(settingsRow?.test_budget_per_creative_naira) || DEFAULT_TEST_BUDGET_NAIRA;

    for (const account of accounts) {
      // deno-lint-ignore no-explicit-any
      const acctSummary: any = { account: account.name, launched: [], errors: [] };

      if (!account.fb_page_id) {
        acctSummary.errors.push("No fb_page_id set on this ad account — cannot create ad creatives without a linked Facebook Page.");
        summary.push(acctSummary);
        continue;
      }

      const metaAdAccountId = String(account.meta_ad_account_id).replace("act_", "");

      const { data: pendingCreatives } = await supabase
        .from("creative_assets")
        .select("*, products(*)")
        .eq("ad_account_id", account.id)
        .eq("test_status", "untested")
        .order("uploaded_at", { ascending: true })
        .limit(MAX_CREATIVES_PER_RUN);

      if (!pendingCreatives || pendingCreatives.length === 0) {
        acctSummary.errors.push("No untested creatives pending.");
        summary.push(acctSummary);
        continue;
      }

      for (const creative of pendingCreatives) {
        try {
          const landingPageUrl = creative.products?.landing_page_url;
          if (!landingPageUrl) {
            acctSummary.errors.push(`Creative "${creative.file_name}" has no linked product with a landing_page_url — skipped.`);
            continue;
          }

          const media = await ensureMetaMedia(supabase, creative, metaAdAccountId);

          const campaignName = `TEST-${new Date().toISOString().slice(0, 10)}-${creative.mechanism ?? "x"}-${creative.format ?? "x"}`.slice(0, 100);
          const metaCampaignId = await createCampaign(metaAdAccountId, campaignName, account.meta_pixel_id);

          const { data: campaignRow } = await supabase
            .from("campaigns")
            .insert({
              meta_campaign_id: metaCampaignId,
              campaign_name: campaignName,
              campaign_type: "testing",
              objective: "conversions",
              objective_raw: "OUTCOME_SALES",
              status: "paused",
              ad_account_id: account.id,
            })
            .select()
            .single();

          // deno-lint-ignore no-explicit-any
          const createdAdSets: any[] = [];

          for (const preset of presets ?? []) {
            if (preset.targeting_type === "retargeting" && !preset.custom_audience_id) {
              continue; // pool not big enough yet — matches the vision doc's intended behavior
            }

            const targeting = await buildTargeting(preset);
            const adsetName = `${preset.preset_name}-${creative.file_name}`.slice(0, 100);

            const metaAdsetId = await createAdSet(metaCampaignId, adsetName, targeting, testBudget, account.meta_pixel_id);
            const metaCreativeId = await createAdCreative(metaAdAccountId, account.fb_page_id, media, creative, landingPageUrl);
            const metaAdId = await createAd(metaAdAccountId, metaAdsetId, metaCreativeId, `AD-${adsetName}`);

            const { data: adsetRow } = await supabase
              .from("ad_sets")
              .insert({
                meta_adset_id: metaAdsetId,
                campaign_id: campaignRow?.id,
                creative_id: creative.id,
                adset_name: adsetName,
                targeting_type: preset.targeting_type,
                budget_naira: testBudget,
                status: "paused",
                age_min: preset.age_min,
                age_max: preset.age_max,
                genders: preset.genders,
                states: preset.states,
                countries: preset.countries,
                ad_account_id: account.id,
                meta_raw: { meta_creative_id: metaCreativeId, meta_ad_id: metaAdId },
              })
              .select()
              .single();

            createdAdSets.push({ preset: preset.preset_name, meta_adset_id: metaAdsetId, db_id: adsetRow?.id });
          }

          if (createdAdSets.length === 0) {
            acctSummary.errors.push(`Creative "${creative.file_name}": no ad sets were created — check targeting_presets (all inactive, or only retargeting with no custom_audience_id yet).`);
            continue;
          }

          await supabase.from("creative_assets").update({ test_status: "pending_approval" }).eq("id", creative.id);

          const { data: approvalRow } = await supabase
            .from("pending_approvals")
            .insert({
              approval_type: "launch_test",
              ad_account_id: account.id,
              creative_asset_id: creative.id,
              proposed_action: { meta_campaign_id: metaCampaignId, ad_sets: createdAdSets },
              reason: `Launch test: ${creative.file_name} (${createdAdSets.length} ad sets, ₦${(testBudget * createdAdSets.length).toLocaleString()}/day)`,
              status: "pending",
            })
            .select()
            .single();

          await sendWhatsApp(
            `🚀 New test ready: "${creative.file_name}" [${account.name}]\n` +
              `${createdAdSets.length} ad sets — ₦${(testBudget * createdAdSets.length).toLocaleString()}/day total\n\n` +
              `Reply APPROVE ${approvalRow?.id} to launch\n` +
              `Reply REJECT ${approvalRow?.id} to cancel`,
          );

          acctSummary.launched.push({
            creative: creative.file_name,
            meta_campaign_id: metaCampaignId,
            ad_sets: createdAdSets.length,
            approval_id: approvalRow?.id,
          });
          // deno-lint-ignore no-explicit-any
        } catch (e: any) {
          console.error(`Launch error for creative ${creative.id}:`, e);
          acctSummary.errors.push(`Creative "${creative.file_name}": ${e.message}`);
        }
      }

      summary.push(acctSummary);
    }

    return json({ success: true, summary });
    // deno-lint-ignore no-explicit-any
  } catch (err: any) {
    console.error("auto-launch-tests error:", err);
    return json({ error: err.message, summary }, 500);
  }
});
