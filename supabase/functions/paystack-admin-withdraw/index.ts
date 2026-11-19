import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Lets an admin withdraw real money out of the company's Paystack balance
// straight to their own bank account (Access Bank, GTBank, whatever) --
// unrestricted, unlike a buyer's transfer which is hard-locked to a
// verified Facebook/Meta destination only. Admin is the trusted
// principal here; there's no narrower guardrail to apply beyond "you must
// be an owner/admin of this company" and "this account must resolve to a
// real name" (so a typo'd account number doesn't silently vanish funds).
//
//   POST { access_token, amount_naira, account_number, bank_code } ->
//     { ok: true, transfer_code, account_name } | { error }
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const PAYSTACK_BASE = "https://api.paystack.co";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
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
  if (!res.ok || body?.status === false) throw new Error(body?.message || `Paystack ${path} failed (${res.status})`);
  return body;
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
    const { access_token, amount_naira, account_number, bank_code, reference, source, approved_with, on_behalf_of, mode: body_mode } = await req.json();
    // Optional caller-chosen reference: Paystack refuses a second transfer with the same one, so a retry can never pay twice.
    const ref = typeof reference === "string" && /^[a-z0-9_-]{16,50}$/.test(reference) ? reference : undefined;
    if (!amount_naira || !account_number || !bank_code) {
      return json({
        error: "amount_naira, account_number and bank_code are required"
      }, 400);
    }
    // Normal calls prove who they are with the person's own token. The mcp-money function (holding the service key) may instead
    // send an already PIN-approved transfer on that person's behalf; it checks the approval first, and this still demands owner/admin.
    const internal = SUPABASE_SERVICE_ROLE_KEY.length > 20 && req.headers.get("x-internal-key") === SUPABASE_SERVICE_ROLE_KEY;
    let uid = null;
    if (internal && typeof on_behalf_of === "string" && /^[0-9a-f-]{36}$/i.test(on_behalf_of)) uid = on_behalf_of;
    else {
      const { data: userData } = await supabase.auth.getUser(access_token);
      uid = userData?.user?.id ?? null;
    }
    if (!uid) return json({
      error: "Unauthorized"
    }, 401);
    const { data: profile } = await supabase.from("profiles").select("role, company_id, media_buyer_id, display_name").eq("id", uid).maybeSingle();
    const isAdmin = !!profile && ["owner", "admin"].includes(profile.role);
    const isBuyer = !!profile && profile.role === "buyer" && !!profile.media_buyer_id;
    if (!isAdmin && !isBuyer) return json({
      error: "Unauthorized"
    }, 401);
    const mode = body_mode === "meta" ? "meta" : "bank";
    // A media buyer can only pay out to a bank account in their own name; Meta is reached through the buyer's Send to Meta flow.
    if (isBuyer && !isAdmin && mode === "meta") return json({ error: "Use Send to Meta." }, 403);
    const resolved = await paystackFetch(`/bank/resolve?account_number=${encodeURIComponent(account_number)}&bank_code=${encodeURIComponent(bank_code)}`);
    const accountName = resolved?.data?.account_name ?? "";
    if (!accountName) return json({
      error: "Could not verify this account. Double-check the account number and bank."
    }, 400);
    const norm = (v)=>String(v ?? "").toLowerCase().replace(/[^a-z\s]/g, "").trim();
    const sameName = (a, b)=>{
      if (!a || !b) return false;
      const ta = a.split(/\s+/).filter(Boolean), tb = b.split(/\s+/).filter(Boolean), [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
      const shared = small.filter((w)=>big.includes(w)).length;
      return shared === small.length && (shared >= 2 || small.length === 1);
    };
    if (isBuyer && !isAdmin) {
      const { data: mb } = await supabase.from("media_buyers").select("name").eq("id", profile.media_buyer_id).maybeSingle();
      const mine = [norm(profile.display_name), norm(mb?.name)].filter(Boolean);
      if (!mine.some((m)=>sameName(norm(accountName), m))) return json({
        error: `That account is in the name "${accountName}". You can only withdraw to a bank account in your own name (${profile.display_name || mb?.name || "your profile name"}).`
      }, 403);
    }
    if (mode === "meta") {
      const { data: allowedRows } = await supabase.from("transfer_allowed_names").select("name_key").eq("company_id", profile.company_id);
      const hasList = (allowedRows ?? []).length > 0, key = accountName.trim().toLowerCase().replace(/\s+/g, " ");
      const okName = hasList ? (allowedRows ?? []).some((x)=>x.name_key === key) : /(facebook|meta)/i.test(accountName);
      if (!okName) return json({ error: `The bank says this account belongs to "${accountName}", which is not Meta or Facebook.` }, 403);
    }
    const bankList = await paystackFetch("/bank?country=nigeria").catch(()=>({
        data: []
      }));
    const bankName = (bankList?.data ?? []).find((b)=>b.code === bank_code)?.name ?? bank_code;
    // Reserve the money (and Revora's transfer fee) first, so a second tap cannot spend it again.
    const { data: feeData } = await supabase.rpc("rv_fee", { p_kind: "transfer", p_amount: Number(amount_naira) });
    const fee = Number(feeData ?? 0);
    const { data: wid, error: resErr } = await supabase.rpc("rv_withdraw_reserve", { p_user: uid, p_amount: Number(amount_naira), p_fee: fee, p_acct: account_number, p_bank_code: bank_code, p_bank_name: bankName, p_acct_name: accountName });
    if (resErr || !wid) return json({
      error: String(resErr?.message ?? "Could not reserve the money.").replace(/^.*?:\s*/, "")
    }, 400);
    try {
      const recipient = await paystackFetch("/transferrecipient", {
        method: "POST",
        body: JSON.stringify({
          type: "nuban",
          name: accountName,
          account_number,
          bank_code,
          currency: "NGN",
          description: mode === "meta" ? "Meta ads top-up" : "Withdrawal"
        })
      });
      const transfer = await paystackFetch("/transfer", {
        method: "POST",
        body: JSON.stringify({
          source: "balance",
          amount: Math.round(Number(amount_naira) * 100),
          recipient: recipient?.data?.recipient_code,
          ...ref ? {
            reference: ref
          } : {},
          reason: `${mode === "meta" ? "Meta top-up" : "Withdrawal"} for ${profile.company_id}`
        })
      });
      // Paystack answers status "otp" when the account still asks for a one-time code on every transfer: the money does NOT move.
      if (transfer?.data?.status === "otp") throw new Error("Paystack is waiting for an OTP, so the money was not sent. Turn off OTP for transfers in Paystack (Settings, Preferences, Transfers), then try again.");
      await supabase.from("admin_withdrawals").update({
        status: "sent",
        paystack_transfer_code: transfer?.data?.transfer_code ?? null,
        paystack_transfer_reference: transfer?.data?.reference ?? null,
        sent_at: new Date().toISOString()
      }).eq("id", wid);
      // Revora's transfer fee comes off the wallet the money left.
      if (fee > 0) await supabase.rpc("rv_take_fee", { p_kind: "transfer", p_company: profile.company_id, p_buyer: isBuyer && !isAdmin ? profile.media_buyer_id : null, p_user: uid, p_amount: Number(amount_naira), p_fee: fee, p_ref: String(wid), p_note: mode === "meta" ? "Transfer fee on send to Meta" : "Transfer fee on withdrawal" });
      // One receipt per transfer. The webhook moves it to delivered or failed when the bank confirms.
      await supabase.from("transfer_receipts").insert({
        company_id: profile.company_id,
        user_id: uid,
        kind: mode === "meta" ? "meta" : "transfer",
        source: source === "assistant" ? "assistant" : "dashboard",
        amount_naira,
        account_name: accountName,
        account_number,
        bank_name: bankName,
        status: "processing",
        paystack_transfer_code: transfer?.data?.transfer_code ?? null,
        paystack_reference: transfer?.data?.reference ?? null,
        approved_with: approved_with === "pin" ? "Transfer PIN" : "Revora login"
      }).then(()=>{}, ()=>{});
      const { data: rc } = await supabase.from("transfer_receipts").select("id, receipt_no, created_at").eq("paystack_transfer_code", transfer?.data?.transfer_code ?? "").maybeSingle();
      return json({
        ok: true,
        transfer_code: transfer?.data?.transfer_code,
        reference: transfer?.data?.reference,
        account_name: accountName,
        bank_name: bankName,
        withdrawal_id: wid,
        fee,
        receipt: rc ?? null
      });
    } catch (transferErr) {
      // The bank was not paid: release the reserved money.
      await supabase.from("admin_withdrawals").update({ status: "failed", transfer_error: transferErr.message }).eq("id", wid);
      return json({
        error: `Transfer failed: ${transferErr.message}`
      }, 502);
    }
  } catch (err) {
    console.error("paystack-admin-withdraw error:", err);
    return json({
      error: err.message
    }, 500);
  }
});
