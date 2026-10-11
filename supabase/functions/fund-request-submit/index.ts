import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// A media buyer asks for ad funding: amount + the Meta ad-billing account number and bank (from Ads Manager, Billing, Add funds).
// Revora asks the bank who owns that account right now and only accepts Meta or Facebook (or a name on the company's approved list).
// The request then waits for an owner/admin, who approves it with their transfer PIN; that approval is what sends the money.
// Buyers can never send money themselves.
//
//   POST { action?: "submit" (default), amount_naira, account_number, bank_code, note }       -> { ok, id, account_name } | { verified:false, reason } | { error }
//   POST { action: "change_account", fund_request_id, account_number, bank_code }              -> same, for the buyer's own pending request
//   POST { action: "cancel", fund_request_id }                                                 -> { ok }
// Called by the dashboard (signed-in buyer) or by mcp-money (service key + on_behalf_of).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const NAME_PATTERN = /(facebook|meta)/i;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-internal-key, x-client-info" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

async function ps(path: string) {
  if (!PAYSTACK_KEY) throw new Error("Payments are not switched on yet.");
  const r = await fetch(`https://api.paystack.co${path}`, { headers: { Authorization: `Bearer ${PAYSTACK_KEY}` } });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j?.status === false) throw new Error(j?.message || `Paystack failed (${r.status})`);
  return j;
}
const normName = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");

// Who owns this account at the bank, and is it a Meta/Facebook account (or on the company's approved list)?
async function verify(companyId: string, accountNumber: string, bankCode: string): Promise<{ ok: boolean; name?: string; bank?: string; reason?: string }> {
  let name = "";
  try { name = String((await ps(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`))?.data?.account_name ?? ""); }
  catch { return { ok: false, reason: "The bank could not verify that account. Check the number and bank, and copy today's account number from Ads Manager (Billing, Add funds)." }; }
  if (!name) return { ok: false, reason: "The bank did not return an account name. Check the number and bank." };
  const { data: rows } = await admin.from("transfer_allowed_names").select("name_key").eq("company_id", companyId);
  const hasList = (rows ?? []).length > 0;
  const okName = hasList ? (rows ?? []).some((x: any) => x.name_key === normName(name)) : NAME_PATTERN.test(name);
  if (!okName) return { ok: false, name, reason: hasList ? `The bank says this account is "${name}", which is not on your approved list of Meta payment accounts.` : `The bank says this account belongs to "${name}", which is not Meta or Facebook. Copy today's account number from Ads Manager (Billing, Add funds).` };
  const banks = await ps("/bank?country=nigeria&perPage=200").catch(() => ({ data: [] }));
  const bank = ((banks as any)?.data ?? []).find((b: any) => b.code === bankCode)?.name ?? bankCode;
  return { ok: true, name, bank };
}

async function caller(req: Request, onBehalf?: string) {
  if (onBehalf && /^[0-9a-f-]{36}$/i.test(onBehalf) && SERVICE_KEY.length > 20 && req.headers.get("x-internal-key") === SERVICE_KEY) {
    const { data: p } = await admin.from("profiles").select("id, role, company_id, media_buyer_id").eq("id", onBehalf).maybeSingle(); return p;
  }
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return null;
  const { data: p } = await admin.from("profiles").select("id, role, company_id, media_buyer_id").eq("id", u.user.id).maybeSingle();
  return p;
}
const notify = (id: string) => { for (const f of ["send-internal-whatsapp", "send-internal-email"]) fetch(`${SUPABASE_URL}/functions/v1/${f}`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "fund_request_submitted", fund_request_id: id }) }).catch(() => {}); };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const me = await caller(req, b?.on_behalf_of);
  if (!me?.company_id) return json({ error: "Not signed in." }, 401);
  if (me.role !== "buyer" || !me.media_buyer_id) return json({ error: "Only a media buyer asks for ad funding." }, 403);
  const action = String(b?.action ?? "submit");

  if (action === "cancel") {
    const id = String(b?.fund_request_id ?? "");
    const { data, error } = await admin.from("fund_requests").update({ status: "declined", decided_at: new Date().toISOString(), transfer_error: "Cancelled by the buyer" }).eq("id", id).eq("media_buyer_id", me.media_buyer_id).eq("company_id", me.company_id).eq("status", "pending").select("id");
    if (error) return json({ error: "Could not cancel." }, 500);
    return data?.length ? json({ ok: true }) : json({ error: "That request is not open any more." }, 404);
  }

  const accountNumber = String(b?.account_number ?? "").replace(/\s+/g, ""), bankCode = String(b?.bank_code ?? "").trim();
  if (!/^\d{10}$/.test(accountNumber)) return json({ error: "An account number is 10 digits." }, 400);
  if (!bankCode) return json({ error: "Pick the bank shown by Meta." }, 400);
  const v = await verify(me.company_id, accountNumber, bankCode);
  if (!v.ok) return json({ verified: false, account_name: v.name ?? null, reason: v.reason ?? "That account was not accepted." });

  if (action === "change_account") {
    const id = String(b?.fund_request_id ?? "");
    const { data, error } = await admin.from("fund_requests").update({ req_account_number: accountNumber, req_bank_code: bankCode, req_bank_name: v.bank, req_account_name: v.name, req_verified_at: new Date().toISOString(), last_verify_error: null, last_verify_at: new Date().toISOString() }).eq("id", id).eq("media_buyer_id", me.media_buyer_id).eq("company_id", me.company_id).eq("status", "pending").select("id");
    if (error) return json({ error: "Could not update the request." }, 500);
    return data?.length ? json({ ok: true, id, account_name: v.name, bank_name: v.bank }) : json({ error: "That request is not open any more." }, 404);
  }

  const amount = Math.round(Number(b?.amount_naira));
  if (!Number.isFinite(amount) || amount < 100 || amount > 50_000_000) return json({ error: "Give an amount between ₦100 and ₦50,000,000." }, 400);
  const { data: dup } = await admin.from("fund_requests").select("id").eq("company_id", me.company_id).eq("status", "pending").eq("req_account_number", accountNumber).limit(1);
  if (dup?.length) return json({ error: "A request with that account number is already waiting for approval." }, 409);
  const note = String(b?.note ?? "").trim().slice(0, 300) || null;
  const { data: ins, error } = await admin.from("fund_requests").insert({ company_id: me.company_id, media_buyer_id: me.media_buyer_id, amount_naira: amount, note, req_account_number: accountNumber, req_bank_code: bankCode, req_bank_name: v.bank, req_account_name: v.name, req_verified_at: new Date().toISOString() }).select("id").single();
  if (error) return json({ error: error.message }, 500);
  notify(ins.id);
  return json({ ok: true, id: ins.id, account_name: v.name, bank_name: v.bank });
});
