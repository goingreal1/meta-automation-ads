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

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

async function paystackFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.status === false) throw new Error(body?.message || `Paystack ${path} failed (${res.status})`);
  return body;
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
    const { access_token, amount_naira, account_number, bank_code, reference, source, approved_with } = await req.json();
    // Optional caller-chosen reference: Paystack refuses a second transfer with the same one, so a retry can never pay twice.
    const ref = typeof reference === "string" && /^[a-z0-9_-]{16,50}$/.test(reference) ? reference : undefined;
    if (!amount_naira || !account_number || !bank_code) {
      return json({ error: "amount_naira, account_number and bank_code are required" }, 400);
    }

    const { data: userData } = await supabase.auth.getUser(access_token);
    if (!userData?.user) return json({ error: "Unauthorized" }, 401);
    const { data: profile } = await supabase.from("profiles").select("role, company_id").eq("id", userData.user.id).maybeSingle();
    if (!profile || !["owner", "admin"].includes(profile.role)) return json({ error: "Unauthorized" }, 401);

    const resolved = await paystackFetch(`/bank/resolve?account_number=${encodeURIComponent(account_number)}&bank_code=${encodeURIComponent(bank_code)}`);
    const accountName = resolved?.data?.account_name ?? "";
    if (!accountName) return json({ error: "Could not verify this account. Double-check the account number and bank." }, 400);

    const bankList = await paystackFetch("/bank?country=nigeria").catch(() => ({ data: [] }));
    const bankName = (bankList?.data ?? []).find((b: any) => b.code === bank_code)?.name ?? bank_code;

    const recipient = await paystackFetch("/transferrecipient", {
      method: "POST",
      body: JSON.stringify({ type: "nuban", name: accountName, account_number, bank_code, currency: "NGN", description: "Admin withdrawal" }),
    });

    let withdrawalRow: any;
    try {
      const transfer = await paystackFetch("/transfer", {
        method: "POST",
        body: JSON.stringify({
          source: "balance",
          amount: Math.round(Number(amount_naira) * 100),
          recipient: recipient?.data?.recipient_code,
          ...(ref ? { reference: ref } : {}),
          reason: `Admin withdrawal for ${profile.company_id}`,
        }),
      });
      // Paystack answers status "otp" when the account still asks for a one-time code on every transfer: the money does NOT move.
      if (transfer?.data?.status === "otp") throw new Error("Paystack is waiting for an OTP, so the money was not sent. Turn off OTP for transfers in Paystack (Settings, Preferences, Transfers), then try again.");
      const { data } = await supabase.from("admin_withdrawals").insert({
        company_id: profile.company_id,
        amount_naira,
        destination_account_number: account_number,
        destination_bank_code: bank_code,
        destination_bank_name: bankName,
        destination_account_name: accountName,
        status: "sent",
        paystack_transfer_code: transfer?.data?.transfer_code ?? null,
        paystack_transfer_reference: transfer?.data?.reference ?? null,
        created_by: userData.user.id,
        sent_at: new Date().toISOString(),
      }).select().single();
      withdrawalRow = data;
      // One receipt per transfer. The webhook moves it to delivered or failed when the bank confirms.
      await supabase.from("transfer_receipts").insert({
        company_id: profile.company_id, user_id: userData.user.id, kind: "transfer", source: source === "assistant" ? "assistant" : "dashboard",
        amount_naira, account_name: accountName, account_number, bank_name: bankName, status: "processing",
        paystack_transfer_code: transfer?.data?.transfer_code ?? null, paystack_reference: transfer?.data?.reference ?? null,
        approved_with: approved_with === "pin" ? "Transfer PIN" : "Revora login",
      }).then(() => {}, () => {});
      const { data: rc } = await supabase.from("transfer_receipts").select("id, receipt_no, created_at").eq("paystack_transfer_code", transfer?.data?.transfer_code ?? "").maybeSingle();
      return json({ ok: true, transfer_code: transfer?.data?.transfer_code, reference: transfer?.data?.reference, account_name: accountName, bank_name: bankName, withdrawal_id: withdrawalRow?.id, receipt: rc ?? null });
    } catch (transferErr: any) {
      await supabase.from("admin_withdrawals").insert({
        company_id: profile.company_id,
        amount_naira,
        destination_account_number: account_number,
        destination_bank_code: bank_code,
        destination_bank_name: bankName,
        destination_account_name: accountName,
        status: "failed",
        transfer_error: transferErr.message,
        created_by: userData.user.id,
      });
      return json({ error: `Transfer failed: ${transferErr.message}` }, 502);
    }
  } catch (err: any) {
    console.error("paystack-admin-withdraw error:", err);
    return json({ error: err.message }, 500);
  }
});
