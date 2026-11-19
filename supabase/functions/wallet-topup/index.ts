import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Top-ups for Revora-provided ad accounts. Spend on a Revora account is paid from the wallet of the media buyer it is shared
// with (or from the company wallet when it is held by an owner/admin). Personal ad accounts keep the old request-and-send flow.
//
//   POST { action: "overview" }                                   -> my wallet, (admin) company wallet + every buyer's wallet, recent top-ups, wallet requests
//   POST { action: "start", amount, target?, return_url? }        -> { authorization_url, reference }   target: "company" or a media_buyer id (admin); a buyer always tops up their own
//   POST { action: "verify", reference }                          -> credits the wallet once Paystack confirms (safe to call twice)
//   POST { action: "allocate", buyer_id, amount }                 -> admin moves money from the company wallet to a buyer's wallet
//   POST { action: "take_back", buyer_id, amount }                -> admin moves unused money from a buyer's wallet back to the company wallet
//   POST { action: "request", amount, note? }                     -> a buyer asks the admin to fund their Revora wallet
//   POST { action: "decide", id, decision: "approve"|"decline" }  -> admin answers; approving moves the money from the company wallet straight into the buyer's wallet
//   POST { action: "fees", amount? }                              -> the platform fees; with an amount, what a card top-up would cost and what would land
//   POST { action: "lookup", key }                                -> find a Revora user by phone number or email (exact match, masked)
//   POST { action: "send", to_user, amount, pin, note? }          -> wallet to wallet, any company, charged the wallet fee
//   POST { action: "activity", limit?, before? }                  -> the movements on my wallet, fees folded into each line
//   POST (x-cron-secret) { action: "sweep" }                      -> confirms top-ups whose buyer closed the page before it redirected back
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const PAYSTACK_BASE = "https://api.paystack.co";
const MIN = 1000, MAX = 2_000_000;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, x-cron-secret"
};
const json = (o, s = 200)=>new Response(JSON.stringify(o), {
    status: s,
    headers: {
      "Content-Type": "application/json",
      ...CORS
    }
  });
