// Revora dashboard, part 26 of 27: WALLET (rebuilt) and the AD WALLET CARD that the Campaigns screen shares.
// The money logic is unchanged (same functions, same database calls); this file is the new look. Nothing is invented:
// a number the system does not have is left out.

Object.assign(RV_IC, {
  ext: '<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>',
  arrdn: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  arrup: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
  mega: '<path d="M3 11v2a1 1 0 001 1h1l5 4V6l-5 4H4a1 1 0 00-1 1z"/><path d="M15.5 8.5a4 4 0 010 7M18.5 5.5a8 8 0 010 13"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  bank: '<path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>',
});

const WL = { tab: "all", more: 20, ledger: [], isAdmin: false, bal: null, balAt: 0, daily: {} };

// ---------- AD WALLET CARD (shared by Wallet and Campaigns) ----------
// b = one account from ads-manager "balances": { id, name, available, is_prepay, owed, funding_label, account_status, low_threshold, error }
// o = { daily: average spend per day (number) or null, compact: true for the slim strip, isAdmin }
function rvAdWalletCard(b, o = {}) {
  const acct = (window.accountsList || []).find((a) => a.id === b.id) || {};
  const idTail = acct.meta_ad_account_id ? "Meta ···" + String(acct.meta_ad_account_id).replace(/\D/g, "").slice(-4) : "";
  const managed = /revora/i.test(b.funding_label || "") && b.is_prepay;
  const prepay = b.is_prepay && b.available != null;
  const low = prepay && b.low_threshold != null && b.available <= b.low_threshold;
  const bad = b.account_status && b.account_status !== 1 ? (AM_ACCT_STATUS[b.account_status] || "Needs attention") : "";
  const chip = b.error ? ["Unavailable", "bad"] : bad ? [bad, "bad"] : prepay && b.available <= 0 ? ["Empty", "bad"] : low ? ["Low balance", "warn"] : ["Active", "ok"];
  let amt = "—", sub = "";
  if (b.error) sub = escH(b.error);
  else if (prepay) {
    amt = fN(b.available);
    if (o.daily > 0) { const d = b.available / o.daily; sub = `About ${d < 1 ? "less than a day" : d < 2 ? "1 day" : Math.floor(d) + " days"} left at ${fN(Math.round(o.daily))} a day`; }
    else sub = managed ? "Revora wallet" : "Prepaid balance";
  } else {
    amt = b.owed != null ? fN(b.owed) : "—";
    sub = "Billed to your card" + (b.owed != null ? " · spent so far, not yet charged" : "");
  }
  const fund = !b.error && (prepay || managed) && !bad
    ? (managed ? `<button type="button" class="awc-b" onclick="bvTopUpModal('${o.isAdmin ? "company" : "me"}')">Top up</button>` : `<button type="button" class="awc-b" onclick="bvShowRequestFundsModal()">Fund account</button>`) : "";
  const tone = chip[1] === "bad" ? " bad" : chip[1] === "warn" ? " low" : "";
  if (o.hero) {
    // The Campaigns header: balance on top, the counts (and when it was updated) in a band along the bottom.
    return `<div class="awc hero${tone}"><div class="hr-a"><div><div class="awc-n">${rvIc("mega")}${escH(b.name || "Ad account")}<span class="awc-c ${b.loading ? "" : chip[1]}">${b.loading ? "Checking…" : escH(chip[0])}</span></div>
      <div class="awc-a">${b.loading ? "…" : amt}</div><div class="awc-s">${b.loading ? "Reading the balance from Meta" : sub}</div></div>${fund && !b.loading ? `<div class="awc-f">${fund}</div>` : ""}</div>
      <div class="hr-b">${(o.stats || []).map((x) => `<div><b>${x[0]}</b><small>${x[1]}</small></div>`).join("")}${o.foot ? `<div class="upd">${escH(o.foot)}</div>` : ""}</div></div>`;
  }
  return `<div class="awc${tone}">
    <div class="awc-t"><span class="awc-n">${rvIc("mega")}${escH(b.name || "Ad account")}</span><span class="awc-c ${chip[1]}">${escH(chip[0])}</span></div>
    ${o.compact ? "" : `<div class="awc-id">${escH(idTail)}${b.funding_label && !managed && prepay ? (idTail ? " · " : "") + escH(String(b.funding_label).slice(0, 40)) : ""}</div>`}
    <div class="awc-a">${amt}</div><div class="awc-s">${sub}</div>${fund ? `<div class="awc-f">${fund}</div>` : ""}</div>`;
}

