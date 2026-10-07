import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const META_ACCESS_TOKEN   = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const SUPABASE_URL        = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WHATSAPP_TOKEN      = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_ID   = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const ALERT_TO_NUMBER     = Deno.env.get("ALERT_TO_NUMBER") ?? "";
const DAILY_BUDGET_LIMIT  = parseInt(Deno.env.get("DAILY_BUDGET_LIMIT_NAIRA") ?? "100000");

// ─── THRESHOLDS ───────────────────────────────────────────────────────────────
const CTR_KILL             = 0.7;    // % — kill below this
const CTR_WATCH            = 1.2;    // % — monitor zone
const CTR_WINNER           = 1.5;    // % — scale candidate
const CPA_WATCH            = 1500;   // ₦ — watch threshold
const CPA_HARD_KILL        = 2500;   // ₦ — hard limit, auto-pause via Meta API
const FREQUENCY_FATIGUE    = 3.5;    // × — creative fatigue threshold
const SCALE_BUDGET_PCT     = 0.20;   // 20% budget increase for winners
const MIN_HOURS_COLD_START = 10;     // hours before any kill decision
const META_GRAPH_BASE      = "https://graph.facebook.com/v18.0";

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * The access token to use for one ad account: its own OAuth connection's
 * token (a buyer-linked Business Manager, connected via Settings -> Connect
 * Meta) if it has one, refreshed first if it's within a week of expiring --
 * otherwise the single shared META_ACCESS_TOKEN every manually-added account
 * has always used. Falling back keeps every account that predates OAuth
 * working exactly as before.
 */
async function resolveAccountToken(supabase: any, account: any): Promise<string> {
  if (!account.meta_connection_id) return META_ACCESS_TOKEN;

  const { data: conn } = await supabase
    .from("meta_connections")
    .select("id, access_token, token_expires_at, status")
    .eq("id", account.meta_connection_id)
    .maybeSingle();
  if (!conn || conn.status !== "active") {
    console.error(`Account ${account.name}: its Meta connection is missing or revoked -- falling back to the shared token.`);
    return META_ACCESS_TOKEN;
  }

  const expiresInDays = conn.token_expires_at ? (new Date(conn.token_expires_at).getTime() - Date.now()) / 86400000 : Infinity;
  if (expiresInDays > 7) return conn.access_token;

  // Re-exchange the still-valid long-lived token for a fresh ~60-day one.
  // This only works while the current token hasn't actually expired yet --
  // once it has, the buyer has to reconnect via Settings.
  try {
    const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
    const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
    if (!META_APP_ID || !META_APP_SECRET) return conn.access_token;

    const res = await fetch(
      `${META_GRAPH_BASE}/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${conn.access_token}`,
    );
    const data = await res.json();
    if (!res.ok || !data.access_token) {
      console.error(`Token refresh failed for connection ${conn.id}:`, data.error?.message);
      await supabase.from("meta_connections").update({ last_error: data.error?.message ?? "refresh failed" }).eq("id", conn.id);
      return conn.access_token; // still try with what we have -- might have a few days left
    }
    const newExpiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null;
    await supabase.from("meta_connections").update({
      access_token: data.access_token,
      token_expires_at: newExpiresAt,
      last_synced_at: new Date().toISOString(),
      last_error: null,
    }).eq("id", conn.id);
    return data.access_token;
  } catch (e) {
    console.error("Token refresh error:", e);
    return conn.access_token;
  }
}

/** Send a WhatsApp text message via Cloud API */
async function sendWhatsApp(message: string): Promise<void> {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID || !ALERT_TO_NUMBER) return;
  try {
    const resp = await fetch(`${META_GRAPH_BASE}/${WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: ALERT_TO_NUMBER,
        type: "text",
        text: { body: message },
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error(`WhatsApp send failed: ${resp.status} — ${err}`);
    }
  } catch (e) {
    console.error("WhatsApp fetch error:", e);
  }
}

/** Pause an ad set on Meta via the Graph API */
async function pauseAdSetOnMeta(metaAdsetId: string, adsetName: string, token: string): Promise<boolean> {
  try {
    const resp = await fetch(`${META_GRAPH_BASE}/${metaAdsetId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAUSED", access_token: token }),
    });
    const result = await resp.json();
    if (result.success) {
      console.log(`✅ Paused ad set: ${adsetName} (${metaAdsetId})`);
      return true;
    }
    console.error(`❌ Failed to pause ${adsetName}:`, result.error?.message);
    return false;
  } catch (e) {
    console.error("Meta pause fetch error:", e);
    return false;
  }
}

