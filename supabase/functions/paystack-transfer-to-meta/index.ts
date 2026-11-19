import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Sends the money for one funding request to Meta.
// Only an owner/admin sends money to Meta: this function accepts internal callers only (fund-request-send and mcp-money after the
// admin's transfer PIN, or fund-request-submit for a buyer the admin switched auto-approve on for). A request carries the Meta account number
// and bank, verified when it was submitted; it is verified AGAIN here, at the moment of sending, so an old or changed account is never paid.
// The destination is only accepted if the bank's own account-resolve returns a Facebook/Meta name (or a name on the company's approved list).
//
//   POST { fund_request_id, account_number?, bank_code?, on_behalf_of } ->
//     { ok: true, transfer_code, account_name } | { verified: false, account_name, reason } | { error }
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const PAYSTACK_BASE = "https://api.paystack.co";
const ALLOWED_NAME_PATTERN = /(facebook|meta)/i;
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
async function paystackFetch(path, init = {}) {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...init.headers ?? {}
    }
  });
  const body = await res.json().catch(()=>({}));
  if (!res.ok || body?.status === false) {
    throw new Error(body?.message || `Paystack ${path} failed (${res.status})`);
  }
  return body;
}
function notifyTransferResult(fundRequestId) {
  fetch(`${SUPABASE_URL}/functions/v1/send-internal-whatsapp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({
      type: "transfer_result",
      fund_request_id: fundRequestId
    })
  }).catch((err)=>console.error("send-internal-whatsapp (transfer_result) failed:", err));
}
async function authedProfile(req, onBehalfOf) {
  if (onBehalfOf && /^[0-9a-f-]{36}$/i.test(onBehalfOf) && SUPABASE_SERVICE_ROLE_KEY.length > 20 && req.headers.get("x-internal-key") === SUPABASE_SERVICE_ROLE_KEY) {
    const { data: p } = await supabase.from("profiles").select("id, role, media_buyer_id, company_id").eq("id", onBehalfOf).maybeSingle();
    return p ?? null;
  }
  return null;
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-internal-key"
      }
    });
  }
  if (req.method !== "POST") return json({
    error: "POST only"
  }, 405);
  if (!PAYSTACK_SECRET_KEY) return json({
    error: "PAYSTACK_SECRET_KEY isn't configured yet."
  }, 500);
  try {
    const { fund_request_id, account_number: acctIn, bank_code: bankIn, source: reqSource, approved_with: reqApprovedWith, on_behalf_of: onBehalfOf } = await req.json();
    if (!fund_request_id) return json({
      error: "fund_request_id is required"
    }, 400);
    const internal = !!onBehalfOf && SUPABASE_SERVICE_ROLE_KEY.length > 20 && req.headers.get("x-internal-key") === SUPABASE_SERVICE_ROLE_KEY;
    if (!internal) return json({
      error: "Money is sent only after the admin's transfer PIN is entered. Approve the request with your PIN."
    }, 403);
    const profile = await authedProfile(req, onBehalfOf);
    if (!profile) return json({
      error: "Unauthorized"
    }, 401);
    const { data: fr } = await supabase.from("fund_requests").select("*").eq("id", fund_request_id).maybeSingle();
    if (!fr) return json({
      error: "Funding request not found"
    }, 404);
    const isAdmin = profile.role === "owner" || profile.role === "admin";
    // A media buyer may send money to Meta out of their OWN held balance (paid_from = "buyer"); everything else needs an owner/admin.
    const ownBalanceSend = fr.paid_from === "buyer" && !!profile.media_buyer_id && profile.media_buyer_id === fr.media_buyer_id && profile.company_id === fr.company_id;
    if (!ownBalanceSend && (!isAdmin || profile.company_id !== fr.company_id)) return json({
      error: "Only an owner or admin of this company can send money to Meta."
    }, 403);
    if (fr.status !== "pending" && fr.status !== "approved") return json({
      error: `This request is ${fr.status}, so there is nothing to send.`
    }, 400);
    if (fr.paystack_transfer_code) return json({
      error: "This request already has a transfer attached."
    }, 400);
    const account_number = String(fr.req_account_number ?? acctIn ?? "");
    const bank_code = String(fr.req_bank_code ?? bankIn ?? "");
    if (!account_number || !bank_code) return json({
      error: "This request has no Meta account number. Ask the buyer to send a new request with the account number and bank."
    }, 400);
    if (fr.req_account_number && (acctIn && String(acctIn) !== account_number || bankIn && String(bankIn) !== bank_code)) return json({
      error: "The account on this request changed. Open the request again."
    }, 409);
    {
      // The funding wallet (deposits, minus money set aside or sent, minus what Revora-managed ad accounts have spent) must cover this now.
      const { data: bal } = ownBalanceSend ? await supabase.rpc("buyer_wallet_balance", {
        p_buyer: fr.media_buyer_id
      }) : await supabase.rpc("company_wallet_balance", {
        p_company: fr.company_id
      });
      const available = Number(bal ?? 0) + (fr.status === "approved" ? Number(fr.amount_naira) : 0);
      if (Number(fr.amount_naira) > available) return json({
        error: `The funding wallet has ₦${Math.max(0, Math.round(available)).toLocaleString("en-NG")}, which cannot cover ₦${Math.round(Number(fr.amount_naira)).toLocaleString("en-NG")}. Add funds first.`
      }, 400);
    }
    const { data: buyer } = await supabase.from("media_buyers").select("id, name").eq("id", fr.media_buyer_id).maybeSingle();
    if (!buyer) return json({
      error: "Media buyer not found"
    }, 404);
    const stale = async (reason, name)=>{
      await supabase.from("fund_requests").update({
        last_verify_error: reason,
        last_verify_at: new Date().toISOString()
      }).eq("id", fr.id);
      return json({
        verified: false,
        account_name: name ?? null,
        reason
      });
    };
    let accountName = "";
    try {
      accountName = String((await paystackFetch(`/bank/resolve?account_number=${encodeURIComponent(account_number)}&bank_code=${encodeURIComponent(bank_code)}`))?.data?.account_name ?? "");
    } catch  {
      return await stale("The bank can no longer verify this Meta account number. It has probably expired. Nothing was sent: ask the buyer for a fresh account number from Ads Manager (Billing, Add funds).");
    }
    if (!accountName) return await stale("The bank did not return a name for this account. Nothing was sent: ask the buyer for a fresh account number.");
    const normName = (v)=>v.trim().toLowerCase().replace(/\s+/g, " ");
    const { data: allowedRows } = await supabase.from("transfer_allowed_names").select("name_key").eq("company_id", fr.company_id);
    const hasList = (allowedRows ?? []).length > 0;
    const nameOk = hasList ? (allowedRows ?? []).some((a)=>a.name_key === normName(accountName)) : ALLOWED_NAME_PATTERN.test(accountName);
    if (!nameOk) {
      return await stale(hasList ? `The bank resolved this account to "${accountName}", which isn't on your approved list of Meta payment accounts. If it really is Meta's billing account, an owner/admin can approve that exact name in Settings → Business & team, then try again.` : "This account isn't registered to Facebook/Meta -- we only accept transfers into Meta's own ad billing account. Double check you copied today's top-up account number from Ads Manager, not an old one.", accountName);
    }
    const bankList = await paystackFetch("/bank?country=nigeria&perPage=200").catch(()=>({
        data: []
      }));
    const bankName = (bankList?.data ?? []).find((b)=>b.code === bank_code)?.name ?? bank_code;
    // Claim this attempt: two sends at the same moment cannot both pass. The first attempt keeps the plain reference; a later attempt after a failure gets a new one.
    const attempt = Number(fr.send_attempts ?? 0);
    const { data: claimed } = await supabase.from("fund_requests").update({
      send_attempts: attempt + 1
    }).eq("id", fr.id).eq("send_attempts", attempt).select("id");
    if (!claimed?.length) return json({
      error: "A send for this request is already in progress. Refresh and check its status."
    }, 409);
    const recipient = await paystackFetch("/transferrecipient", {
      method: "POST",
      body: JSON.stringify({
        type: "nuban",
        name: accountName,
        account_number,
        bank_code,
        currency: "NGN",
        description: `One-time Meta Ads top-up for ${buyer.name} (request ${fr.id})`
      })
    });
    let transfer;
    try {
      transfer = await paystackFetch("/transfer", {
        method: "POST",
        body: JSON.stringify({
          source: "balance",
          amount: Math.round(Number(fr.amount_naira) * 100),
          recipient: recipient?.data?.recipient_code,
          reference: attempt === 0 ? `rv${String(fr.id).replace(/-/g, "")}` : `rv${String(fr.id).replace(/-/g, "")}_${attempt + 1}`,
          reason: `Meta Ads top-up for ${buyer.name} (request ${fr.id})`
        })
      });
      if (transfer?.data?.status === "otp") throw new Error("Paystack is waiting for an OTP, so the money was not sent. Turn off OTP for transfers in Paystack (Settings, Preferences, Transfers), then try again.");
    } catch (transferErr) {
      await supabase.from("fund_requests").update({
        transfer_error: transferErr.message,
        destination_account_number: account_number,
        destination_bank_code: bank_code,
        destination_bank_name: bankName,
        destination_account_name: accountName
      }).eq("id", fr.id);
      notifyTransferResult(fr.id);
      return json({
        error: `Transfer failed: ${transferErr.message}`
      }, 502);
    }
    const { error: updErr } = await supabase.from("fund_requests").update({
      status: "transferred",
      decided_at: new Date().toISOString(),
      decided_by: profile.id,
      last_verify_error: null,
      paystack_transfer_code: transfer?.data?.transfer_code ?? null,
      paystack_transfer_reference: transfer?.data?.reference ?? null,
      transfer_error: null,
      transferred_at: new Date().toISOString(),
      destination_account_number: account_number,
      destination_bank_code: bank_code,
      destination_bank_name: bankName,
      destination_account_name: accountName
    }).eq("id", fr.id);
    if (updErr) throw updErr;
    notifyTransferResult(fr.id);
    await supabase.from("transfer_receipts").insert({
      company_id: fr.company_id,
      user_id: profile.id,
      kind: "meta",
      source: reqSource === "assistant" ? "assistant" : "dashboard",
      amount_naira: fr.amount_naira,
      account_name: accountName,
      account_number,
      bank_name: bankName,
      status: "processing",
      paystack_transfer_code: transfer?.data?.transfer_code ?? null,
      paystack_reference: transfer?.data?.reference ?? null,
      approved_with: reqApprovedWith === "pin" ? "Transfer PIN" : reqApprovedWith === "auto" ? "Auto-approve set by the owner/admin" : "Revora login"
    }).then(()=>{}, ()=>{});
    const { data: rc } = await supabase.from("transfer_receipts").select("id, receipt_no, created_at").eq("paystack_transfer_code", transfer?.data?.transfer_code ?? "").maybeSingle();
    return json({
      ok: true,
      transfer_code: transfer?.data?.transfer_code,
      reference: transfer?.data?.reference,
      account_name: accountName,
      bank_name: bankName,
      receipt: rc ?? null
    });
  } catch (err) {
    console.error("paystack-transfer-to-meta error:", err);
    return json({
      error: err.message
    }, 500);
  }
});