// Average spend per day over the last 7 days for each account, from the live daily numbers (Wallet only).
async function wlDailyAvg() {
  try {
    const until = ovWat(new Date().toISOString()), since = ovWat(new Date(Date.now() - 6 * 864e5).toISOString());
    const d = await fetchLiveDaily(since, until);
    const out = {};
    for (const r of d.rows || []) out[r.account_id] = (out[r.account_id] || 0) + (Number(r.spend) || 0) / 7;
    return out;
  } catch { return {}; }
}
async function wlBalances() {
  const r = await amCall({ action: "balances" }).catch((e) => ({ ok: false, error: e.message }));
  return r && r.ok ? r.accounts || [] : null;
}
async function wlFillAdCards() {
  const box = document.getElementById("wlAdCards"); if (!box) return;
  const [accts, daily] = await Promise.all([wlBalances(), wlDailyAvg()]);
  const b = document.getElementById("wlAdCards"); if (!b) return;
  WL.bal = accts; WL.daily = daily;
  if (!accts) { b.innerHTML = `<div class="rv-note warn">${rvIc("alert")}<span>Could not read the balances from Meta just now.</span><button type="button" class="rv-btn s" style="margin-left:auto" onclick="wlFillAdCards()">Try again</button></div>`; return; }
  if (!accts.length) { b.innerHTML = `<div class="rv-empty">No ad accounts linked yet.</div>`; return; }
  const sorted = [...accts].sort((x, y) => (y.error ? 1 : 0) - (x.error ? 1 : 0) || ((x.available ?? 1e15) - (y.available ?? 1e15)));
  b.innerHTML = `<div class="awcs">${sorted.map((a) => rvAdWalletCard(a, { daily: daily[a.id], isAdmin: WL.isAdmin })).join("")}</div>`;
}

// ---------- the screen ----------
const wlDay = (iso) => { const d = new Date(iso), n = new Date(); if (d.toDateString() === n.toDateString()) return "Today"; const y = new Date(n); y.setDate(n.getDate() - 1); if (d.toDateString() === y.toDateString()) return "Yesterday"; return d.toLocaleDateString("en-NG", { day: "numeric", month: "long" }); };
function wlLedgerHtml() {
  const rows = WL.ledger.filter((t) => WL.tab === "all" || (WL.tab === "in" ? t.type === "credit" : t.type === "debit"));
  if (!rows.length) return `<div class="rv-empty" style="padding:18px 20px">${WL.ledger.length ? "Nothing here." : "No transactions yet."}</div>`;
  let last = "", out = "";
  for (const t of rows.slice(0, WL.more)) {
    const g = wlDay(t.date);
    if (g !== last) { out += `<div class="wl-day">${g}</div>`; last = g; }
    const cr = t.type === "credit";
    out += `<div class="wl-r"><span class="wl-ico ${cr ? "in" : ""}">${rvIc(cr ? "arrdn" : /Sent to ad/.test(t.label) ? "ext" : "arrup")}</span>
      <div class="wl-mid"><b>${escH(t.label)}${WL.isAdmin && t.buyerName ? ` · ${escH(t.buyerName)}` : ""}</b><small>${t.detail ? escH(t.detail) + " · " : ""}${new Date(t.date).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}</small></div>
      <div class="wl-am ${cr ? "in" : ""}">${cr ? "+" : "−"}${fN(t.amount)}</div></div>`;
  }
  if (rows.length > WL.more) out += `<div class="wl-more"><button type="button" class="rv-btn s" data-wlmore="1">Show more</button></div>`;
  return out;
}
function wlExport() {
  bvDownloadCsv("revora-wallet-" + new Date().toISOString().slice(0, 10) + ".csv", ["Date", "Type", "Description", "Detail", "Buyer", "Amount (NGN)"],
    WL.ledger.map((t) => [new Date(t.date).toISOString(), t.type === "credit" ? "Money in" : "Money out", t.label, t.detail || "", t.buyerName || "", (t.type === "credit" ? "" : "-") + t.amount]));
}
async function wlDelLog(id) {
  if (!confirm("Remove this entry?")) return;
  const { error } = await supabaseClient.from("fund_logs").delete().eq("id", id);
  if (error) { alert(error.message); return; }
  renderWallet(document.getElementById("mainContent"));
}
function wlCopy(txt) { try { navigator.clipboard.writeText(txt); bvToast("Copied"); } catch { bvToast("Could not copy", "err"); } }

