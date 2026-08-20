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
async function pauseAdSetOnMeta(metaAdsetId: string, adsetName: string): Promise<boolean> {
  try {
    const resp = await fetch(`${META_GRAPH_BASE}/${metaAdsetId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAUSED", access_token: META_ACCESS_TOKEN }),
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
): Promise<boolean> {
  try {
    const newBudgetKobo = Math.round(currentBudgetNaira * (1 + SCALE_BUDGET_PCT) * 100);
    const resp = await fetch(`${META_GRAPH_BASE}/${metaAdsetId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily_budget: newBudgetKobo, access_token: META_ACCESS_TOKEN }),
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
    
    // Parse manual ad_account_id if triggered from dashboard
    let targetAccountId = null;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        targetAccountId = body.ad_account_id;
      } catch(e) {}
    }

    // ── 1. Fetch Ad Accounts ────────────────────────────────────────────────
    let { data: accounts, error: acctErr } = await supabase
      .from('ad_accounts')
      .select('*')
      .eq('status', 'active');
      
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

      const fields = [
        "adset_id", "adset_name", "spend", "impressions", "reach",
        "clicks", "ctr", "cpc", "cpm", "frequency", "actions",
      ].join(",");

      const insightsUrl =
        `${META_GRAPH_BASE}/act_${META_AD_ACCOUNT_ID}/insights` +
        `?level=adset&fields=${fields}&date_preset=today&access_token=${META_ACCESS_TOKEN}`;

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
        const { data: adSetRow } = await supabase
          .from("ad_sets")
          .select("id, adset_name, meta_adset_id, created_at, meta_launched_at, budget_naira, status")
          .eq("meta_adset_id", metaAdsetId)
          .eq("ad_account_id", account.id)
          .maybeSingle();

        if (!adSetRow) continue;

        // Upsert daily metrics
        const { error: upsertErr } = await supabase.from("daily_metrics").upsert(
          {
            ad_set_id:            adSetRow.id,
            ad_account_id:        account.id,
            metric_date:          today,
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
            await pauseAdSetOnMeta(metaAdsetId, adSetRow.adset_name);
            await sendWhatsApp(
              `🚨 AUTO-PAUSED: "${adSetRow.adset_name}" [${account.name}]\n` +
              `CPA: ₦${costPerOrder.toFixed(0)} (LIMIT: ₦${CPA_HARD_KILL})\n` +
              `Spend: ₦${spend} | Orders: ${orders}\n` +
              `Action: Ad set paused to protect budget. Review immediately.`,
            );
          } else if (ctr < CTR_KILL && spend >= 500) {
            decision = "kill";
            reason   = `CTR ${ctr.toFixed(2)}% below ${CTR_KILL}% after ${hoursSinceLaunch.toFixed(1)}h`;
            await pauseAdSetOnMeta(metaAdsetId, adSetRow.adset_name);
            await sendWhatsApp(
              `⚠️ Kill Alert: "${adSetRow.adset_name}" [${account.name}]\n` +
              `Reason: ${reason}\nSpend: ₦${spend} | Orders: ${orders}\n` +
              `Action: Auto-paused. Check creative angle.`,
            );
          } else if (spend >= 3000 && orders === 0 && hoursSinceLaunch >= 48) {
            decision = "kill";
            reason   = `₦${spend.toFixed(0)} spent, zero orders after 48hrs`;
            await pauseAdSetOnMeta(metaAdsetId, adSetRow.adset_name);
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
            const scaled = await scaleBudgetOnMeta(metaAdsetId, adSetRow.adset_name, currentBudget);
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
