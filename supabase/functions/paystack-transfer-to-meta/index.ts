import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Executes the real money movement a buyer triggers themselves from the
// dashboard: sending their own already-approved wallet balance into
// whatever one-time account number Meta's Ads Manager just generated for
// them (Billing -> Add funds). That account number is NOT stable -- Meta
// mints a fresh one each time and it expires in roughly 30 minutes -- so
// there is no "saved, verified Meta account" to reuse. Every call here
// resolves the pasted-in account fresh and, if it checks out, sends the
// transfer immediately in the same request:
//   - the fund_requests row must already be admin-approved (never pending),
//     must belong to the caller's own buyer when the caller isn't an admin,
//     and must not already have a transfer attached;
//   - the destination is only ever accepted if Paystack's own
//     account-resolve API returns a name containing "Facebook"/"Meta" --
//     anything else is rejected before any money moves.
// There is no path here for moving money to any other account.
//
//   POST { fund_request_id, account_number, bank_code } ->
//     { ok: true, transfer_code, account_name } | { verified: false, account_name, reason } | { error }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const PAYSTACK_BASE = "https://api.paystack.co";
const ALLOWED_NAME_PATTERN = /facebook|meta/i;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

async function paystackFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.status === false) {
    throw new Error(body?.message || `Paystack ${path} failed (${res.status})`);
  }
  return body;
}

async function authedProfile(req: Request): Promise<{ id: string; role: string; media_buyer_id: string | null } | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: userData } = await supabase.auth.getUser(token);
  if (!userData?.user) return null;
  const { data: profile } = await supabase.from("profiles").select("id, role, media_buyer_id").eq("id", userData.user.id).maybeSingle();
  return profile ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" },
    });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!PAYSTACK_SECRET_KEY) return json({ error: "PAYSTACK_SECRET_KEY isn't configured yet." }, 500);

  try {
    const { fund_request_id, account_number, bank_code } = await req.json();
    if (!fund_request_id || !account_number || !bank_code) {
      return json({ error: "fund_request_id, account_number and bank_code are required" }, 400);
    }

    const profile = await authedProfile(req);
    if (!profile) return json({ error: "Unauthorized" }, 401);

    const { data: fr } = await supabase.from("fund_requests").select("*").eq("id", fund_request_id).maybeSingle();
    if (!fr) return json({ error: "Funding request not found" }, 404);

    const isAdmin = profile.role === "owner" || profile.role === "admin";
    if (!isAdmin && !(profile.role === "buyer" && profile.media_buyer_id === fr.media_buyer_id)) {
      return json({ error: "Unauthorized" }, 401);
    }
    if (fr.status !== "approved") return json({ error: `This request is ${fr.status}, not approved -- nothing to transfer.` }, 400);
    if (fr.paystack_transfer_code) return json({ error: "This request already has a transfer attached." }, 400);

    const { data: buyer } = await supabase.from("media_buyers").select("id, name").eq("id", fr.media_buyer_id).maybeSingle();
    if (!buyer) return json({ error: "Media buyer not found" }, 404);

    // Resolve the account fresh every time -- it's only valid for the next
    // ~30 minutes anyway, so nothing about this result gets saved for reuse.
    const resolved = await paystackFetch(`/bank/resolve?account_number=${encodeURIComponent(account_number)}&bank_code=${encodeURIComponent(bank_code)}`);
    const accountName = resolved?.data?.account_name ?? "";
    if (!ALLOWED_NAME_PATTERN.test(accountName)) {
      return json({ verified: false, account_name: accountName, reason: "This account isn't registered to Facebook/Meta -- we only accept transfers into Meta's own ad billing account. Double check you copied today's top-up account number from Ads Manager, not an old one." });
    }

    const bankList = await paystackFetch("/bank?country=nigeria").catch(() => ({ data: [] }));
    const bankName = (bankList?.data ?? []).find((b: any) => b.code === bank_code)?.name ?? bank_code;

    const recipient = await paystackFetch("/transferrecipient", {
      method: "POST",
      body: JSON.stringify({
        type: "nuban",
        name: accountName,
        account_number,
        bank_code,
        currency: "NGN",
        description: `One-time Meta Ads top-up for ${buyer.name} (request ${fr.id})`,
      }),
    });

    let transfer;
    try {
      transfer = await paystackFetch("/transfer", {
        method: "POST",
        body: JSON.stringify({
          source: "balance",
          amount: Math.round(Number(fr.amount_naira) * 100),
          recipient: recipient?.data?.recipient_code,
          reason: `Meta Ads top-up for ${buyer.name} (request ${fr.id})`,
        }),
      });
    } catch (transferErr: any) {
      await supabase.from("fund_requests").update({
        transfer_error: transferErr.message,
        destination_account_number: account_number,
        destination_bank_code: bank_code,
        destination_bank_name: bankName,
        destination_account_name: accountName,
      }).eq("id", fr.id);
      return json({ error: `Transfer failed: ${transferErr.message}` }, 502);
    }

    const { error: updErr } = await supabase.from("fund_requests").update({
      status: "transferred",
      paystack_transfer_code: transfer?.data?.transfer_code ?? null,
      paystack_transfer_reference: transfer?.data?.reference ?? null,
      transfer_error: null,
      transferred_at: new Date().toISOString(),
      destination_account_number: account_number,
      destination_bank_code: bank_code,
      destination_bank_name: bankName,
      destination_account_name: accountName,
    }).eq("id", fr.id);
    if (updErr) throw updErr;

    return json({ ok: true, transfer_code: transfer?.data?.transfer_code, account_name: accountName });
  } catch (err: any) {
    console.error("paystack-transfer-to-meta error:", err);
    return json({ error: err.message }, 500);
  }
});