// Confirms one pending top-up with Paystack. Only the first caller flips pending -> confirmed, so a repeat can never credit twice.
// Paystack's cut on a card payment in Nigeria: 1.5% + ₦100 (the ₦100 is waived under ₦2,500), at most ₦2,000. The customer pays it on top of the amount.
function paystackCharge(net) {
  const flat = net >= 2500 ? 100 : 0;
  let gross = Math.ceil((net + flat) / 0.985);
  if (gross - net > 2000) gross = net + 2000;
  if (net < 2500) gross = Math.ceil(net / 0.985);
  return gross;
}
const rvFee = async (kind, amount)=>Number((await admin.rpc("rv_fee", { p_kind: kind, p_amount: amount })).data ?? 0);
// Take the deposit fee off a wallet the moment money lands in it. Safe to call twice for the same ref.
async function takeDepositFee(companyId, buyerId, userId, amount, ref, note, kind = "deposit") {
  const fee = await rvFee(kind, amount);
  if (fee > 0) await admin.rpc("rv_take_fee", { p_kind: kind, p_company: companyId, p_buyer: buyerId, p_user: userId, p_amount: amount, p_fee: fee, p_ref: ref, p_note: note });
  return fee;
}
const safeEq = (a, b)=>{
  if (a.length !== b.length) return false;
  let d = 0;
  for(let i = 0; i < a.length; i++)d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
async function pinHash(userId, pin, saltHex) {
  const enc = new TextEncoder();
  const mk = await crypto.subtle.importKey("raw", enc.encode(SERVICE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const peppered = new Uint8Array(await crypto.subtle.sign("HMAC", mk, enc.encode(`${userId}:${pin}`)));
  const base = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g) ?? [], (h)=>parseInt(h, 16));
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, base, 256));
  return Array.from(bits).map((x)=>x.toString(16).padStart(2, "0")).join("");
}
async function checkPin(userId, pin) {
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
async function settle(ref) {
  const { data: row } = await admin.from("wallet_topups").select("id, amount_naira, status, company_id, media_buyer_id, charged_naira, created_by").eq("reference", ref).maybeSingle();
  if (!row) return {
    ok: false,
    status: "unknown"
  };
  if (row.status === "confirmed") return {
    ok: true,
    status: "confirmed"
  };
  const r = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(ref)}`, {
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
    }
  });
  const d = await r.json().catch(()=>null);
  const t = d?.data;
  if (!r.ok || !t) return {
    ok: false,
    status: "pending"
  };
  if (t.status !== "success") return {
    ok: false,
    status: String(t.status ?? "pending")
  };
  if (Number(t.amount) / 100 < Number(row.charged_naira ?? row.amount_naira)) return {
    ok: false,
    status: "amount_mismatch"
  };
  const { data: won } = await admin.from("wallet_topups").update({
    status: "confirmed",
    confirmed_at: new Date().toISOString(),
    channel: t.channel ?? null
  }).eq("id", row.id).eq("status", "pending").select("id");
  // Revora's deposit fee comes off the money that just landed.
  if (won?.length) await takeDepositFee(row.company_id, row.media_buyer_id, row.created_by ?? null, Number(row.amount_naira), ref, "Deposit fee on card top-up");
  // A top-up for the company wallet is also written as an ordinary company deposit, so every existing wallet screen counts it.
  if (won?.length && !row.media_buyer_id) {
    await admin.from("payments").insert({
      company_id: row.company_id,
      order_id: null,
      media_buyer_id: null,
      amount_naira: Number(row.amount_naira),
      status: "confirmed",
      source: "admin_topup",
      channel: t.channel ?? "card",
      paid_at: new Date().toISOString(),
      paystack_reference: ref,
      raw_event: t
    });
  }
  return {
    ok: true,
    status: "confirmed"
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: CORS
  });
  if (req.method !== "POST") return json({
    error: "POST only"
  }, 405);
  let b = {};
  try {
    b = await req.json();
  } catch  {
    return json({
      error: "Bad request"
    }, 400);
  }
  const action = String(b?.action ?? "overview");
  if (["start", "verify", "sweep", "resolve", "peek"].includes(action) && !PAYSTACK_SECRET_KEY) return json({
    error: "Card payments are not switched on yet."
  }, 500);
  if (action === "peek") {
    // Cron-secret only: what Paystack says about one of our references (status, bank response, amount), for diagnosing a failed payment.
    const { data: sec } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
    const given = req.headers.get("x-cron-secret") || "";
    if (!given || given !== sec?.value && given !== CRON_SECRET) return json({ error: "Unauthorized" }, 401);
    if (b?.path) {
      // read-only look at a few Paystack endpoints (a transfer, the balance ledger)
      const path = String(b.path);
      if (!/^\/(transfer\/[A-Za-z0-9_]+|balance|balance\/ledger(\?[a-z_=0-9&]+)?)$/.test(path)) return json({ error: "Path not allowed." }, 400);
      const rr = await fetch(`${PAYSTACK_BASE}${path}`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } });
      return json({ http: rr.status, body: await rr.json().catch(()=>null) });
    }
    const ref = String(b?.reference ?? "");
    const r = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(ref)}`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } });
    const d = await r.json().catch(()=>null);
    const t = d?.data ?? {};
    return json({ http: r.status, message: d?.message, status: t.status, gateway_response: t.gateway_response, amount: t.amount, channel: t.channel, paid_at: t.paid_at, domain: t.domain, fees: t.fees, bank: t.authorization?.bank, card_type: t.authorization?.card_type, country: t.authorization?.country_code, log: (t.log?.history ?? []).slice(-6) });
  }
  if (action === "sweep") {
    const { data: sec } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
    const given = req.headers.get("x-cron-secret") || "";
    if (!given || given !== sec?.value && given !== CRON_SECRET) return json({
      error: "Unauthorized"
    }, 401);
    const since = new Date(Date.now() - 3 * 86400_000).toISOString();
    await admin.from("wallet_topups").update({
      status: "expired"
    }).eq("status", "pending").lt("created_at", since);
    const { data: pend } = await admin.from("wallet_topups").select("reference").eq("status", "pending").order("created_at", {
      ascending: false
    }).limit(40);
    let confirmed = 0;
    for (const p of pend ?? []){
      const s = await settle(p.reference);
      if (s.ok) confirmed++;
    }
    return json({
      ok: true,
      checked: pend?.length ?? 0,
      confirmed
    });
  }
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = jwt ? await admin.auth.getUser(jwt) : {
    data: null
  };
  if (!u?.user) return json({
    error: "Not signed in."
  }, 401);
  const { data: me } = await admin.from("profiles").select("id, role, company_id, media_buyer_id").eq("id", u.user.id).maybeSingle();
  if (!me?.company_id) return json({
    error: "Finish setting up your workspace first."
  }, 400);
  const isAdmin = me.role === "owner" || me.role === "admin";
  if (!isAdmin && me.role !== "buyer") return json({
    error: "Not allowed."
  }, 403);
  const buyerOk = async (id)=>{
    const { data } = await admin.from("media_buyers").select("id, name").eq("id", id).eq("company_id", me.company_id).maybeSingle();
    return data;
  };
  try {
    if (action === "overview") {
      const out = {
        role: me.role
      };
      out.me_wallet = Number((await admin.rpc("rv_wallet_balance_of", { p_user: me.id })).data ?? 0);
      if (me.role === "buyer" && me.media_buyer_id) {
        const { data: w } = await admin.rpc("buyer_wallet_balance", {
          p_buyer: me.media_buyer_id
        });
        out.my_wallet = Number(w ?? 0);
      }
      if (isAdmin) {
        const { data: cw } = await admin.rpc("company_wallet_balance", {
          p_company: me.company_id
        });
        out.company_wallet = Number(cw ?? 0);
        const { data: buyers } = await admin.from("media_buyers").select("id, name, code, active").eq("company_id", me.company_id);
        const { data: teamBuyerProfiles } = await admin.from("profiles").select("media_buyer_id").eq("company_id", me.company_id).eq("role", "buyer");
        const team = new Set((teamBuyerProfiles ?? []).map((p)=>p.media_buyer_id));
        out.buyers = [];
        for (const x of (buyers ?? []).filter((x)=>team.has(x.id))){
          const [{ data: bal }, { data: spent }] = await Promise.all([
            admin.rpc("buyer_wallet_balance", {
              p_buyer: x.id
            }),
            admin.rpc("buyer_billed_spend", {
              p_buyer: x.id
            })
          ]);
          out.buyers.push({
            id: x.id,
            name: x.name,
            code: x.code,
            active: x.active !== false,
            balance: Number(bal ?? 0),
            spent: Number(spent ?? 0)
          });
        }
      }
      let q = admin.from("wallet_topups").select("reference, amount_naira, status, media_buyer_id, created_at, confirmed_at").eq("company_id", me.company_id).order("created_at", {
        ascending: false
      }).limit(15);
      if (!isAdmin) q = q.eq("media_buyer_id", me.media_buyer_id ?? "00000000-0000-0000-0000-000000000000");
      out.topups = (await q).data ?? [];
      let rq = admin.from("wallet_requests").select("id, media_buyer_id, amount_naira, note, status, requested_at, decided_at").eq("company_id", me.company_id).order("requested_at", {
        ascending: false
      }).limit(20);
      if (!isAdmin) rq = rq.eq("media_buyer_id", me.media_buyer_id ?? "00000000-0000-0000-0000-000000000000");
      out.requests = (await rq).data ?? [];
      return json({
        ok: true,
        ...out
      });
    }
    if (action === "start") {
      const amount = Math.round(Number(b?.amount));
      if (!Number.isFinite(amount) || amount < MIN || amount > MAX) return json({
        error: `Top up between ₦${MIN.toLocaleString("en-NG")} and ₦${MAX.toLocaleString("en-NG")}.`
      }, 400);
      let buyerId = null;
      if (me.role === "buyer") {
        if (!me.media_buyer_id) return json({
          error: "Your account is not linked to a media buyer profile yet."
        }, 400);
        buyerId = me.media_buyer_id;
      } else if (b?.target && b.target !== "company") {
        if (!await buyerOk(String(b.target))) return json({
          error: "That buyer is not on your team."
        }, 404);
        buyerId = String(b.target);
      }
      const reference = `wt_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
      const charged = paystackCharge(amount);
      const { error: insErr } = await admin.from("wallet_topups").insert({
        company_id: me.company_id,
        media_buyer_id: buyerId,
        amount_naira: amount,
        charged_naira: charged,
        paystack_fee_naira: charged - amount,
        reference,
        status: "pending",
        created_by: me.id
      });
      if (insErr) return json({
        error: "Could not start the top-up."
      }, 500);
      let callback = String(b?.return_url ?? "");
      if (!/^https:\/\/[^\s]+$/.test(callback)) callback = "";
      const r = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: u.user.email,
          amount: charged * 100,
          currency: "NGN",
          reference,
          ...callback ? {
            callback_url: callback
          } : {},
          metadata: {
            kind: "wallet_topup",
            company_id: me.company_id,
            media_buyer_id: buyerId
          }
        })
      });
      const d = await r.json().catch(()=>null);
      if (!r.ok || !d?.status) {
        await admin.from("wallet_topups").update({
          status: "failed"
        }).eq("reference", reference);
        return json({
          error: d?.message || "Could not start the payment."
        }, 502);
      }
      return json({
        ok: true,
        authorization_url: d.data.authorization_url,
        reference,
        amount_naira: amount,
        charged_naira: charged,
        paystack_fee_naira: charged - amount,
        revora_fee_naira: await rvFee("deposit", amount)
      });
    }
    if (action === "verify") {
      const ref = String(b?.reference ?? "");
      if (!/^wt_[a-f0-9]{20}$/.test(ref)) return json({
        error: "Bad reference."
      }, 400);
      const { data: row } = await admin.from("wallet_topups").select("company_id, media_buyer_id").eq("reference", ref).maybeSingle();
      if (!row || row.company_id !== me.company_id) return json({
        error: "Top-up not found."
      }, 404);
      if (!isAdmin && row.media_buyer_id !== me.media_buyer_id) return json({
        error: "That top-up is not yours."
      }, 403);
      const s = await settle(ref);
      return json({
        ok: s.ok,
        status: s.status
      });
    }
    if (action === "dva") {
      // The account number for topping up by bank transfer from any bank: a media buyer's own account (an admin uses the company account).
      const buyerRow = me.role === "buyer" ? me.media_buyer_id : null;
      const read = async ()=>buyerRow ? (await admin.from("media_buyers").select("dedicated_account_number, dedicated_account_bank, name").eq("id", buyerRow).maybeSingle()).data : (await admin.from("companies").select("dedicated_account_number, dedicated_account_bank, name").eq("id", me.company_id).maybeSingle()).data;
      let row = await read();
      if (!row?.dedicated_account_number && b?.create) {
        if (!PAYSTACK_SECRET_KEY) return json({ error: "Bank transfer top-ups are not switched on yet." }, 500);
        const url = buyerRow ? "paystack-create-account" : "paystack-create-company-account";
        const rr = await fetch(`${SUPABASE_URL}/functions/v1/${url}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` }, body: JSON.stringify(buyerRow ? { media_buyer_id: buyerRow } : { company_id: me.company_id }) });
        const jj = await rr.json().catch(()=>({}));
        if (!rr.ok && !jj.account_number) return json({ error: jj.error || "Could not open the account number yet." }, 502);
        row = await read();
      }
      return json({ ok: true, owner: buyerRow ? "buyer" : "company", account: row?.dedicated_account_number ? { number: row.dedicated_account_number, bank: row.dedicated_account_bank, name: `${row.name ?? ""}` } : null });
    }
    if (action === "resolve") {
      // Who owns this bank account, right now (and is it Meta's)? Shown to the person before they confirm anything.
      const acct = String(b?.account_number ?? "").replace(/\s+/g, ""), bank = String(b?.bank_code ?? "").trim();
      if (!/^\d{10}$/.test(acct) || !bank) return json({ error: "Enter the bank and a 10-digit account number." }, 400);
      const rr = await fetch(`${PAYSTACK_BASE}/bank/resolve?account_number=${encodeURIComponent(acct)}&bank_code=${encodeURIComponent(bank)}`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } });
      const jj = await rr.json().catch(()=>({}));
      const name = String(jj?.data?.account_name ?? "");
      if (!rr.ok || !name) return json({ ok: false, error: "The bank could not find that account. Check the number and the bank." });
      const { data: rows } = await admin.from("transfer_allowed_names").select("name_key").eq("company_id", me.company_id);
      const list = rows ?? [], key = name.trim().toLowerCase().replace(/\s+/g, " ");
      const isMeta = list.length ? list.some((x)=>x.name_key === key) : /(facebook|meta)/i.test(name);
      return json({ ok: true, name, is_meta: isMeta });
    }
    if (action === "fees") {
      const { data: fees } = await admin.from("platform_fees").select("kind, enabled, pct, flat_naira, min_naira, cap_naira, payer");
      const out = { ok: true, fees: fees ?? [] };
      const a = Math.round(Number(b?.amount));
      if (Number.isFinite(a) && a > 0) {
        const charged = paystackCharge(a), rf = await rvFee("deposit", a);
        out.preview = { amount: a, card_charged: charged, paystack_fee: charged - a, revora_deposit_fee: rf, credit_fee: await rvFee("credit", a), card_lands: a - rf, transfer_fee: await rvFee("transfer", a), wallet_fee: await rvFee("wallet", a) };
      }
      return json(out);
    }
    if (action === "lookup") {
      const { data: found, error } = await admin.rpc("rv_find_user", { p_key: String(b?.key ?? ""), p_exclude: me.id });
      if (error) return json({ error: "Could not search." }, 500);
      return json({ ok: true, people: (found ?? []).map((x)=>({ user_id: x.user_id, name: x.name, role: x.role, company: x.company_name, hint: x.hint })) });
    }
    if (action === "send") {
      const amount = Math.round(Number(b?.amount));
      if (!Number.isFinite(amount) || amount < 100 || amount > 5_000_000) return json({ error: "Send between ₦100 and ₦5,000,000." }, 400);
      const to = String(b?.to_user ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(to)) return json({ error: "Pick who to send to." }, 400);
      const pin = String(b?.pin ?? "");
      if (!/^\d{4,6}$/.test(pin)) return json({ error: "Enter your 4 to 6 digit transfer PIN." }, 400);
      const p = await checkPin(me.id, pin);
      if (!p.ok) return json({ error: p.error }, 403);
      const { data: res, error } = await admin.rpc("rv_wallet_send", { p_from: me.id, p_to: to, p_amount: amount, p_note: String(b?.note ?? "").slice(0, 200) });
      if (error) return json({ error: String(error.message ?? "Could not send.").replace(/^.*?:\s*/, "").replace(/ , /g, ", ") }, 400);
      return json(res);
    }
    if (action === "activity") {
      const limit = Math.min(Math.max(Number(b?.limit) || 30, 1), 100), beforeIso = b?.before ? new Date(String(b.before)).toISOString() : null;
      const mb = me.role === "buyer" ? me.media_buyer_id : null;
      if (me.role === "buyer" && !mb) return json({ ok: true, items: [] });
      const rows = [];
      const feeBy = {};
      const lim = (q)=>beforeIso ? q.lt("created_at", beforeIso) : q;
      let adjQ = admin.from("wallet_adjustments").select("id, amount_naira, reason, ref, created_at, note").eq("company_id", me.company_id);
      adjQ = mb ? adjQ.eq("media_buyer_id", mb) : adjQ.is("media_buyer_id", null);
      const { data: adj } = await lim(adjQ).order("created_at", { ascending: false }).limit(200);
      const refs = [];
      for (const a of adj ?? []) { if (/_fee$/.test(a.reason)) { feeBy[a.ref] = (feeBy[a.ref] || 0) + Number(a.amount_naira); continue; } refs.push(a.ref); }
      const LABEL = { given_by_company: ["From your admin", 1], given_to_buyer: ["Given to a buyer", -1], taken_back: ["Taken back by your admin", -1], taken_from_buyer: ["Taken back from a buyer", 1],
        sent_to_user: ["Sent", -1], received_from_user: ["Received", 1], meta_overspend: ["Ad spend above the Meta balance", -1], sent_to_meta_from_balance: ["Deposited to Meta", -1], opening_balance: ["Opening balance", 1], balance_correction: ["Balance correction", -1], ad_account_fee: ["Ad account fee", 1] };
      for (const a of adj ?? []) {
        if (/_fee$/.test(a.reason)) continue;
        const l = LABEL[a.reason] ?? [a.reason, 1], sign = l[1], amt = -Number(a.amount_naira);
        // A credit that paid the deposit fee shows what actually landed (after the fee), with the money sent as "gross".
        const dfee = a.reason === "given_by_company" ? (feeBy[a.ref] || 0) : 0;
        rows.push({ id: a.id, kind: a.reason, title: a.note ? `${l[0]} · ${a.note.replace(/^(To|From) /, "")}` : l[0], amount: amt - dfee, gross: dfee ? amt : undefined, fee: feeBy[a.ref] || 0, at: a.created_at, ref: a.ref, dir: amt >= 0 ? "in" : "out" });
      }
      // Money received from another user: the credit is already net of the receiver's fee, so read the fee from the fee ledger.
      const recvRows = rows.filter((x)=>x.kind === "received_from_user");
      if (recvRows.length) {
        const { data: rf } = await admin.from("fee_ledger").select("ref, fee_naira").in("ref", recvRows.map((x)=>x.ref)).eq("kind", "wallet_receive");
        const rfBy = Object.fromEntries((rf ?? []).map((x)=>[x.ref, Number(x.fee_naira)]));
        for (const x of recvRows) if (rfBy[x.ref]) { x.fee = rfBy[x.ref]; x.gross = x.amount + rfBy[x.ref]; }
      }
      let tpQ = admin.from("wallet_topups").select("id, reference, amount_naira, status, created_at, confirmed_at, channel, paystack_fee_naira, charged_naira").eq("company_id", me.company_id).eq("status", "confirmed");
      tpQ = mb ? tpQ.eq("media_buyer_id", mb) : tpQ.is("media_buyer_id", null);
      const { data: tps } = await lim(tpQ).order("created_at", { ascending: false }).limit(60);
      const tref = (tps ?? []).map((x)=>x.reference);
      const { data: fl } = tref.length ? await admin.from("fee_ledger").select("ref, fee_naira, kind").in("ref", tref).eq("kind", "deposit") : { data: [] };
      const flBy = Object.fromEntries((fl ?? []).map((x)=>[x.ref, Number(x.fee_naira)]));
      for (const x of tps ?? []) rows.push({ id: x.id, kind: "topup", title: "Money added", sub: x.channel ?? "card", amount: Number(x.amount_naira) - (flBy[x.reference] || 0), gross: Number(x.charged_naira ?? x.amount_naira), fee: (flBy[x.reference] || 0) + Number(x.paystack_fee_naira || 0), at: x.confirmed_at ?? x.created_at, ref: x.reference, dir: "in" });
      let frQ = admin.from("fund_requests").select("id, amount_naira, transferred_at, destination_account_name, req_account_name, paid_from, requested_at").eq("company_id", me.company_id).eq("status", "transferred");
      frQ = mb ? frQ.eq("media_buyer_id", mb).eq("paid_from", "buyer") : frQ.eq("paid_from", "company");
      const { data: frs } = await (beforeIso ? frQ.lt("transferred_at", beforeIso) : frQ).order("transferred_at", { ascending: false }).limit(60);
      const frIds = (frs ?? []).map((x)=>x.id);
      const { data: tfl } = frIds.length ? await admin.from("fee_ledger").select("ref, fee_naira").in("ref", frIds).eq("kind", "transfer") : { data: [] };
      const tfBy = Object.fromEntries((tfl ?? []).map((x)=>[x.ref, Number(x.fee_naira)]));
      for (const x of frs ?? []) rows.push({ id: x.id, kind: "to_meta", title: "Sent to Meta", sub: x.destination_account_name || x.req_account_name || "", amount: -Number(x.amount_naira), fee: tfBy[x.id] || 0, at: x.transferred_at ?? x.requested_at, ref: x.id, dir: "out" });
      let wdQ = admin.from("admin_withdrawals").select("id, amount_naira, status, created_at, sent_at, destination_account_name, destination_bank_name").eq("company_id", me.company_id).in("status", ["pending", "sent"]);
      wdQ = mb ? wdQ.eq("media_buyer_id", mb) : wdQ.is("media_buyer_id", null);
      const { data: wds } = await lim(wdQ).order("created_at", { ascending: false }).limit(60);
      const wIds = (wds ?? []).map((x)=>x.id);
      const { data: wfl } = wIds.length ? await admin.from("fee_ledger").select("ref, fee_naira").in("ref", wIds).eq("kind", "transfer") : { data: [] };
      const wfBy = Object.fromEntries((wfl ?? []).map((x)=>[x.ref, Number(x.fee_naira)]));
      for (const x of wds ?? []) rows.push({ id: x.id, kind: "withdrawal", title: "Withdrawal", sub: [x.destination_account_name, x.destination_bank_name].filter(Boolean).join(" · "), amount: -Number(x.amount_naira), fee: wfBy[x.id] || 0, at: x.sent_at ?? x.created_at, ref: x.id, dir: "out" });
      rows.sort((x, y)=>new Date(y.at).getTime() - new Date(x.at).getTime());
      return json({ ok: true, items: rows.slice(0, limit), more: rows.length > limit });
    }
    if (action === "withdraw") {
      // Take money out of my wallet: an owner/admin to any Nigerian bank account or to Meta; a media buyer to a bank account in their own name.
      const amount = Math.round(Number(b?.amount));
      if (!Number.isFinite(amount) || amount < 100 || amount > 5_000_000) return json({ error: "Withdraw between ₦100 and ₦5,000,000." }, 400);
      const acct = String(b?.account_number ?? "").replace(/\s+/g, ""), bank = String(b?.bank_code ?? "").trim();
      if (!/^\d{10}$/.test(acct)) return json({ error: "An account number is 10 digits." }, 400);
      if (!bank) return json({ error: "Pick the bank." }, 400);
      const pin = String(b?.pin ?? "");
      if (!/^\d{4,6}$/.test(pin)) return json({ error: "Enter your 4 to 6 digit transfer PIN." }, 400);
      const mode = b?.mode === "meta" ? "meta" : "bank";
      if (mode === "meta" && !isAdmin) return json({ error: "Use Send to Meta." }, 403);
      const p = await checkPin(me.id, pin);
      if (!p.ok) return json({ error: p.error }, 403);
      const r = await fetch(`${SUPABASE_URL}/functions/v1/paystack-admin-withdraw`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, "x-internal-key": SERVICE_KEY },
        body: JSON.stringify({ on_behalf_of: me.id, amount_naira: amount, account_number: acct, bank_code: bank, approved_with: "pin", source: "dashboard", mode }) });
      const j = await r.json().catch(()=>({ error: "No answer from the payment service." }));
      return json(j, r.ok ? 200 : r.status === 401 ? 500 : r.status);
    }
    if (action === "request") {
      if (me.role !== "buyer" || !me.media_buyer_id) return json({
        error: "Only a media buyer asks for wallet funds."
      }, 403);
      const amount = Math.round(Number(b?.amount));
      if (!Number.isFinite(amount) || amount < 500 || amount > MAX) return json({
        error: "Ask for between ₦500 and ₦2,000,000."
      }, 400);
      const { count } = await admin.from("wallet_requests").select("id", {
        count: "exact",
        head: true
      }).eq("media_buyer_id", me.media_buyer_id).eq("status", "pending");
      if ((count ?? 0) >= 3) return json({
        error: "You already have 3 requests waiting. Wait for your admin to answer them."
      }, 400);
      const { data: row, error } = await admin.from("wallet_requests").insert({
        company_id: me.company_id,
        media_buyer_id: me.media_buyer_id,
        amount_naira: amount,
        note: String(b?.note ?? "").slice(0, 200) || null
      }).select("id").single();
      if (error || !row) return json({
        error: "Could not send the request."
      }, 500);
      // Tell the owners and admins (best effort).
      const { data: admins } = await admin.from("profiles").select("id").eq("company_id", me.company_id).in("role", [
        "owner",
        "admin"
      ]);
      for (const a of admins ?? [])await admin.from("ai_inbox").insert({
        company_id: me.company_id,
        profile_id: a.id,
        kind: "fund_request",
        title: `Wallet request: ₦${amount.toLocaleString("en-NG")}`,
        body: "A media buyer asked for funds for their Revora ad accounts. Open the Wallet tab to approve or decline.",
        payload: {},
        dedupe_key: `wallet_req:${row.id}:${a.id}`
      }).then(()=>{}, ()=>{});
      return json({
        ok: true,
        id: row.id
      });
    }
    if (action === "decide") {
      if (!isAdmin) return json({
        error: "Only an owner or admin can answer wallet requests."
      }, 403);
      const id = String(b?.id ?? "");
      const { data: req0 } = await admin.from("wallet_requests").select("id, media_buyer_id, amount_naira, status").eq("id", id).eq("company_id", me.company_id).maybeSingle();
      if (!req0) return json({
        error: "Request not found."
      }, 404);
      if (req0.status !== "pending") return json({
        error: `That request is already ${req0.status}.`
      }, 400);
      if (b?.decision === "decline") {
        await admin.from("wallet_requests").update({
          status: "declined",
          decided_at: new Date().toISOString(),
          decided_by: me.id
        }).eq("id", id).eq("status", "pending");
        return json({
          ok: true
        });
      }
      const amount = Number(req0.amount_naira);
      const { data: cw } = await admin.rpc("company_wallet_balance", {
        p_company: me.company_id
      });
      if (Number(cw ?? 0) < amount) return json({
        error: `The company wallet only has ₦${Math.max(0, Math.round(Number(cw ?? 0))).toLocaleString("en-NG")}. Top it up first.`
      }, 400);
      // Only the first tap wins, so a double tap can never fund twice.
      const { data: won } = await admin.from("wallet_requests").update({
        status: "approved",
        decided_at: new Date().toISOString(),
        decided_by: me.id
      }).eq("id", id).eq("status", "pending").select("id");
      if (!won?.length) return json({
        error: "That request was just answered."
      }, 409);
      const ref = `req:${id}`;
      const { error } = await admin.from("wallet_adjustments").insert([
        {
          company_id: me.company_id,
          media_buyer_id: null,
          amount_naira: amount,
          reason: "given_to_buyer",
          ref
        },
        {
          company_id: me.company_id,
          media_buyer_id: req0.media_buyer_id,
          amount_naira: -amount,
          reason: "given_by_company",
          ref
        }
      ]);
      if (error) {
        await admin.from("wallet_requests").update({
          status: "pending",
          decided_at: null,
          decided_by: null
        }).eq("id", id);
        return json({
          error: "Could not move the money."
        }, 500);
      }
      await takeDepositFee(me.company_id, req0.media_buyer_id, null, amount, ref, "Fee on approved request", "credit");
      return json({
        ok: true
      });
    }
    if (action === "allocate" || action === "take_back") {
      if (!isAdmin) return json({
        error: "Only an owner or admin can move wallet money."
      }, 403);
      const amount = Math.round(Number(b?.amount));
      if (!Number.isFinite(amount) || amount < 100 || amount > MAX) return json({
        error: "Enter an amount between ₦100 and ₦2,000,000."
      }, 400);
      const buyer = await buyerOk(String(b?.buyer_id ?? ""));
      if (!buyer) return json({
        error: "That buyer is not on your team."
      }, 404);
      const toBuyer = action === "allocate";
      const { data: from } = toBuyer ? await admin.rpc("company_wallet_balance", {
        p_company: me.company_id
      }) : await admin.rpc("buyer_wallet_balance", {
        p_buyer: buyer.id
      });
      if (Number(from ?? 0) < amount) return json({
        error: toBuyer ? `The company wallet only has ₦${Math.max(0, Math.round(Number(from ?? 0))).toLocaleString("en-NG")}. Top it up first.` : `${buyer.name}'s wallet only has ₦${Math.max(0, Math.round(Number(from ?? 0))).toLocaleString("en-NG")}.`
      }, 400);
      const ref = `move:${crypto.randomUUID()}`;
      const rows = toBuyer ? [
        {
          company_id: me.company_id,
          media_buyer_id: null,
          amount_naira: amount,
          reason: "given_to_buyer",
          ref
        },
        {
          company_id: me.company_id,
          media_buyer_id: buyer.id,
          amount_naira: -amount,
          reason: "given_by_company",
          ref
        }
      ] : [
        {
          company_id: me.company_id,
          media_buyer_id: buyer.id,
          amount_naira: amount,
          reason: "taken_back",
          ref
        },
        {
          company_id: me.company_id,
          media_buyer_id: null,
          amount_naira: -amount,
          reason: "taken_from_buyer",
          ref
        }
      ];
      const { error } = await admin.from("wallet_adjustments").insert(rows);
      if (error) return json({
        error: "Could not move the money."
      }, 500);
      // Money credited to a buyer's wallet pays the deposit fee like any other deposit.
      let fee = 0;
      if (toBuyer) fee = await takeDepositFee(me.company_id, buyer.id, null, amount, ref, "Fee on funds from your admin", "credit");
      return json({
        ok: true,
        fee
      });
    }
    return json({
      error: "Unknown action."
    }, 400);
  } catch (e) {
    return json({
      error: e.message
    }, 500);
  }
});