/** Scale an ad set daily budget by SCALE_BUDGET_PCT on Meta (kobo = NGN × 100) */
async function scaleBudgetOnMeta(
  metaAdsetId: string,
  adsetName: string,
  currentBudgetNaira: number,
  token: string,
): Promise<boolean> {
  try {
    const newBudgetKobo = Math.round(currentBudgetNaira * (1 + SCALE_BUDGET_PCT) * 100);
    const resp = await fetch(`${META_GRAPH_BASE}/${metaAdsetId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily_budget: newBudgetKobo, access_token: token }),
    });
    const result = await resp.json();
    if (result.success) {
      console.log(`📈 Scaled budget for ${adsetName}: ₦${currentBudgetNaira} → ₦${Math.round(currentBudgetNaira * (1 + SCALE_BUDGET_PCT))}`);
      return true;
    }
    console.error(`❌ Failed to scale ${adsetName}:`, result.error?.message);
    return false;
  } catch (e) {
    console.error("Meta scale fetch error:", e);
    return false;
  }
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
const SVC_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Caller must be the service role (internal functions / cron) or a signed-in
// dashboard user -- the public anon key alone is not enough. A service token
// is proven with the Auth admin API because pg_cron may hold a different (but
// valid) copy of the key than this function's env.
type Caller = { service: boolean; company_id: string | null; role: string | null };
async function getCaller(req: Request, admin: ReturnType<typeof createClient>): Promise<Caller | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  if (SVC_KEY && token === SVC_KEY) return { service: true, company_id: null, role: null };
  const { data } = await admin.auth.getUser(token);
  if (data?.user) {
    const { data: p } = await admin.from("profiles").select("company_id, role").eq("id", data.user.id).maybeSingle();
    return p?.company_id ? { service: false, company_id: p.company_id, role: p.role } : null;
  }
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL") ?? ""}/auth/v1/admin/users?per_page=1`, { headers: { apikey: token, Authorization: `Bearer ${token}` } });
    if (r.status === 200) return { service: true, company_id: null, role: null };
  } catch { /* not a service token */ }
  return null;
}