// The Revora-managed wallets (buying ad accounts from Revora): admin gives and takes funds; a buyer tops up or asks.
function wlRevoraHtml(rw, isAdmin) {
  if (!rw || rw.error) return "";
  const stPill = (st, ok, wait) => st === ok ? `<span class="rv-pill ok">Paid</span>` : st === wait ? `<span class="rv-pill warn">Waiting</span>` : `<span class="rv-pill bad">${escH(st)}</span>`;
  const topups = (rw.topups || []).length ? `<div class="wl-sub">Recent top-ups</div>${rw.topups.slice(0, 6).map((t) => `<div class="wl-r"><div class="wl-mid"><b>${fN(t.amount_naira)}</b><small>${new Date(t.created_at).toLocaleString()}${isAdmin ? " · " + (t.media_buyer_id ? escH((rw.buyers || []).find((b) => b.id === t.media_buyer_id)?.name || "Buyer") : "Company") : ""}</small></div>${stPill(t.status, "confirmed", "pending")}</div>`).join("")}` : "";
  if (!isAdmin) {
    if (rw.my_wallet === undefined) return "";
    const reqs = (rw.requests || []).length ? `<div class="wl-sub">Your requests</div>${rw.requests.slice(0, 6).map((r) => `<div class="wl-r"><div class="wl-mid"><b>${fN(r.amount_naira)}</b><small>${new Date(r.requested_at).toLocaleString()}${r.note ? " · " + escH(r.note) : ""}</small></div>${r.status === "approved" ? `<span class="rv-pill ok">Funded</span>` : r.status === "pending" ? `<span class="rv-pill warn">Waiting for admin</span>` : `<span class="rv-pill bad">${escH(r.status)}</span>`}</div>`).join("")}` : "";
    return `<section class="rv-card wl-sec"><div class="wl-hd"><h3>Your Revora wallet</h3></div><div style="padding:0 20px 16px"><div class="wl-big ${rw.my_wallet <= 0 ? "neg" : ""}">${fN(rw.my_wallet)}</div>
      <div class="rv-mut3" style="margin:2px 0 12px">Pays for the Revora ad accounts shared with you. Your ads pause when it runs out.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="rv-btn p s" onclick="bvTopUpModal('me')">Top up</button><button type="button" class="rv-btn s" onclick="bvAskWalletModal()">Ask my admin</button></div></div>${reqs}${topups}</section>`;
  }
  const rows = (rw.buyers || []).map((b) => { const nm = JSON.stringify(b.name).replace(/"/g, "&quot;"); return `<div class="wl-r"><div class="wl-mid"><b>${escH(b.name)}</b><small>Spent ${fN(b.spent)}</small></div><div class="wl-am ${b.balance <= 0 ? "neg" : ""}">${fN(b.balance)}</div>
    <details class="rv-menu"><summary class="rv-btn s">Manage</summary><div class="rv-pop"><button type="button" onclick="bvMoveFundsModal('${b.id}', ${nm}, 'allocate')">Give funds</button><button type="button" onclick="bvTopUpModal('${b.id}', ${nm})">Top up by card</button><button type="button" onclick="bvMoveFundsModal('${b.id}', ${nm}, 'take_back')">Take back</button></div></details></div>`; }).join("");
  return `<section class="rv-card wl-sec"><div class="wl-hd"><h3>Revora ad account wallets</h3><div style="flex:1"></div><button type="button" class="rv-btn s" onclick="bvTopUpModal('company')">Top up by card</button></div>
    ${rows || `<div class="rv-empty" style="padding:6px 20px 18px">No team media buyers yet.</div>`}${topups}</section>`;
}

async function renderWallet(el) {
  const isAdmin = window.myProfile?.role === "owner" || window.myProfile?.role === "admin";
  const myId = window.myProfile?.media_buyer_id || null;
  const blank = walletBlank;

  const [{ buyers, fundRequests, withdrawals, walletBalances, companyTopups, totalRevenue, fundingWalletBalance, managedSpend }, company] = await Promise.all([
    fetchWalletBalances(),
    sbQuery("companies", "select=id,name,dedicated_account_number,dedicated_account_bank&limit=1").then(r => r?.[0]).catch(() => null),
  ]);
  // Richer than fetchWalletBalances' own payments query (which only pulls
  // the columns it needs for sums) -- this one is for the transaction
  // ledger below, so it needs the order link and timestamp too. RLS scopes
  // it the same way: a buyer only ever gets their own.
  const confirmedPayments = await sbQuery("payments", "select=id,amount_naira,paid_at,media_buyer_id,source,held_for_buyer_id,sender_name,sender_bank,sender_account,narration,orders(customer_name)&status=eq.confirmed&order=paid_at.desc&limit=100").catch(() => []);
  // Deposits that arrived in a buyer's account but could not be matched to an order. The company holds the money; the buyer can see it.
  const heldDeposits = (confirmedPayments || []).filter(p => p.held_for_buyer_id && (isAdmin || p.held_for_buyer_id === myId));
  const heldTotal = heldDeposits.reduce((s, p) => s + Number(p.amount_naira || 0), 0);
  const heldFrom = p => [p.sender_name, p.sender_bank, p.sender_account].filter(Boolean).join(" · ") || "sender not shown";
  // Requests from buyers asking the admin to match a held deposit to one of their orders.
  const matchReqs = await sbQuery("payment_match_requests", "select=id,payment_id,order_id,media_buyer_id,status,requested_at,orders(customer_name,product_name,order_value_naira)&order=requested_at.desc&limit=100").catch(() => []);
  const pendingByPayment = new Map((matchReqs || []).filter(r => r.status === "pending").map(r => [r.payment_id, r]));

  const rw = await sbFn("wallet-topup", { action: "overview" }).catch(() => null);
  const fundLogs = await sbQuery("fund_logs", "select=id,amount_naira,log_date,note,media_buyer_id,logged_by&order=log_date.desc,created_at.desc&limit=30").catch(() => []) || [];
  const myRevenue = myId ? (walletBalances[myId] || walletBlank()) : walletBlank();
  const myRequests = myId ? (fundRequests || []).filter(f => f.media_buyer_id === myId) : [];

  // One combined, chronological ledger -- "where did this number come
  // from": a customer payment or an admin deposit is a credit; a transfer
  // out to an ad account or a withdrawal to the admin's own bank is a
  // debit. Buyers see only their own payments; admins see everything.
  const ledger = [];
  for (const p of confirmedPayments || []) {
    if (p.held_for_buyer_id) {
      if (!isAdmin && p.held_for_buyer_id !== myId) continue;
      const bn = (buyers || []).find(b => b.id === p.held_for_buyer_id)?.name;
      ledger.push({ date: p.paid_at, type: "credit", label: "Unmatched deposit (held by company)", detail: "From " + heldFrom(p), buyerName: bn, amount: p.amount_naira });
      continue;
    }
    if (p.source === "admin_topup") {
      if (!isAdmin) continue;
      ledger.push({ date: p.paid_at, type: "credit", label: "Company funding (admin deposit)", detail: null, buyerName: null, amount: p.amount_naira });
      continue;
    }
    if (!isAdmin && p.media_buyer_id !== myId) continue;
    const buyerName = (buyers || []).find(b => b.id === p.media_buyer_id)?.name;
    ledger.push({ date: p.paid_at, type: "credit", label: "Customer payment", detail: p.orders?.customer_name || null, buyerName, amount: p.amount_naira });
  }
  for (const f of fundRequests || []) {
    if (f.status !== "transferred") continue;
    if (!isAdmin && f.media_buyer_id !== myId) continue;
    const buyerName = (buyers || []).find(b => b.id === f.media_buyer_id)?.name;
    ledger.push({ date: f.transferred_at, type: "debit", label: "Sent to ad account", detail: f.destination_account_name || null, buyerName, amount: f.amount_naira });
  }
  if (isAdmin) {
    for (const w of withdrawals || []) {
      if (w.status !== "sent") continue;
      ledger.push({ date: w.sent_at || w.created_at, type: "debit", label: "Withdrawn to bank", detail: w.destination_account_name || null, buyerName: null, amount: w.amount_naira });
    }
  }
  ledger.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Receipts for money Revora sent out (dashboard or assistant). Admins see the company's; a buyer sees their own.
  const receipts = await sbQuery("transfer_receipts", "select=id,receipt_no,kind,source,amount_naira,account_name,bank_name,status,created_at&order=created_at.desc&limit=30" + (isAdmin ? "" : "&user_id=eq." + (window.myProfile?.id || ""))).catch(() => []);
  WL.isAdmin = isAdmin; WL.ledger = ledger; WL.more = 20;
  const pendingFunds = (fundRequests || []).filter((f) => (f.status === "pending" || f.status === "approved") && !f.paystack_transfer_code);
  const myBuyerRow = (buyers || []).find((b) => b.id === myId);
  const revenueNow = isAdmin ? totalRevenue : myRevenue.confirmed;
  // Revenue trend: real confirmed payments per day, only when the 100 most recent payments reach back far enough to be trusted.
  const dayKey = (iso) => new Date(new Date(iso).getTime() + 3600000).toISOString().slice(0, 10);
  const spark = (() => {
    const ps = (confirmedPayments || []).filter((p) => p.paid_at && (isAdmin || p.media_buyer_id === myId) && !p.held_for_buyer_id && p.source !== "admin_topup");
    const oldest = (confirmedPayments || []).length ? Math.min(...(confirmedPayments || []).map((p) => +new Date(p.paid_at))) : Date.now();
    if ((confirmedPayments || []).length >= 100 && oldest > Date.now() - 14 * 864e5) return null;
    const days = Array.from({ length: 14 }, (_, i) => dayKey(new Date(Date.now() - (13 - i) * 864e5).toISOString()));
    const sums = days.map((d) => ps.filter((p) => dayKey(p.paid_at) === d).reduce((s, p) => s + Number(p.amount_naira || 0), 0));
    const total = sums.reduce((a, b) => a + b, 0), mx = Math.max(...sums, 1);
    const pts = sums.map((v, i) => `${(i / 13 * 300).toFixed(1)} ${(66 - v / mx * 58).toFixed(1)}`);
    return { total, line: "M" + pts.join(" L"), area: "M" + pts.join(" L") + " L300 74 L0 74Z" };
  })();
  const short = isAdmin && fundingWalletBalance < 0;
  const waiting = myRequests.filter((f) => f.status === "pending").reduce((t, f) => t + Number(f.amount_naira || 0), 0);

  // ---- attention list ----
  const att = [];
  if (isAdmin) {
    for (const f of pendingFunds) {
      const buyerName = (buyers || []).find((b) => b.id === f.media_buyer_id)?.name || "—";
      const reserved = f.status === "approved" ? Number(f.amount_naira) : 0;
      const sh = Number(f.amount_naira) > fundingWalletBalance + reserved;
      const hours = (Date.now() - new Date(f.requested_at).getTime()) / 3600000;
      const hasAcct = !!f.req_account_number;
      const summary = `<b>${fN(f.amount_naira)}</b> for <b>${escH(buyerName)}</b> to <b>${escH(f.req_account_name || "Meta")}</b> · ${escH(f.req_bank_name || "")} ${escH(f.req_account_number || "")}`;
      att.push(`<div class="wl-r wl-att"><span class="wl-ico w">${rvIc("wallet")}</span><div class="wl-mid"><b>${escH(buyerName)} asked for ${fN(f.amount_naira)}</b>
        <small>${hasAcct ? `To ${escH(f.req_account_name || "—")} · ${escH(f.req_bank_name || "")} ${escH(f.req_account_number)}` : "Older request with no Meta account number. Decline it and ask for a new one."} · ${ago(f.requested_at)}${f.note ? " · " + escH(f.note) : ""}</small>
        ${f.last_verify_error ? `<small class="bad">${escH(f.last_verify_error)}</small>` : ""}
        ${hasAcct && hours >= 1 && !f.last_verify_error ? `<small class="warn">Waiting ${hours < 24 ? Math.floor(hours) + " h" : Math.floor(hours / 24) + " d"}. The Meta account number may have expired. Re-check, or approve: it is checked again before anything is sent.</small>` : ""}
        ${sh ? `<small class="bad">Funding wallet is short by ${fN(Number(f.amount_naira) - fundingWalletBalance - reserved)}</small>` : ""}</div>
        <div class="wl-btns">${hasAcct ? `<button type="button" class="rv-btn s fundRecheckBtn" data-id="${f.id}">Re-check</button>` : ""}<button type="button" class="rv-btn s fundDeclineBtn" data-id="${f.id}">Decline</button>${hasAcct && !sh ? `<button type="button" class="rv-btn s p fundSendBtn" data-id="${f.id}" data-summary="${escH(summary)}">Approve and send</button>` : ""}</div></div>`);
    }
    for (const r of rw?.requests?.filter((x) => x.status === "pending") || []) {
      att.push(`<div class="wl-r wl-att"><span class="wl-ico w">${rvIc("wallet")}</span><div class="wl-mid"><b>${escH((rw.buyers || []).find((b) => b.id === r.media_buyer_id)?.name || "Buyer")} asks for ${fN(r.amount_naira)}</b><small>Revora wallet${r.note ? " · " + escH(r.note) : ""} · ${ago(r.requested_at)}</small></div>
        <div class="wl-btns"><button type="button" class="rv-btn s" onclick="bvDecideWalletReq('${r.id}','decline',this)">Decline</button><button type="button" class="rv-btn s p" onclick="bvDecideWalletReq('${r.id}','approve',this)">Send to their wallet</button></div></div>`);
    }
    for (const r of pendingByPayment.values()) {
      const dep = heldDeposits.find((p) => p.id === r.payment_id), bn = (buyers || []).find((b) => b.id === r.media_buyer_id)?.name || "—";
      att.push(`<div class="wl-r wl-att"><span class="wl-ico b">${rvIc("check")}</span><div class="wl-mid"><b>${escH(bn)} says ${dep ? fN(dep.amount_naira) : "a deposit"} is for ${escH(r.orders?.customer_name || "an order")}</b>
        <small>${r.orders?.product_name ? escH(r.orders.product_name) + ", " + fN(r.orders.order_value_naira) + " · " : ""}${dep ? "Sent by " + escH(heldFrom(dep)) + " · " : ""}${ago(r.requested_at)}</small></div>
        <div class="wl-btns"><button type="button" class="rv-btn s" onclick="bvDecideMatch('${r.id}','decline')">Decline</button><button type="button" class="rv-btn s p" onclick="bvDecideMatch('${r.id}','approve','${r.payment_id}','${r.order_id}')">Approve</button></div></div>`);
    }
  }
  for (const p of heldDeposits) {
    att.push(`<div class="wl-r wl-att"><span class="wl-ico b">${rvIc("alert")}</span><div class="wl-mid"><b>${fN(p.amount_naira)} arrived and was not matched</b><small>${escH(heldFrom(p))}${isAdmin ? " · " + escH((buyers || []).find((b) => b.id === p.held_for_buyer_id)?.name || "") : ""} · ${p.paid_at ? new Date(p.paid_at).toLocaleString() : ""}</small></div>
      <div class="wl-btns">${pendingByPayment.has(p.id) ? `<span class="rv-pill warn">Match requested${isAdmin ? "" : " · waiting for admin"}</span>` : (isAdmin || myId) ? `<button type="button" class="rv-btn s" onclick="bvShowMatchModal('${p.id}', ${Number(p.amount_naira)})">${isAdmin ? "Match to order" : "Match to my order"}</button>` : ""}</div></div>`);
  }
  if (!isAdmin) {
    for (const f of myRequests.filter((x) => x.status === "pending" && !x.paystack_transfer_code)) {
      att.push(`<div class="wl-r wl-att"><span class="wl-ico w">${rvIc("wallet")}</span><div class="wl-mid"><b>You asked for ${fN(f.amount_naira)}</b><small>Waiting for your admin · ${ago(f.requested_at)}${f.note ? " · " + escH(f.note) : ""}</small>${f.last_verify_error ? `<small class="bad">Your admin could not check the Meta account. Send a fresh account number.</small>` : ""}</div>
        <div class="wl-btns"><button type="button" class="rv-btn s frChangeBtn" data-id="${f.id}">Fresh account number</button><button type="button" class="rv-btn s frCancelBtn" data-id="${f.id}">Cancel</button></div></div>`);
    }
  }

  const buyerHeld = !isAdmin && myId && rw && rw.my_wallet !== undefined;
  const heroLabel = isAdmin ? "Funding wallet" : buyerHeld ? "My wallet" : "Waiting for your admin";
  const heroAmt = isAdmin ? fundingWalletBalance : buyerHeld ? Math.max(0, Number(rw.my_wallet || 0)) : waiting;
  const heroSub = isAdmin
    ? (short ? "Low: you have approved more than you have deposited." : "Available to send to Meta" + (managedSpend > 0 ? ` · ${fN(managedSpend)} spent on your Revora ad accounts` : ""))
    : buyerHeld ? "Money you hold here. When an ad account runs low, send it straight to Meta. No approval needed."
    : "Ad funding you asked for. Your admin approves it and the money goes straight to your Meta ad account.";

  const collect = isAdmin
    ? `<section class="rv-card wl-sec"><div class="wl-hd"><h3>Collection accounts</h3></div>${(buyers || []).length ? (buyers || []).map((b) => `<div class="wl-r"><span class="wl-ico">${rvIc("bank")}</span><div class="wl-mid"><b>${escH(b.name)}</b><small>${escH(b.dedicated_account_bank || "No account yet")}</small></div>${b.dedicated_account_number ? `<span class="wl-mono">${escH(b.dedicated_account_number)}</span><button type="button" class="rv-btn s" onclick="wlCopy('${escH(b.dedicated_account_number)}')" aria-label="Copy">${rvIc("copy")}</button>` : ""}</div>`).join("") : `<div class="rv-empty" style="padding:6px 20px 18px">No media buyers yet.</div>`}<div class="wl-foot">Customers pay into these. Not spendable by the buyer: it lands here before it counts as revenue.</div></section>`
    : myId ? `<section class="rv-card wl-sec"><div class="wl-hd"><h3>Your collection account</h3></div><div style="padding:0 20px 18px">${myBuyerRow?.dedicated_account_number ? `<div class="wl-mono big">${escH(myBuyerRow.dedicated_account_number)}</div><div class="rv-mut3" style="margin:2px 0 12px">${escH(myBuyerRow.dedicated_account_bank || "")}</div><button type="button" class="rv-btn s" onclick="wlCopy('${escH(myBuyerRow.dedicated_account_number)}')">${rvIc("copy")}Copy number</button>` : `<div class="rv-mut3">Not set up yet. It is created the first time an order is confirmed against your name.</div>`}<div class="rv-mut3" style="margin-top:10px">Customers pay into this account once their order is confirmed.</div></div></section>` : "";

  const maxRev = Math.max(...(buyers || []).map((b) => (walletBalances[b.id] || walletBlank()).confirmed), 1);
  const byBuyer = isAdmin ? `<section class="rv-card wl-sec"><div class="wl-hd"><h3>Revenue by buyer</h3></div>${(buyers || []).length ? (buyers || []).map((b) => { const w = walletBalances[b.id] || walletBlank(); return `<div class="wl-r"><div class="wl-mid"><b>${escH(b.name)}</b><div class="wl-bar"><i style="width:${Math.max(2, Math.round(w.confirmed / maxRev * 100))}%"></i></div><small>Sent to Meta ${fN(w.transferred)}</small></div><div class="wl-am">${fN(w.confirmed)}</div></div>`; }).join("") : `<div class="rv-empty" style="padding:6px 20px 18px">No media buyers yet.</div>`}<div class="wl-foot">For ROAS and seeing who brings in what. Not a per-buyer balance.</div></section>` : "";

  const auto = isAdmin && (buyers || []).filter((b) => b.id !== myId).length ? `<section class="rv-card wl-sec"><div class="wl-hd"><h3>Auto-approve</h3></div>${(buyers || []).filter((b) => b.id !== myId).map((b) => `<div class="wl-r"><div class="wl-mid"><b>${escH(b.name)}</b><small class="${b.auto_send_enabled ? "ok" : ""}">${b.auto_send_enabled ? `On · up to ${fN(b.auto_send_max_naira)} each, ${fN(b.auto_send_daily_max_naira)} a day` : "Off · every request needs your approval"}</small></div>
      <button type="button" class="rv-btn s autoSendBtn" data-id="${b.id}" data-name="${escH(b.name)}" data-max="${b.auto_send_max_naira || ""}" data-day="${b.auto_send_daily_max_naira || ""}">${b.auto_send_enabled ? "Limits" : "Turn on"}</button>${b.auto_send_enabled ? `<button type="button" class="rv-btn s autoSendOffBtn" data-id="${b.id}" data-name="${escH(b.name)}">Turn off</button>` : ""}</div>`).join("")}
    <div class="wl-foot">When on, requests up to your limits go to Meta at once with no PIN. Revora still checks the account is Meta's, and the funding wallet must cover it. Bigger ones wait for you.</div></section>` : "";

  const rcPill = (st) => st === "delivered" ? `<span class="rv-pill ok">Sent</span>` : st === "failed" ? `<span class="rv-pill bad">Failed</span>` : `<span class="rv-pill warn">Processing</span>`;
  const rcpts = (receipts || []).length ? `<section class="rv-card wl-sec"><div class="wl-hd"><h3>Transfer receipts</h3></div>${receipts.slice(0, 8).map((r) => `<div class="wl-r"><div class="wl-mid"><b>${fN(r.amount_naira)} to ${escH(r.account_name || "—")}</b><small>RV-${new Date(r.created_at).getUTCFullYear()}-${String(r.receipt_no).padStart(6, "0")} · ${escH(r.bank_name || "")} · ${r.source === "assistant" ? "AI assistant" : "Dashboard"} · ${ago(r.created_at)}</small></div>${rcPill(r.status)}<button type="button" class="rv-btn s" onclick="window.open('receipt.html?r=${r.id}','_blank')">Receipt</button></div>`).join("")}</section>` : "";

  const flBuyer = (id) => (buyers || []).find((b) => b.id === id)?.name || "";
  const logsSec = `<section class="rv-card wl-sec"><div class="wl-hd"><h3>Funds received</h3><div style="flex:1"></div><button type="button" class="rv-btn s" onclick="bvLogFundsModal()">Log</button></div>${fundLogs.length ? fundLogs.slice(0, 8).map((l) => `<div class="wl-r"><div class="wl-mid"><b>${fN(l.amount_naira)}</b><small>${escH(l.log_date)}${isAdmin && flBuyer(l.media_buyer_id) ? " · " + escH(flBuyer(l.media_buyer_id)) : ""}${l.note ? " · " + escH(l.note) : ""}</small></div><button type="button" class="rv-btn s" onclick="wlDelLog('${l.id}')">Remove</button></div>`).join("") : `<div class="rv-empty" style="padding:6px 20px 18px">Log money you receive for ads and it shows in your daily reports.</div>`}</section>`;
  el.innerHTML = `<div class="rv-ui" id="wlRoot">
    <div class="rv-head"><div><h1>Wallet</h1><p class="rv-hm">Money in, money out, and what is waiting for you</p></div><div style="flex:1"></div>
      <button type="button" class="rv-btn rv-hm" onclick="wlExport()">${rvIc("dl")}Statement</button><button type="button" class="rv-btn" onclick="renderWallet(document.getElementById('mainContent'))" aria-label="Refresh">${rvIc("refresh")}</button></div>
    <div class="wl-top">
      <section class="wl-bal${short ? " neg" : ""}"><div class="wl-bl">${rvIc("wallet")}${heroLabel}</div><div class="wl-ba"><small>₦</small>${Math.round(heroAmt).toLocaleString("en-NG")}</div><div class="wl-bs">${escH(heroSub)}</div>
        <div class="wl-acts">${isAdmin ? `<button type="button" class="wl-act p" onclick="bvShowAddFundsModal()"><i>${rvIc("plus")}</i>${short ? "Top up now" : "Add money"}</button>${myId ? `<button type="button" class="wl-act" onclick="bvShowRequestFundsModal()"><i>${rvIc("ext")}</i>Send to Meta</button>` : ""}<button type="button" class="wl-act" onclick="bvShowAdminWithdrawModal()"><i>${rvIc("arrup")}</i>Send money</button>` : buyerHeld ? `<button type="button" class="wl-act p" onclick="bvTopUpModal('me')"><i>${rvIc("plus")}</i>Add money</button><button type="button" class="wl-act" onclick="bvShowSendToMetaModal()"><i>${rvIc("ext")}</i>Send to Meta</button><button type="button" class="wl-act" onclick="bvLogFundsModal()"><i>${rvIc("check")}</i>Log funds received</button>` : myId ? `<button type="button" class="wl-act p" onclick="bvShowRequestFundsModal()"><i>${rvIc("plus")}</i>Request funds</button>` : ""}${isAdmin ? `<button type="button" class="wl-act" onclick="bvLogFundsModal()"><i>${rvIc("check")}</i>Log funds received</button>` : ""}</div></section>
      <section class="rv-card wl-rev"><div class="wl-rl">${rvIc("chart")}${isAdmin ? "Revenue collected" : "Your confirmed revenue"}</div><div class="wl-ra">${fN(revenueNow)}</div>
        <div class="rv-mut3">${spark ? `${fN(spark.total)} in the last 14 days` : isAdmin ? "Every confirmed customer payment, all buyers" : "Confirmed payments on orders you generated"}</div>
        ${spark ? `<svg class="wl-sp" viewBox="0 0 300 74" preserveAspectRatio="none"><defs><linearGradient id="wlg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".22"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><path d="${spark.area}" fill="url(#wlg)"/><path d="${spark.line}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>` : ""}
        <div class="wl-foot2">For reference. It does not fund requests by itself.</div></section></div>
    <div class="wl-ah"><h3>Ad account balances</h3></div><div id="wlAdCards" class="wl-adc"><div class="rv-note"><span class="spin"></span><span>Reading live balances from Meta…</span></div></div>
    <div class="wl-grid"><div class="wl-col">
      ${att.length ? `<section class="rv-card wl-sec"><div class="wl-hd"><h3>Needs your attention</h3><span class="rv-pill warn n">${att.length}</span></div>${att.join("")}</section>` : ""}
      <section class="rv-card wl-sec"><div class="wl-hd"><h3>Transactions</h3><div style="flex:1"></div><div class="rv-seg" id="wlTabs">${[["all", "All"], ["in", "Money in"], ["out", "Money out"]].map(([k, l]) => `<button type="button" data-wltab="${k}" class="${WL.tab === k ? "on" : ""}">${l}</button>`).join("")}</div></div><div id="wlLedger">${wlLedgerHtml()}</div></section>
    </div><div class="wl-col">${logsSec}${collect}${wlRevoraHtml(rw, isAdmin)}${byBuyer}${auto}${rcpts}</div></div></div>`;
  el.onclick = (e) => {
    const t = e.target.closest("[data-wltab]"); if (t && t.closest("#wlRoot")) { WL.tab = t.dataset.wltab; WL.more = 20; document.querySelectorAll("#wlTabs button").forEach((b) => b.classList.toggle("on", b === t)); document.getElementById("wlLedger").innerHTML = wlLedgerHtml(); return; }
    if (e.target.closest("[data-wlmore]")) { WL.more += 30; document.getElementById("wlLedger").innerHTML = wlLedgerHtml(); }
  };
  wlFillAdCards();

  document.querySelectorAll(".fundSendBtn").forEach(btn => btn.addEventListener("click", () => bvShowSendPinModal(btn.dataset.id, btn.dataset.summary)));
  document.querySelectorAll(".fundRecheckBtn").forEach(btn => btn.addEventListener("click", async () => {
    btn.disabled = true; btn.textContent = "Checking…";
    try {
      const r = await sbFn("fund-request-send", { action: "recheck", fund_request_id: btn.dataset.id });
      if (r.error) throw new Error(r.error);
      bvToast(r.verified ? `Still valid: ${r.account_name}` : "Could not verify. See the note on the request.");
    } catch (err) { alert(err.message); }
    renderWallet(el);
  }));
  document.querySelectorAll(".fundDeclineBtn").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Decline this funding request?")) return;
    btn.disabled = true;
    const { error } = await supabaseClient.from("fund_requests").update({
      status: "declined",
      decided_at: new Date().toISOString(),
      decided_by: sessionData.user.id,
    }).eq("id", btn.dataset.id).in("status", ["pending", "approved"]);
    if (error) { alert("Could not update request: " + error.message); btn.disabled = false; return; }
    sbFn("send-internal-whatsapp", { type: "fund_request_decided", fund_request_id: btn.dataset.id }).catch(() => {});
    sbFn("send-internal-email", { type: "fund_request_decided", fund_request_id: btn.dataset.id }).catch(() => {});
    renderWallet(el);
  }));
  const autoModal = (id, name, enable, max, day) => {
    bvCloseModal();
    const overlay = document.createElement("div");
    overlay.id = "bvModalOverlay"; overlay.className = "bv-overlay";
    overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
    overlay.innerHTML = `<div class="bv-modal"><button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
      <div class="ph-title" style="margin-bottom:6px;">${enable ? "Auto-approve for " + escH(name) : "Turn off auto-approve for " + escH(name)}</div>
      <form id="autoSendForm" novalidate>
        ${enable ? `<div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;">Requests up to these limits are sent to Meta at once, with no PIN from you. Anything bigger waits for your approval.</div>
        <div class="fg">
          <div class="field"><label>Most for one request (₦) *</label><input id="autoMax" type="number" min="100" step="1" value="${max || ""}" placeholder="e.g. 50000"></div>
          <div class="field"><label>Most per 24 hours (₦) *</label><input id="autoDay" type="number" min="100" step="1" value="${day || ""}" placeholder="e.g. 150000"></div>
        </div>` : ""}
        <div class="field" style="margin-top:8px;"><label>Your transfer PIN *</label><input id="autoPin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="4 to 6 digits"></div>
        <button type="submit" class="btn btn-a btn-full" style="margin-top:12px;" id="autoBtn">${enable ? "Save" : "Turn off"}</button>
        <div id="autoMsg"></div>
      </form></div>`;
    document.body.appendChild(overlay);
    document.getElementById("autoSendForm").addEventListener("submit", async e => {
      e.preventDefault();
      const btn = document.getElementById("autoBtn"), msg = document.getElementById("autoMsg");
      const pin = document.getElementById("autoPin").value.trim();
      if (!/^\d{4,6}$/.test(pin)) { msg.innerHTML = `<div class="msg err">❌ Enter your 4 to 6 digit transfer PIN.</div>`; return; }
      const body = { action: "set_auto", media_buyer_id: id, enabled: enable, pin };
      if (enable) { body.max_naira = Number(document.getElementById("autoMax").value); body.daily_max_naira = Number(document.getElementById("autoDay").value); }
      btn.disabled = true;
      try {
        const r = await sbFn("fund-request-send", body);
        if (r.error) throw new Error(r.error);
        bvCloseModal(); bvToast(enable ? "Auto-approve is on" : "Auto-approve is off"); renderWallet(el);
      } catch (err) { msg.innerHTML = `<div class="msg err">❌ ${escH(err.message)}</div>`; btn.disabled = false; }
    });
  };
  document.querySelectorAll(".autoSendBtn").forEach(btn => btn.addEventListener("click", () => autoModal(btn.dataset.id, btn.dataset.name, true, btn.dataset.max, btn.dataset.day)));
  document.querySelectorAll(".autoSendOffBtn").forEach(btn => btn.addEventListener("click", () => autoModal(btn.dataset.id, btn.dataset.name, false)));
  document.querySelectorAll(".frChangeBtn").forEach(btn => btn.addEventListener("click", () => bvShowRequestFundsModal(btn.dataset.id)));
  document.querySelectorAll(".frCancelBtn").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Cancel this request?")) return;
    btn.disabled = true;
    const r = await sbFn("fund-request-submit", { action: "cancel", fund_request_id: btn.dataset.id }).catch(e => ({ error: e.message }));
    if (r.error) { alert(r.error); btn.disabled = false; return; }
    renderWallet(el);
  }));
}


