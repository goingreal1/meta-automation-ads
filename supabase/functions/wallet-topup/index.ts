import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Top-ups for Revora-provided ad accounts. Spend on a Revora account is paid from the wallet of the media buyer it is shared
// with (or from the company wallet when it is held by an owner/admin). Personal ad accounts keep the old request-and-send flow.
//
//   POST { action: "overview" }                                   -> my wallet, (admin) company wallet + every buyer's wallet, recent top-ups
//   POST { action: "start", amount, target?, return_url? }        -> { authorization_url, reference }   target: "company" or a media_buyer id (admin); a buyer always tops up their own
//   POST { action: "verify", reference }                          -> credits the wallet once Paystack confirms (safe to call twice)
//   POST { action: "allocate", buyer_id, amount }                 -> admin moves money from the company wallet to a buyer's wallet
//   POST { action: "take_back", buyer_id, amount }                -> admin moves unused money from a buyer's wallet back to the company wallet
//   POST { action: "request", amount, note? }                     -> a buyer asks the admin to fund their Revora wallet
//   POST { action: "decide", id, decision: "approve"|"decline" }  -> admin answers; approving moves the money from the company wallet straight into the buyer's wallet
//   POST (x-cron-secret) { action: "sweep" }                      -> confirms top-ups whose buyer closed the page before it redirected back
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const PAYSTACK_BASE = "https://api.paystack.co";
const MIN = 1000, MAX = 2_000_000;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, x-cron-secret" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

