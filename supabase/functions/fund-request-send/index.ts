import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// The owner/admin's side of a funding request, from the dashboard.
//   POST { action: "send", fund_request_id, pin }   -> checks the admin's transfer PIN, then sends the money in one step
//                                                       (paystack-transfer-to-meta re-verifies the account name first) -> { ok, receipt, account_name } | { verified:false, reason } | { error }
//   POST { action: "recheck", fund_request_id }     -> asks the bank who owns the account now (no money moves) -> { verified, account_name, reason? }
// The signed-in admin's login is required. Buyers cannot call this.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const PIN_RE = /^\d{4,6}$/;
const safeEq = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
async function pinHash(userId: string, pin: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const mk = await crypto.subtle.importKey("raw", enc.encode(SERVICE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const peppered = new Uint8Array(await crypto.subtle.sign("HMAC", mk, enc.encode(`${userId}:${pin}`)));
  const base = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g) ?? [], (h) => parseInt(h, 16));
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, base, 256));
  return Array.from(bits).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function checkPin(userId: string, pin: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: row } = await admin.from("transfer_pins").select("pin_hash, salt, failed_attempts, locked_until").eq("user_id", userId).maybeSingle();
  if (!row) return { ok: false, error: "No transfer PIN is set yet. Set one under Settings, Security." };
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) return { ok: false, error: "Too many wrong PINs. Try again in a few minutes." };
  if (safeEq(await pinHash(userId, pin, row.salt), row.pin_hash)) {
    if (row.failed_attempts || row.locked_until) await admin.from("transfer_pins").update({ failed_attempts: 0, locked_until: null }).eq("user_id", userId);
    return { ok: true };
  }
  const n = Number(row.failed_attempts || 0) + 1, lock = n >= 5;
  await admin.from("transfer_pins").update({ failed_attempts: lock ? 0 : n, locked_until: lock ? new Date(Date.now() + 15 * 60_000).toISOString() : null }).eq("user_id", userId);
  return { ok: false, error: lock ? "Too many wrong PINs. Locked for 15 minutes." : `Wrong PIN. ${5 - n} ${5 - n === 1 ? "try" : "tries"} left.` };
}
const normName = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = token ? await admin.auth.getUser(token) : { data: null as any };
  if (!u?.user) return json({ error: "Not signed in." }, 401);
  const { data: me } = await admin.from("profiles").select("id, role, company_id").eq("id", u.user.id).maybeSingle();
  if (!me?.company_id || (me.role !== "owner" && me.role !== "admin")) return json({ error: "Only an owner or admin can do this." }, 403);
  if (b?.action === "set_auto") {
    // Turn auto-approve on or off for one buyer. It needs the admin's transfer PIN, and a per-request and a daily limit.
    const bid = String(b?.media_buyer_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(bid)) return json({ error: "Pick a media buyer." }, 400);
    const { data: mb } = await admin.from("media_buyers").select("id").eq("id", bid).eq("company_id", me.company_id).maybeSingle();
    if (!mb) return json({ error: "Media buyer not found." }, 404);
    const pin = String(b?.pin ?? "");
    if (!PIN_RE.test(pin)) return json({ error: "Enter your 4 to 6 digit transfer PIN." }, 400);
    const p = await checkPin(me.id, pin);
    if (!p.ok) return json({ error: p.error }, 403);
    if (b?.enabled === false) {
      await admin.from("media_buyers").update({ auto_send_enabled: false, auto_send_set_by: me.id, auto_send_set_at: new Date().toISOString() }).eq("id", bid);
      return json({ ok: true, enabled: false });
    }
    const max = Math.round(Number(b?.max_naira)), dayMax = Math.round(Number(b?.daily_max_naira));
    if (!Number.isFinite(max) || max < 100 || max > 5_000_000) return json({ error: "Set a per-request limit between ₦100 and ₦5,000,000." }, 400);
    if (!Number.isFinite(dayMax) || dayMax < max || dayMax > 20_000_000) return json({ error: "Set a daily limit that is at least the per-request limit (up to ₦20,000,000)." }, 400);
    await admin.from("media_buyers").update({ auto_send_enabled: true, auto_send_max_naira: max, auto_send_daily_max_naira: dayMax, auto_send_set_by: me.id, auto_send_set_at: new Date().toISOString() }).eq("id", bid);
    return json({ ok: true, enabled: true, max_naira: max, daily_max_naira: dayMax });
  }
  const id = String(b?.fund_request_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Bad request id." }, 400);
  const { data: fr } = await admin.from("fund_requests").select("*").eq("id", id).eq("company_id", me.company_id).maybeSingle();
  if (!fr) return json({ error: "Request not found." }, 404);
  const action = String(b?.action ?? "send");

  if (action === "recheck") {
    if (!fr.req_account_number || !fr.req_bank_code) return json({ error: "This request has no Meta account number." }, 400);
    let name = "";
    try {
      const r = await fetch(`https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(fr.req_account_number)}&bank_code=${encodeURIComponent(fr.req_bank_code)}`, { headers: { Authorization: `Bearer ${PAYSTACK_KEY}` } });
      const j: any = await r.json().catch(() => ({}));
      if (r.ok && j?.status !== false) name = String(j?.data?.account_name ?? "");
    } catch { /* treated as not verified */ }
    let reason: string | null = null;
    if (!name) reason = "The bank can no longer verify this account number. It has probably expired: ask the buyer for a fresh one from Ads Manager (Billing, Add funds).";
    else {
      const { data: rows } = await admin.from("transfer_allowed_names").select("name_key").eq("company_id", me.company_id);
      const ok = (rows ?? []).length ? (rows ?? []).some((x: any) => x.name_key === normName(name)) : /(facebook|meta)/i.test(name);
      if (!ok) reason = `The bank says this account belongs to "${name}", which is not Meta.`;
    }
    await admin.from("fund_requests").update(reason ? { last_verify_error: reason, last_verify_at: new Date().toISOString() } : { last_verify_error: null, last_verify_at: new Date().toISOString(), req_verified_at: new Date().toISOString(), req_account_name: name }).eq("id", id);
    return json(reason ? { verified: false, account_name: name || null, reason } : { verified: true, account_name: name });
  }

  if (action === "send") {
    const pin = String(b?.pin ?? "");
    if (!PIN_RE.test(pin)) return json({ error: "Enter your 4 to 6 digit transfer PIN." }, 400);
    if (fr.status !== "pending" && fr.status !== "approved") return json({ error: `This request is ${fr.status}.` }, 400);
    if (!fr.req_account_number) return json({ error: "This request has no Meta account number. Decline it and ask the buyer to send a new one." }, 400);
    const p = await checkPin(me.id, pin);
    if (!p.ok) return json({ error: p.error }, 403);
    const r = await fetch(`${SUPABASE_URL}/functions/v1/paystack-transfer-to-meta`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, "x-internal-key": SERVICE_KEY },
      body: JSON.stringify({ fund_request_id: id, on_behalf_of: me.id, approved_with: "pin", source: "dashboard" }),
    });
    const j: any = await r.json().catch(() => ({ error: "No answer from the payment service." }));
    return json(j, r.ok ? 200 : (r.status === 403 ? 500 : r.status));
  }
  return json({ error: "Unknown action." }, 400);
});
