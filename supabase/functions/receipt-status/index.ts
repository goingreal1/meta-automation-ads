import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Receipt status that does not depend on Paystack's webhook: for a receipt still "processing" it asks Paystack directly
// (GET /transfer/verify/:reference) and updates the receipt. The receipt id is a random UUID, so it works like a private link.
//   GET ?id=<receipt uuid>  ->  { status, paystack_status, paystack_message, ...receipt }
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "content-type, authorization, apikey" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const naira = (n: unknown) => "₦" + Math.round(Number(n) || 0).toLocaleString("en-NG");
const receiptNo = (n: unknown, at: unknown) => `RV-${new Date(String(at ?? Date.now())).getUTCFullYear()}-${String(n ?? 0).padStart(6, "0")}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const id = String(new URL(req.url).searchParams.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "not_found" }, 404);
  const cols = "id, receipt_no, kind, amount_naira, account_name, account_number, bank_name, status, failure_reason, approved_with, paystack_transfer_code, paystack_reference, created_at, updated_at";
  const { data: r } = await admin.from("transfer_receipts").select(cols).eq("id", id).maybeSingle();
  if (!r) return json({ error: "not_found" }, 404);
  let status = r.status, why = r.failure_reason, pst: string | null = null, pmsg: string | null = null;

  if (r.status === "processing" && r.paystack_reference && PAYSTACK_KEY) {
    try {
      const v = await fetch(`https://api.paystack.co/transfer/verify/${encodeURIComponent(r.paystack_reference)}`, { headers: { Authorization: `Bearer ${PAYSTACK_KEY}` } });
      const j: any = await v.json().catch(() => ({}));
      pst = j?.data?.status ?? null; pmsg = j?.message ?? null;
      const next = pst === "success" ? "delivered" : pst === "failed" || pst === "reversed" ? "failed" : null;
      if (next) {
        status = next; why = next === "failed" ? String(j?.data?.reason ?? j?.data?.failures ?? pst).slice(0, 200) : null;
        await admin.from("transfer_receipts").update({ status: next, failure_reason: why, updated_at: new Date().toISOString() }).eq("id", r.id).eq("status", "processing");
        if (next === "failed" && r.paystack_transfer_code) {
          // The money did not arrive: give it back to the wallet / let the funding request be sent again.
          await admin.from("admin_withdrawals").update({ status: "failed", transfer_error: why }).eq("paystack_transfer_code", r.paystack_transfer_code).eq("status", "sent");
          await admin.from("fund_requests").update({ status: "approved", paystack_transfer_code: null, paystack_transfer_reference: null, transferred_at: null, transfer_error: why }).eq("paystack_transfer_code", r.paystack_transfer_code).eq("status", "transferred");
        }
      }
    } catch (e) { pmsg = (e as Error).message; }
  }
  return json({ id: r.id, receipt_no: receiptNo(r.receipt_no, r.created_at), kind: r.kind, amount: naira(r.amount_naira), amount_naira: Number(r.amount_naira), account_name: r.account_name, account_number: r.account_number, bank: r.bank_name, status, failure_reason: why, approved_with: r.approved_with, reference: r.paystack_reference, created_at: r.created_at, updated_at: r.updated_at, paystack_status: pst, paystack_message: pmsg });
});