// Confirms one pending top-up with Paystack. Only the first caller flips pending -> confirmed, so a repeat can never credit twice.
async function settle(ref: string): Promise<{ ok: boolean; status: string }> {
  const { data: row } = await admin.from("wallet_topups").select("id, amount_naira, status, company_id, media_buyer_id").eq("reference", ref).maybeSingle();
  if (!row) return { ok: false, status: "unknown" };
  if (row.status === "confirmed") return { ok: true, status: "confirmed" };
  const r = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(ref)}`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } });
  const d: any = await r.json().catch(() => null);
  const t = d?.data;
  if (!r.ok || !t) return { ok: false, status: "pending" };
  if (t.status !== "success") return { ok: false, status: String(t.status ?? "pending") };
  if (Number(t.amount) / 100 < Number(row.amount_naira)) return { ok: false, status: "amount_mismatch" };
  const { data: won } = await admin.from("wallet_topups").update({ status: "confirmed", confirmed_at: new Date().toISOString(), channel: t.channel ?? null }).eq("id", row.id).eq("status", "pending").select("id");
  // A top-up for the company wallet is also written as an ordinary company deposit, so every existing wallet screen counts it.
  if (won?.length && !row.media_buyer_id) {
    await admin.from("payments").insert({ company_id: row.company_id, order_id: null, media_buyer_id: null, amount_naira: Number(row.amount_naira), status: "confirmed", source: "admin_topup", channel: t.channel ?? "card", paid_at: new Date().toISOString(), paystack_reference: ref, raw_event: t });
  }
  return { ok: true, status: "confirmed" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!PAYSTACK_SECRET_KEY) return json({ error: "Payments are not switched on yet." }, 500);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const action = String(b?.action ?? "overview");

  if (action === "sweep") {
    const { data: sec } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
    const given = req.headers.get("x-cron-secret") || "";
    if (!given || (given !== sec?.value && given !== CRON_SECRET)) return json({ error: "Unauthorized" }, 401);
    const since = new Date(Date.now() - 3 * 86400_000).toISOString();
    await admin.from("wallet_topups").update({ status: "expired" }).eq("status", "pending").lt("created_at", since);
    const { data: pend } = await admin.from("wallet_topups").select("reference").eq("status", "pending").order("created_at", { ascending: false }).limit(40);
    let confirmed = 0;
    for (const p of pend ?? []) { const s = await settle(p.reference); if (s.ok) confirmed++; }
    return json({ ok: true, checked: pend?.length ?? 0, confirmed });
  }

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = jwt ? await admin.auth.getUser(jwt) : { data: null as any };
  if (!u?.user) return json({ error: "Not signed in." }, 401);
  const { data: me } = await admin.from("profiles").select("id, role, company_id, media_buyer_id").eq("id", u.user.id).maybeSingle();
  if (!me?.company_id) return json({ error: "Finish setting up your workspace first." }, 400);
  const isAdmin = me.role === "owner" || me.role === "admin";
  if (!isAdmin && me.role !== "buyer") return json({ error: "Not allowed." }, 403);

  const buyerOk = async (id: string) => {
    const { data } = await admin.from("media_buyers").select("id, name").eq("id", id).eq("company_id", me.company_id).maybeSingle();
    return data;
  };

  try {
    if (action === "overview") {
      const out: any = { role: me.role };
      if (me.role === "buyer" && me.media_buyer_id) {
        const { data: w } = await admin.rpc("buyer_wallet_balance", { p_buyer: me.media_buyer_id });
        out.my_wallet = Number(w ?? 0);
      }
      if (isAdmin) {
        const { data: cw } = await admin.rpc("company_wallet_balance", { p_company: me.company_id });
        out.company_wallet = Number(cw ?? 0);
        const { data: buyers } = await admin.from("media_buyers").select("id, name, code, active").eq("company_id", me.company_id);
        const { data: teamBuyerProfiles } = await admin.from("profiles").select("media_buyer_id").eq("company_id", me.company_id).eq("role", "buyer");
        const team = new Set((teamBuyerProfiles ?? []).map((p: any) => p.media_buyer_id));
        out.buyers = [];
        for (const x of (buyers ?? []).filter((x: any) => team.has(x.id))) {
          const [{ data: bal }, { data: spent }] = await Promise.all([admin.rpc("buyer_wallet_balance", { p_buyer: x.id }), admin.rpc("buyer_billed_spend", { p_buyer: x.id })]);
          out.buyers.push({ id: x.id, name: x.name, code: x.code, active: x.active !== false, balance: Number(bal ?? 0), spent: Number(spent ?? 0) });
        }
      }
      let q = admin.from("wallet_topups").select("reference, amount_naira, status, media_buyer_id, created_at, confirmed_at").eq("company_id", me.company_id).order("created_at", { ascending: false }).limit(15);
      if (!isAdmin) q = q.eq("media_buyer_id", me.media_buyer_id ?? "00000000-0000-0000-0000-000000000000");
      out.topups = (await q).data ?? [];
      let rq = admin.from("wallet_requests").select("id, media_buyer_id, amount_naira, note, status, requested_at, decided_at").eq("company_id", me.company_id).order("requested_at", { ascending: false }).limit(20);
      if (!isAdmin) rq = rq.eq("media_buyer_id", me.media_buyer_id ?? "00000000-0000-0000-0000-000000000000");
      out.requests = (await rq).data ?? [];
      return json({ ok: true, ...out });
    }

    if (action === "start") {
      const amount = Math.round(Number(b?.amount));
      if (!Number.isFinite(amount) || amount < MIN || amount > MAX) return json({ error: `Top up between ₦${MIN.toLocaleString("en-NG")} and ₦${MAX.toLocaleString("en-NG")}.` }, 400);
      let buyerId: string | null = null;
      if (me.role === "buyer") {
        if (!me.media_buyer_id) return json({ error: "Your account is not linked to a media buyer profile yet." }, 400);
        buyerId = me.media_buyer_id;
      } else if (b?.target && b.target !== "company") {
        if (!(await buyerOk(String(b.target)))) return json({ error: "That buyer is not on your team." }, 404);
        buyerId = String(b.target);
      }
      const reference = `wt_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
      const { error: insErr } = await admin.from("wallet_topups").insert({ company_id: me.company_id, media_buyer_id: buyerId, amount_naira: amount, reference, status: "pending", created_by: me.id });
      if (insErr) return json({ error: "Could not start the top-up." }, 500);
      let callback = String(b?.return_url ?? "");
      if (!/^https:\/\/[^\s]+$/.test(callback)) callback = "";
      const r = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
        method: "POST", headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: u.user.email, amount: amount * 100, currency: "NGN", reference, ...(callback ? { callback_url: callback } : {}), metadata: { kind: "wallet_topup", company_id: me.company_id, media_buyer_id: buyerId } }),
      });
      const d: any = await r.json().catch(() => null);
      if (!r.ok || !d?.status) { await admin.from("wallet_topups").update({ status: "failed" }).eq("reference", reference); return json({ error: d?.message || "Could not start the payment." }, 502); }
      return json({ ok: true, authorization_url: d.data.authorization_url, reference, amount_naira: amount });
    }

    if (action === "verify") {
      const ref = String(b?.reference ?? "");
      if (!/^wt_[a-f0-9]{20}$/.test(ref)) return json({ error: "Bad reference." }, 400);
      const { data: row } = await admin.from("wallet_topups").select("company_id, media_buyer_id").eq("reference", ref).maybeSingle();
      if (!row || row.company_id !== me.company_id) return json({ error: "Top-up not found." }, 404);
      if (!isAdmin && row.media_buyer_id !== me.media_buyer_id) return json({ error: "That top-up is not yours." }, 403);
      const s = await settle(ref);
      return json({ ok: s.ok, status: s.status });
    }

    if (action === "request") {
      if (me.role !== "buyer" || !me.media_buyer_id) return json({ error: "Only a media buyer asks for wallet funds." }, 403);
      const amount = Math.round(Number(b?.amount));
      if (!Number.isFinite(amount) || amount < 500 || amount > MAX) return json({ error: "Ask for between ₦500 and ₦2,000,000." }, 400);
      const { count } = await admin.from("wallet_requests").select("id", { count: "exact", head: true }).eq("media_buyer_id", me.media_buyer_id).eq("status", "pending");
      if ((count ?? 0) >= 3) return json({ error: "You already have 3 requests waiting. Wait for your admin to answer them." }, 400);
      const { data: row, error } = await admin.from("wallet_requests").insert({ company_id: me.company_id, media_buyer_id: me.media_buyer_id, amount_naira: amount, note: String(b?.note ?? "").slice(0, 200) || null }).select("id").single();
      if (error || !row) return json({ error: "Could not send the request." }, 500);
      // Tell the owners and admins (best effort).
      const { data: admins } = await admin.from("profiles").select("id").eq("company_id", me.company_id).in("role", ["owner", "admin"]);
      for (const a of admins ?? []) await admin.from("ai_inbox").insert({ company_id: me.company_id, profile_id: a.id, kind: "fund_request", title: `Wallet request: ₦${amount.toLocaleString("en-NG")}`, body: "A media buyer asked for funds for their Revora ad accounts. Open the Wallet tab to approve or decline.", payload: {}, dedupe_key: `wallet_req:${row.id}:${a.id}` }).then(() => {}, () => {});
      return json({ ok: true, id: row.id });
    }

    if (action === "decide") {
      if (!isAdmin) return json({ error: "Only an owner or admin can answer wallet requests." }, 403);
      const id = String(b?.id ?? "");
      const { data: req0 } = await admin.from("wallet_requests").select("id, media_buyer_id, amount_naira, status").eq("id", id).eq("company_id", me.company_id).maybeSingle();
      if (!req0) return json({ error: "Request not found." }, 404);
      if (req0.status !== "pending") return json({ error: `That request is already ${req0.status}.` }, 400);
      if (b?.decision === "decline") {
        await admin.from("wallet_requests").update({ status: "declined", decided_at: new Date().toISOString(), decided_by: me.id }).eq("id", id).eq("status", "pending");
        return json({ ok: true });
      }
      const amount = Number(req0.amount_naira);
      const { data: cw } = await admin.rpc("company_wallet_balance", { p_company: me.company_id });
      if (Number(cw ?? 0) < amount) return json({ error: `The company wallet only has ₦${Math.max(0, Math.round(Number(cw ?? 0))).toLocaleString("en-NG")}. Top it up first.` }, 400);
      // Only the first tap wins, so a double tap can never fund twice.
      const { data: won } = await admin.from("wallet_requests").update({ status: "approved", decided_at: new Date().toISOString(), decided_by: me.id }).eq("id", id).eq("status", "pending").select("id");
      if (!won?.length) return json({ error: "That request was just answered." }, 409);
      const ref = `req:${id}`;
      const { error } = await admin.from("wallet_adjustments").insert([
        { company_id: me.company_id, media_buyer_id: null, amount_naira: amount, reason: "given_to_buyer", ref },
        { company_id: me.company_id, media_buyer_id: req0.media_buyer_id, amount_naira: -amount, reason: "given_by_company", ref },
      ]);
      if (error) { await admin.from("wallet_requests").update({ status: "pending", decided_at: null, decided_by: null }).eq("id", id); return json({ error: "Could not move the money." }, 500); }
      return json({ ok: true });
    }

    if (action === "allocate" || action === "take_back") {
      if (!isAdmin) return json({ error: "Only an owner or admin can move wallet money." }, 403);
      const amount = Math.round(Number(b?.amount));
      if (!Number.isFinite(amount) || amount < 100 || amount > MAX) return json({ error: "Enter an amount between ₦100 and ₦2,000,000." }, 400);
      const buyer = await buyerOk(String(b?.buyer_id ?? ""));
      if (!buyer) return json({ error: "That buyer is not on your team." }, 404);
      const toBuyer = action === "allocate";
      const { data: from } = toBuyer ? await admin.rpc("company_wallet_balance", { p_company: me.company_id }) : await admin.rpc("buyer_wallet_balance", { p_buyer: buyer.id });
      if (Number(from ?? 0) < amount) return json({ error: toBuyer ? `The company wallet only has ₦${Math.max(0, Math.round(Number(from ?? 0))).toLocaleString("en-NG")}. Top it up first.` : `${buyer.name}'s wallet only has ₦${Math.max(0, Math.round(Number(from ?? 0))).toLocaleString("en-NG")}.` }, 400);
      const ref = `move:${crypto.randomUUID()}`;
      const rows = toBuyer
        ? [{ company_id: me.company_id, media_buyer_id: null, amount_naira: amount, reason: "given_to_buyer", ref }, { company_id: me.company_id, media_buyer_id: buyer.id, amount_naira: -amount, reason: "given_by_company", ref }]
        : [{ company_id: me.company_id, media_buyer_id: buyer.id, amount_naira: amount, reason: "taken_back", ref }, { company_id: me.company_id, media_buyer_id: null, amount_naira: -amount, reason: "taken_from_buyer", ref }];
      const { error } = await admin.from("wallet_adjustments").insert(rows);
      if (error) return json({ error: "Could not move the money." }, 500);
      return json({ ok: true });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
