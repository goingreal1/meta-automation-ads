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
// Only an owner/admin sends money to Meta, and only after their transfer PIN: this function accepts internal callers only
// (mcp-money and fund-request-send, which check the PIN first). A buyer's request carries the Meta account number and bank,
// verified when it was submitted; it is verified AGAIN here, at the moment the admin approves, so an old or changed account is never paid.
//
//   POST { fund_request_id, account_number?, bank_code?, on_behalf_of } ->
//     { ok: true, transfer_code, account_name } | { verified: false, account_name, reason } | { error }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const PAYSTACK_BASE = "https://api.paystack.co";
// Meta billing account names carry "Meta" or "Facebook" (the bank may run words together, e.g. "Facebookads"), so any name containing
// either is accepted. A company can tighten this to an exact list of approved names (transfer_allowed_names, below).
const ALLOWED_NAME_PATTERN = /(facebook|meta)/i;

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

// Fire-and-forget -- this function's own response to the caller shouldn't
// wait on a WhatsApp send either way.
function notifyTransferResult(fundRequestId: string) {
  fetch(`${SUPABASE_URL}/functions/v1/send-internal-whatsapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ type: "transfer_result", fund_request_id: fundRequestId }),
  }).catch((err) => console.error("send-internal-whatsapp (transfer_result) failed:", err));
}

async function authedProfile(req: Request, onBehalfOf?: string): Promise<{ id: string; role: string; media_buyer_id: string | null; company_id: string | null } | null> {
  // The mcp-money function (holding the service key) may send an already PIN-approved top-up on the person's behalf.
  if (onBehalfOf && /^[0-9a-f-]{36}$/i.test(onBehalfOf) && SUPABASE_SERVICE_ROLE_KEY.length > 20 && req.headers.get("x-internal-key") === SUPABASE_SERVICE_ROLE_KEY) {
    const { data: p } = await supabase.from("profiles").select("id, role, media_buyer_id, company_id").eq("id", onBehalfOf).maybeSingle();
    return p ?? null;
  }
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: userData } = await supabase.auth.getUser(token);
  if (!userData?.user) return null;
  const { data: profile } = await supabase.from("profiles").select("id, role, media_buyer_id, company_id").eq("id", userData.user.id).maybeSingle();
  return profile ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-internal-key" },
    });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!PAYSTACK_SECRET_KEY) return json({ error: "PAYSTACK_SECRET_KEY isn't configured yet." }, 500);

  try {
    const { fund_request_id, account_number: acctIn, bank_code: bankIn, source: reqSource, approved_with: reqApprovedWith, on_behalf_of: onBehalfOf } = await req.json();
    if (!fund_request_id) return json({ error: "fund_request_id is required" }, 400);

    const internal = !!onBehalfOf && SUPABASE_SERVICE_ROLE_KEY.length > 20 && req.headers.get("x-internal-key") === SUPABASE_SERVICE_ROLE_KEY;
    if (!internal) return json({ error: "Money is sent only after the admin's transfer PIN is entered. Approve the request with your PIN." }, 403);
    const profile = await authedProfile(req, onBehalfOf);
    if (!profile) return json({ error: "Unauthorized" }, 401);

    const { data: fr } = await supabase.from("fund_requests").select("*").eq("id", fund_request_id).maybeSingle();
    if (!fr) return json({ error: "Funding request not found" }, 404);

    const isAdmin = profile.role === "owner" || profile.role === "admin";
    if (!isAdmin || profile.company_id !== fr.company_id) return json({ error: "Only an owner or admin of this company can send money to Meta." }, 403);
    if (fr.status !== "pending" && fr.status !== "approved") return json({ error: `This request is ${fr.status}, so there is nothing to send.` }, 400);
    if (fr.paystack_transfer_code) return json({ error: "This request already has a transfer attached." }, 400);
    // The account on the request is the one that gets paid. A caller cannot swap in a different one.
    const account_number: string = String(fr.req_account_number ?? acctIn ?? "");
    const bank_code: string = String(fr.req_bank_code ?? bankIn ?? "");
    if (!account_number || !bank_code) return json({ error: "This request has no Meta account number. Ask the buyer to send a new request with the account number and bank." }, 400);
    if (fr.req_account_number && ((acctIn && String(acctIn) !== account_number) || (bankIn && String(bankIn) !== bank_code))) return json({ error: "The account on this request changed. Open the request again." }, 409);
    // The money must be there: pending requests reserve nothing, so the funding wallet must cover this amount now.
    {
      const [{ data: pays }, { data: frs }, { data: wds }] = await Promise.all([
        supabase.from("payments").select("amount_naira, source, media_buyer_id").eq("company_id", fr.company_id).eq("status", "confirmed"),
        supabase.from("fund_requests").select("amount_naira, status").eq("company_id", fr.company_id),
        supabase.from("admin_withdrawals").select("amount_naira, status").eq("company_id", fr.company_id),
      ]);
      const sum = (a: any[]) => a.reduce((t, x) => t + Number(x.amount_naira || 0), 0);
      const topups = sum((pays ?? []).filter((p: any) => !p.media_buyer_id && p.source === "admin_topup"));
      const balance = topups - sum((frs ?? []).filter((f: any) => f.status === "approved")) - sum((frs ?? []).filter((f: any) => f.status === "transferred")) - sum((wds ?? []).filter((w: any) => w.status === "sent"));
      const available = balance + (fr.status === "approved" ? Number(fr.amount_naira) : 0);
      if (Number(fr.amount_naira) > available) return json({ error: `The funding wallet has ₦${Math.max(0, Math.round(available)).toLocaleString("en-NG")}, which cannot cover ₦${Math.round(Number(fr.amount_naira)).toLocaleString("en-NG")}. Add funds first.` }, 400);
    }

    const { data: buyer } = await supabase.from("media_buyers").select("id, name").eq("id", fr.media_buyer_id).maybeSingle();
    if (!buyer) return json({ error: "Media buyer not found" }, 404);

    // Resolve the account fresh every time -- it's only valid for the next
    // ~30 minutes anyway, so nothing about this result gets saved for reuse.
    const stale = async (reason: string, name?: string) => {
      await supabase.from("fund_requests").update({ last_verify_error: reason, last_verify_at: new Date().toISOString() }).eq("id", fr.id);
      return json({ verified: false, account_name: name ?? null, reason });
    };
    let accountName = "";
    try { accountName = String((await paystackFetch(`/bank/resolve?account_number=${encodeURIComponent(account_number)}&bank_code=${encodeURIComponent(bank_code)}`))?.data?.account_name ?? ""); }
    catch { return await stale("The bank can no longer verify this Meta account number. It has probably expired. Nothing was sent: ask the buyer for a fresh account number from Ads Manager (Billing, Add funds)."); }
    if (!accountName) return await stale("The bank did not return a name for this account. Nothing was sent: ask the buyer for a fresh account number.");
    // Fixed list: when the company has approved specific Meta payment account names (Settings -> Business & team), the
    // resolved name must be exactly one of them. Until a company sets a list, the strict Facebook/Meta name pattern applies.
    const normName = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
    const { data: allowedRows } = await supabase.from("transfer_allowed_names").select("name_key").eq("company_id", fr.company_id);
    const hasList = (allowedRows ?? []).length > 0;
    const nameOk = hasList ? (allowedRows ?? []).some((a: any) => a.name_key === normName(accountName)) : ALLOWED_NAME_PATTERN.test(accountName);
    if (!nameOk) {
      return await stale(hasList
        ? `The bank resolved this account to "${accountName}", which isn't on your approved list of Meta payment accounts. If it really is Meta's billing account, an owner/admin can approve that exact name in Settings → Business & team, then try again.`
        : "This account isn't registered to Facebook/Meta -- we only accept transfers into Meta's own ad billing account. Double check you copied today's top-up account number from Ads Manager, not an old one.", accountName);
    }

    const bankList = await paystackFetch("/bank?country=nigeria").catch(() => ({ data: [] }));
    const bankName = (bankList?.data ?? []).find((b: any) => b.code === bank_code)?.name ?? bank_code;

    // Claim this attempt. Two sends at the same moment cannot both pass: only one wins the counter. The first attempt keeps the
    // plain reference; if a transfer later fails and the admin sends again, the next attempt gets a new reference.
    const attempt = Number(fr.send_attempts ?? 0);
    const { data: claimed } = await supabase.from("fund_requests").update({ send_attempts: attempt + 1 }).eq("id", fr.id).eq("send_attempts", attempt).select("id");
    if (!claimed?.length) return json({ error: "A send for this request is already in progress. Refresh and check its status." }, 409);

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
          // A fixed reference per request: Paystack refuses a second transfer with the same reference, so two
          // simultaneous clicks (or a replayed request) can never pay the same request twice.
          reference: attempt === 0 ? `rv${String(fr.id).replace(/-/g, "")}` : `rv${String(fr.id).replace(/-/g, "")}_${attempt + 1}`,
          reason: `Meta Ads top-up for ${buyer.name} (request ${fr.id})`,
        }),
      });
      // Paystack answers status "otp" when the account still asks for a one-time code on every transfer: the money does NOT move.
      if (transfer?.data?.status === "otp") throw new Error("Paystack is waiting for an OTP, so the money was not sent. Turn off OTP for transfers in Paystack (Settings, Preferences, Transfers), then try again.");
    } catch (transferErr: any) {
      await supabase.from("fund_requests").update({
        transfer_error: transferErr.message,
        destination_account_number: account_number,
        destination_bank_code: bank_code,
        destination_bank_name: bankName,
        destination_account_name: accountName,
      }).eq("id", fr.id);
      notifyTransferResult(fr.id);
      return json({ error: `Transfer failed: ${transferErr.message}` }, 502);
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
      destination_account_name: accountName,
    }).eq("id", fr.id);
    if (updErr) throw updErr;
    notifyTransferResult(fr.id);
    // One receipt per transfer. The webhook moves it to delivered or failed when the bank confirms.
    await supabase.from("transfer_receipts").insert({
      company_id: fr.company_id, user_id: profile.id, kind: "meta", source: reqSource === "assistant" ? "assistant" : "dashboard",
      amount_naira: fr.amount_naira, account_name: accountName, account_number, bank_name: bankName, status: "processing",
      paystack_transfer_code: transfer?.data?.transfer_code ?? null, paystack_reference: transfer?.data?.reference ?? null,
      approved_with: reqApprovedWith === "pin" ? "Transfer PIN" : "Revora login",
    }).then(() => {}, () => {});
    const { data: rc } = await supabase.from("transfer_receipts").select("id, receipt_no, created_at").eq("paystack_transfer_code", transfer?.data?.transfer_code ?? "").maybeSingle();

    return json({ ok: true, transfer_code: transfer?.data?.transfer_code, reference: transfer?.data?.reference, account_name: accountName, bank_name: bankName, receipt: rc ?? null });
  } catch (err: any) {
    console.error("paystack-transfer-to-meta error:", err);
    return json({ error: err.message }, 500);
  }
});
