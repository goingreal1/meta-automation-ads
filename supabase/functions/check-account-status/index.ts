import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v20.0";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function parseWalletBalance(displayString: string | undefined): number | null {
  if (!displayString) return null;
  const match = displayString.match(/([\d,]+\.\d{2})/);
  if (!match) return null;
  return parseFloat(match[1].replace(/,/g, ""));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" },
    });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!META_ACCESS_TOKEN) return json({ error: "META_ACCESS_TOKEN secret is not set yet in Supabase." }, 500);

  try {
    const body = await req.json().catch(() => ({}));
    if (!body.ad_account_id) return json({ error: "Missing ad_account_id in request body." }, 400);

    const { data: accountRow } = await supabase.from("ad_accounts").select("*").eq("id", body.ad_account_id).maybeSingle();
    if (!accountRow) return json({ error: `No ad_accounts row found for id ${body.ad_account_id}` }, 404);

    const metaAdAccountId = String(accountRow.meta_ad_account_id).replace(/^act_/, "");
    const fields = "account_id,name,balance,amount_spent,spend_cap,currency,funding_source_details,account_status";
    const url = `${META_GRAPH_BASE}/act_${metaAdAccountId}?fields=${fields}&access_token=${META_ACCESS_TOKEN}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) return json({ error: data.error.message, code: data.error.code, type: data.error.type }, 400);

    // funding_source_details.display_string holds the real remaining prepaid
    // wallet balance for wallet-funded accounts (e.g. "Available balance
    // (NGN8,554.30)") -- this is the number the person actually sees in
    // Meta's own UI. The plain `balance` field is accrued UNBILLED SPEND
    // (what you currently owe since the last charge), not funds left --
    // it should only be used as a last-resort fallback for non-wallet
    // (card/threshold-billed) accounts that have no wallet balance at all.
    const walletBalance = parseWalletBalance(data.funding_source_details?.display_string);
    const finalBalance = walletBalance !== null ? walletBalance : (data.balance !== undefined ? Number(data.balance) / 100 : null);
    const amountSpent = data.amount_spent !== undefined ? Number(data.amount_spent) / 100 : null;

    await supabase.from("ad_accounts").update({
      balance_naira: finalBalance,
      balance_updated_at: new Date().toISOString(),
    }).eq("id", accountRow.id);

    return json({
      success: true,
      balance_source: walletBalance !== null ? "wallet" : "accrued_spend_fallback",
      balance_naira: finalBalance,
      name: data.name,
      currency: data.currency ?? "NGN",
      status: data.account_status === 1 ? "ACTIVE" : `status_code_${data.account_status}`,
      amount_spent_naira: amountSpent,
      spend_cap_naira: data.spend_cap ? Number(data.spend_cap) / 100 : null,
      raw: data,
    });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});
