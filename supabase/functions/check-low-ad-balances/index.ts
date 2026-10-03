import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Scheduled (pg_cron, every 30 min -- see migration) sweep for ad accounts
// that are both low on balance AND still running an active campaign --
// only that combination is actually urgent (a paused/empty account with no
// campaign isn't losing anything by staying low). Throttled to one alert
// per account per 6 hours via last_low_balance_alert_at, so this doesn't
// re-fire every single run while an account sits below threshold.
//
// Auth: only callable with CRON_SECRET, same pattern as place-order-call.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const REALERT_AFTER_HOURS = 6;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => ({}));
  if (!CRON_SECRET || body?.cron_secret !== CRON_SECRET) return json({ error: "Unauthorized" }, 401);

  try {
    const { data: accounts } = await supabase
      .from("ad_accounts")
      .select("id, name, nickname, balance_naira, low_balance_threshold_naira, last_low_balance_alert_at, media_buyer_id, company_id, status")
      .eq("status", "active")
      .not("balance_naira", "is", null);

    const alerted: string[] = [];
    for (const acct of accounts ?? []) {
      if (Number(acct.balance_naira) > Number(acct.low_balance_threshold_naira)) continue;

      const lastAlert = acct.last_low_balance_alert_at ? new Date(acct.last_low_balance_alert_at).getTime() : 0;
      if (Date.now() - lastAlert < REALERT_AFTER_HOURS * 60 * 60 * 1000) continue;

      const { count } = await supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("ad_account_id", acct.id).eq("status", "ACTIVE");
      if (!count) continue;

      await fetch(`${SUPABASE_URL}/functions/v1/send-internal-whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ type: "low_balance", ad_account_id: acct.id }),
      }).catch((err) => console.error("send-internal-whatsapp (low_balance) failed:", err));

      await supabase.from("ad_accounts").update({ last_low_balance_alert_at: new Date().toISOString() }).eq("id", acct.id);
      alerted.push(acct.id);
    }

    return json({ ok: true, checked: accounts?.length ?? 0, alerted });
  } catch (err: any) {
    console.error("check-low-ad-balances error:", err);
    return json({ error: err.message }, 500);
  }
});