Deno.serve(async (req: Request) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const caller = await getCaller(req, supabase);
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    
    // Parse manual ad_account_id or historical sync if triggered from dashboard
    let targetAccountId = null;
    let datePreset = "today";
    let isBackfill = false;

    if (req.method === 'POST') {
      try {
        const body = await req.json();
        targetAccountId = body.ad_account_id;
        if (body.date_preset) datePreset = body.date_preset;
        if (body.backfill) isBackfill = body.backfill;
      } catch(e) {}
    }

    // ── 1. Fetch Ad Accounts ────────────────────────────────────────────────
    let acctQuery = supabase
      .from('ad_accounts')
      .select('*')
      .eq('status', 'active');
    // A signed-in user only pulls their own company's ad accounts.
    if (!caller.service) acctQuery = acctQuery.eq('company_id', caller.company_id);
    let { data: accounts, error: acctErr } = await acctQuery;
      
    if (acctErr || !accounts) {
      return new Response(JSON.stringify({ error: 'Failed to load ad accounts' }), { status: 500 });
    }

    // Filter to a single account if manual trigger requested it
    if (targetAccountId) {
      accounts = accounts.filter((a: any) => a.id === targetAccountId);
    }

    if (accounts.length === 0) {
      return new Response(JSON.stringify({ message: "No active ad accounts to process." }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const today = new Date().toISOString().split("T")[0];
    const totalResults: object[] = [];
    let totalAdsetsProcessed = 0;

    // ── 2. Process each Ad Account ──────────────────────────────────────────
    for (const account of accounts) {
      console.log(`\n--- Processing Account: ${account.name} (${account.meta_ad_account_id}) ---`);
      const META_AD_ACCOUNT_ID = account.meta_ad_account_id.replace('act_', '');
      const token = await resolveAccountToken(supabase, account);

      // ── 2.1 Sync Campaigns ────────────────────────────────────────────────
      try {
        const campUrl = `${META_GRAPH_BASE}/act_${META_AD_ACCOUNT_ID}/campaigns?fields=id,name,objective,status,daily_budget,lifetime_budget,created_time&limit=50&access_token=${token}`;
        const campRes = await fetch(campUrl);
        const campData = await campRes.json();
        
        if (campData.data) {
          for (const c of campData.data) {
            let status = c.status?.toLowerCase();
            if (status !== 'active' && status !== 'paused') status = 'ended';
            
            await supabase.from("campaigns").upsert({
              ad_account_id: account.id,
              company_id: account.company_id,
              meta_campaign_id: c.id,
              campaign_name: c.name,
              objective_raw: c.objective,
              status: status,
              daily_budget_naira: c.daily_budget ? parseInt(c.daily_budget) / 100 : null,
              lifetime_budget_naira: c.lifetime_budget ? parseInt(c.lifetime_budget) / 100 : null,
              launched_at: c.created_time || new Date().toISOString(),
              meta_raw: c
            }, { onConflict: "meta_campaign_id" });
          }
        }
      } catch(e) { console.error("Campaign sync error", e); }

      // ── 2.2 Sync Ads / Creatives ──────────────────────────────────────────
      try {
        const adsUrl = `${META_GRAPH_BASE}/act_${META_AD_ACCOUNT_ID}/ads?fields=id,name,status,creative{body,image_url,video_url,object_story_spec,name,title,thumbnail_url},created_time,campaign_id,adset_id&limit=100&access_token=${token}`;
        const adsRes = await fetch(adsUrl);
        const adsData = await adsRes.json();
        
        if (adsData.data) {
          for (const ad of adsData.data) {
            const cr = ad.creative || {};
            const primaryText = cr.body || "";
            const headline = cr.title || "";
            let imgUrl = cr.image_url || cr.thumbnail_url || "";
            let vidUrl = cr.video_url || "";
            
            if (cr.object_story_spec && cr.object_story_spec.video_data) {
                vidUrl = cr.object_story_spec.video_data.video_url || vidUrl;
                imgUrl = cr.object_story_spec.video_data.image_url || imgUrl;
            }

            await supabase.from("creatives").upsert({
              company_id: account.company_id,
              meta_ad_id: ad.id,
              creative_name: ad.name,
              primary_text: primaryText,
              headline: headline,
              image_url: imgUrl,
              video_url: vidUrl,
              meta_raw: ad
            }, { onConflict: "meta_ad_id" });
          }
        }
      } catch(e) { console.error("Ad sync error", e); }

      // ── 2.3 Pull AD-LEVEL insights ──────────────────────────────────────────
      // Everything above this point is ad-set-level -- enough to tell you an ad
      // set is winning, not which specific creative inside it is carrying that.
      // Matches each Meta ad back to its ad_set_ads row (written by
      // sync-meta-structure or ai-auto-launch-tests) via meta_ad_id; an ad not
      // synced into ad_set_ads yet (sync-meta-structure hasn't run) is skipped
      // rather than auto-imported here, to avoid duplicating that function's
      // more complete campaign/ad-set/ad linking logic in two places.
      try {
        const adInsightFields = [
          "ad_id", "adset_id", "spend", "impressions", "reach",
          "clicks", "ctr", "cpc", "cpm", "frequency", "actions",
        ].join(",");
        const adIncrementStr = isBackfill ? "&time_increment=1" : "";
        const adInsightsUrl =
          `${META_GRAPH_BASE}/act_${META_AD_ACCOUNT_ID}/insights` +
          `?level=ad&fields=${adInsightFields}&date_preset=${datePreset}${adIncrementStr}&access_token=${token}`;
        const adInsRes = await fetch(adInsightsUrl);
        const adInsData = await adInsRes.json();

        if (adInsData.data) {
          for (const row of adInsData.data) {
            const { data: adSetAdRow } = await supabase
              .from("ad_set_ads")
              .select("id, ad_set_id")
              .eq("meta_ad_id", row.ad_id)
              .maybeSingle();
            if (!adSetAdRow) continue;

            const spend = parseFloat(row.spend ?? "0");
            const impressions = parseInt(row.impressions ?? "0");
            const reach = parseInt(row.reach ?? "0");
            const clicks = parseInt(row.clicks ?? "0");
            const ctr = parseFloat(row.ctr ?? "0");
            const cpc = parseFloat(row.cpc ?? "0");
            const cpm = parseFloat(row.cpm ?? "0");
            const frequency = parseFloat(row.frequency ?? "0");
            const purchaseAction = (row.actions ?? []).find(
              (a: { action_type: string }) =>
                a.action_type === "purchase" || a.action_type === "offsite_conversion.fb_pixel_purchase",
            );
            const orders = purchaseAction ? parseInt(purchaseAction.value) : 0;
            const costPerOrder = orders > 0 ? spend / orders : null;

            const { error: adMetricErr } = await supabase.from("daily_metrics").upsert({
              ad_set_ad_id: adSetAdRow.id,
              // Parent ad_set_id too -- so a plain ad-set-level rollup query
              // (sum spend where ad_set_id = X) can include per-ad rows without
              // a join through ad_set_ads, while the unique constraint on
              // (ad_set_ad_id, metric_date) keeps each ad's own row distinct
              // from its ad set's own aggregate row (ad_set_ad_id null there).
              ad_set_id: adSetAdRow.ad_set_id,
              ad_account_id: account.id,
              company_id: account.company_id,
              metric_date: row.date_start || today,
              spend_naira: spend,
              impressions,
              reach,
              clicks,
              ctr,
              cpc_naira: cpc,
              cpm_naira: cpm,
              frequency,
              orders,
              cost_per_order_naira: costPerOrder,
            }, { onConflict: "ad_set_ad_id,metric_date" });
            if (adMetricErr) console.error(`Ad-level metrics upsert error (${row.ad_id}):`, adMetricErr.message);
          }
        }
      } catch (e) { console.error("Ad-level insights error", e); }

      const fields = [
        "adset_id", "adset_name", "spend", "impressions", "reach",
        "clicks", "ctr", "cpc", "cpm", "frequency", "actions",
      ].join(",");

      const incrementStr = isBackfill ? "&time_increment=1" : "";
      const insightsUrl =
        `${META_GRAPH_BASE}/act_${META_AD_ACCOUNT_ID}/insights` +
        `?level=adset&fields=${fields}&date_preset=${datePreset}${incrementStr}&access_token=${token}`;

      const res = await fetch(insightsUrl);
      const data = await res.json();

      if (data.error) {
        console.error(`Meta API error for account ${account.name}:`, data.error);
        totalResults.push({ account: account.name, error: data.error });
        continue; // Skip to next account on error
      }

      const rows = data.data ?? [];
      const accountResults: object[] = [];

      // ── 3. Process each ad set in this account ──────────────────────────────
      for (const row of rows) {
        totalAdsetsProcessed++;
        const metaAdsetId  = row.adset_id;
        const spend        = parseFloat(row.spend ?? "0");
        const impressions  = parseInt(row.impressions ?? "0");
        const reach        = parseInt(row.reach ?? "0");
        const clicks       = parseInt(row.clicks ?? "0");
        const ctr          = parseFloat(row.ctr ?? "0");
        const cpc          = parseFloat(row.cpc ?? "0");
        const cpm          = parseFloat(row.cpm ?? "0");
        const frequency    = parseFloat(row.frequency ?? "0");

        const purchaseAction = (row.actions ?? []).find(
          (a: { action_type: string }) =>
            a.action_type === "purchase" ||
            a.action_type === "offsite_conversion.fb_pixel_purchase",
        );
        const orders       = purchaseAction ? parseInt(purchaseAction.value) : 0;
        const costPerOrder = orders > 0 ? spend / orders : null;

        // Look up local ad set record (filter by ad_account_id)
        let { data: adSetRow } = await supabase
          .from("ad_sets")
          .select("id, adset_name, meta_adset_id, created_at, meta_launched_at, budget_naira, status")
          .eq("meta_adset_id", metaAdsetId)
          .eq("ad_account_id", account.id)
          .maybeSingle();

        if (!adSetRow) {
          // AUTO-IMPORT MISSING AD SET
          console.log(`Auto-importing missing ad set: ${metaAdsetId}`);
          
          const adsetDetailsUrl = `${META_GRAPH_BASE}/${metaAdsetId}?fields=name,daily_budget,status,created_time&access_token=${token}`;
          const adsetRes = await fetch(adsetDetailsUrl);
          const adsetData = await adsetRes.json();

          if (adsetData.error) {
             console.error(`Failed to fetch adset details for auto-import:`, adsetData.error);
             continue;
          }

          const budgetNaira = adsetData.daily_budget ? (parseInt(adsetData.daily_budget) / 100) : null;
          
          const { data: newAdSet, error: insertErr } = await supabase.from("ad_sets").insert({
            meta_adset_id: metaAdsetId,
            ad_account_id: account.id,
            company_id: account.company_id,
            adset_name: adsetData.name || row.adset_name,
            budget_naira: budgetNaira,
            status: adsetData.status?.toLowerCase() === 'active' ? 'active' : 'paused',
            meta_launched_at: adsetData.created_time || new Date().toISOString(),
            meta_raw: adsetData
          }).select('id, adset_name, meta_adset_id, created_at, meta_launched_at, budget_naira, status').single();

          if (insertErr || !newAdSet) {
            console.error(`Failed to auto-import ad set ${metaAdsetId}:`, insertErr);
            continue;
          }
          
          adSetRow = newAdSet;
          console.log(`Successfully imported ad set: ${adSetRow.adset_name}`);
        }

        const metricDate = row.date_start || today;

        // Upsert daily metrics
        const { error: upsertErr } = await supabase.from("daily_metrics").upsert(
          {
            ad_set_id:            adSetRow.id,
            ad_account_id:        account.id,
            company_id:           account.company_id,
            metric_date:          metricDate,
            spend_naira:          spend,
            impressions,
            reach,
            clicks,
            ctr,
            cpc_naira:            cpc,
            cpm_naira:            cpm,
            frequency,
            orders,
            cost_per_order_naira: costPerOrder,
          },
          { onConflict: "ad_set_id,metric_date" },
        );
        if (upsertErr) console.error(`Metrics upsert error for ${adSetRow.adset_name}:`, upsertErr.message);

        // Hours since ACTUAL launch
        const launchTimestamp = adSetRow.meta_launched_at ?? adSetRow.created_at;
        const hoursSinceLaunch = launchTimestamp
          ? (Date.now() - new Date(launchTimestamp).getTime()) / (1000 * 60 * 60)
          : 0;
        // Skip alert/decision logic if this is a historical backfill
        if (isBackfill) {
          accountResults.push({ adset: adSetRow.adset_name, metricDate, spend, orders, decision: "backfilled" });
          continue;
        }

        // Creative fatigue check
        if (frequency >= FREQUENCY_FATIGUE) {
          await sendWhatsApp(
            `🔁 Creative Fatigue: "${adSetRow.adset_name}" [${account.name}]\n` +
            `Frequency: ${frequency.toFixed(2)}× (limit: ${FREQUENCY_FATIGUE}×)\n` +
            `Spend today: ₦${spend} | Orders: ${orders}\n` +
            `Action: Swap creative to prevent audience burnout.`,
          );
        }

        // Cold-start guard
        let decision = "cold_start";
        let reason   = `Cold start: ${hoursSinceLaunch.toFixed(1)}h of ${MIN_HOURS_COLD_START}h minimum.`;

        if (hoursSinceLaunch >= MIN_HOURS_COLD_START) {
          const { data: existingDecision } = await supabase
            .from("kill_keep_decisions")
            .select("id")
            .eq("ad_set_id", adSetRow.id)
            .gte("decision_time", new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
            .maybeSingle();

          if (existingDecision) {
            accountResults.push({ adset: adSetRow.adset_name, decision: "already_evaluated_today" });
            continue;
          }

          // Decision tree
          if (costPerOrder && costPerOrder > CPA_HARD_KILL) {
            decision = "kill";
            reason   = `CPA ₦${costPerOrder.toFixed(0)} exceeds hard limit ₦${CPA_HARD_KILL}. Auto-pausing.`;
            await pauseAdSetOnMeta(metaAdsetId, adSetRow.adset_name, token);
            await sendWhatsApp(
              `🚨 AUTO-PAUSED: "${adSetRow.adset_name}" [${account.name}]\n` +
              `CPA: ₦${costPerOrder.toFixed(0)} (LIMIT: ₦${CPA_HARD_KILL})\n` +
              `Spend: ₦${spend} | Orders: ${orders}\n` +
              `Action: Ad set paused to protect budget. Review immediately.`,
            );
          } else if (ctr < CTR_KILL && spend >= 500) {
            decision = "kill";
            reason   = `CTR ${ctr.toFixed(2)}% below ${CTR_KILL}% after ${hoursSinceLaunch.toFixed(1)}h`;
            await pauseAdSetOnMeta(metaAdsetId, adSetRow.adset_name, token);
            await sendWhatsApp(
              `⚠️ Kill Alert: "${adSetRow.adset_name}" [${account.name}]\n` +
              `Reason: ${reason}\nSpend: ₦${spend} | Orders: ${orders}\n` +
              `Action: Auto-paused. Check creative angle.`,
            );
          } else if (spend >= 3000 && orders === 0 && hoursSinceLaunch >= 48) {
            decision = "kill";
            reason   = `₦${spend.toFixed(0)} spent, zero orders after 48hrs`;
            await pauseAdSetOnMeta(metaAdsetId, adSetRow.adset_name, token);
            await sendWhatsApp(
              `⚠️ Kill Alert: "${adSetRow.adset_name}" [${account.name}]\n` +
              `Reason: ${reason}\n` +
              `Action: Auto-paused. Offer or targeting may be broken.`,
            );
          } else if (costPerOrder && costPerOrder > CPA_WATCH) {
            decision = "watch";
            reason   = `CPA ₦${costPerOrder.toFixed(0)} above watch threshold ₦${CPA_WATCH}`;
            await sendWhatsApp(
              `👀 Watch Alert: "${adSetRow.adset_name}" [${account.name}]\n` +
              `Reason: ${reason}\nSpend: ₦${spend} | Orders: ${orders}\n` +
              `CTR: ${ctr.toFixed(2)}% — Monitor closely.`,
            );
          } else if (ctr >= CTR_WINNER && costPerOrder && costPerOrder < CPA_WATCH) {
            decision = "scale";
            reason   = `CTR ${ctr.toFixed(2)}% + CPA ₦${costPerOrder.toFixed(0)} — scaling budget 20%`;
            const currentBudget = adSetRow.budget_naira ?? 5000;
            const scaled = await scaleBudgetOnMeta(metaAdsetId, adSetRow.adset_name, currentBudget, token);
            if (scaled) {
              await supabase
                .from("ad_sets")
                .update({ budget_naira: Math.round(currentBudget * (1 + SCALE_BUDGET_PCT)) })
                .eq("id", adSetRow.id);
            }
            await sendWhatsApp(
              `📈 SCALE: "${adSetRow.adset_name}" [${account.name}]\n` +
              `CTR: ${ctr.toFixed(2)}% | CPA: ₦${costPerOrder.toFixed(0)}\n` +
              `Budget: ₦${currentBudget} → ₦${Math.round(currentBudget * 1.2)}\n` +
              `This is a winner — watch it closely.`,
            );
          } else {
            decision = "keep";
            reason   = `CTR ${ctr.toFixed(2)}% within parameters. CPA: ${costPerOrder ? "₦" + costPerOrder.toFixed(0) : "N/A"}`;
          }

          // Log the decision
          await supabase.from("kill_keep_decisions").insert({
            ad_set_id:                  adSetRow.id,
            hours_since_launch:         hoursSinceLaunch,
            spend_at_decision:          spend,
            orders_at_decision:         orders,
            ctr_at_decision:            ctr,
            cost_per_order_at_decision: costPerOrder,
            decision,
            reason,
          });
        }

        accountResults.push({ adset: adSetRow.adset_name, spend, ctr, costPerOrder, frequency, orders, decision, reason });
      }

      // Budget Pacing Guard per account
      const totalSpendToday = accountResults.reduce((acc: number, curr: any) => acc + (curr.spend || 0), 0);
      const hourOfDay = new Date().getUTCHours() + 1; // Lagos time
      
      if (hourOfDay < 18 && totalSpendToday >= (DAILY_BUDGET_LIMIT * 0.9)) {
        await sendWhatsApp(
          `🚨 BUDGET PACING ALERT [${account.name}] 🚨\n` +
          `Total spend today is ₦${totalSpendToday.toFixed(0)}, which is ≥90% of daily limit (₦${DAILY_BUDGET_LIMIT}).\n` +
          `It is only ${hourOfDay}:00. You may run out of budget before peak evening hours. Review scaling!`
        );
      }

      totalResults.push({ account: account.name, results: accountResults });
    }

    return new Response(JSON.stringify({ 
      processed: totalAdsetsProcessed, 
      accounts: totalResults 
    }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err: any) {
    console.error("Global metrics error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
