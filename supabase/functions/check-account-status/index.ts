import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v20.0";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type, Authorization" },
    });
  }

  if (!META_ACCESS_TOKEN) {
    return json({ error: "META_ACCESS_TOKEN secret is not set yet in Supabase." }, 400);
  }

  let adAccountId: string;
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const requestedId = body?.ad_account_id as string | undefined;

    if (!requestedId) {
      return json({ error: "Missing ad_account_id in request body." }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: account, error } = await supabase
      .from("ad_accounts")
      .select("meta_ad_account_id")
      .eq("id", requestedId)
      .maybeSingle();

    if (error || !account) {
      return json({ error: `No ad_accounts row found for id ${requestedId}` }, 404);
    }

    adAccountId = String(account.meta_ad_account_id).replace("act_", "");
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }

  try {
    const fields = "account_id,name,account_status,currency,balance,amount_spent,spend_cap,funding_source_details";
    const params = new URLSearchParams({ access_token: META_ACCESS_TOKEN, fields });
    const res = await fetch(`${META_GRAPH_BASE}/act_${adAccountId}?${params.toString()}`);
    const data = await res.json();

    if (data.error) {
      return json({ error: data.error.message, code: data.error.code, type: data.error.type }, 400);
    }

    // Meta returns balance/amount_spent in the account's minor currency unit (kobo for NGN)
    const currency = data.currency ?? "NGN";
    const balance = data.balance ? Number(data.balance) / 100 : null;
    const amountSpent = data.amount_spent ? Number(data.amount_spent) / 100 : null;

    return json({
      success: true,
      account_id: data.account_id,
      name: data.name,
      status: data.account_status === 1 ? "ACTIVE" : `status_code_${data.account_status}`,
      currency,
      current_balance: balance !== null ? `₦${balance.toLocaleString()}` : "not available (prepaid accounts may not expose this field)",
      total_amount_spent_alltime: amountSpent !== null ? `₦${amountSpent.toLocaleString()}` : null,
      spend_cap: data.spend_cap ? `₦${(Number(data.spend_cap) / 100).toLocaleString()}` : "none set",
      raw: data,
    });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
