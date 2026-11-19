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

async function renderWalletLegacy(el) {
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


// =====================================================================================================================
// WALLET v2: a short home (balance, four actions, ad accounts, last few movements) and one screen per job.
// Money moves through the wallet-topup function (fees, lookup, send, activity, requests) and fund-request-submit (Meta).
// =====================================================================================================================
Object.assign(RV_IC, {
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M17.9 17.9A10.9 10.9 0 0112 20C5 20 1 12 1 12a18.5 18.5 0 015.1-5.9M9.9 4.2A9.1 9.1 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.2 3.2M1 1l22 22"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8zM7.5 7.5h.01"/>',
  users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.5-6.9A2 2 0 0016.8 4H7.2a2 2 0 00-1.7 1.1z"/>',
});

const W2 = { view: "home", ov: null, fees: null, acc: null, acts: null, filter: "all", sel: null, send: {}, meta: {}, msg: "", hide: false, role: "", mb: null };
try { W2.hide = localStorage.getItem("rv_wl_hide") === "1"; } catch {}

// ---- fee maths, the same as the database (rv_fee) and Paystack's card charge ----
function w2Fee(kind, amount) {
  const f = (W2.fees || []).find((x) => x.kind === kind); if (!f || !f.enabled || !(amount > 0)) return 0;
  let v = amount * Number(f.pct) / 100 + Number(f.flat_naira);
  if (v < Number(f.min_naira)) v = Number(f.min_naira);
  if (Number(f.cap_naira) > 0 && v > Number(f.cap_naira)) v = Number(f.cap_naira);
  return Math.round(v);
}
function w2Charge(net) {
  const flat = net >= 2500 ? 100 : 0; let gross = Math.ceil((net + flat) / 0.985);
  if (gross - net > 2000) gross = net + 2000; if (net < 2500) gross = Math.ceil(net / 0.985); return gross;
}
const w2Money = (n) => "₦" + Math.round(Math.abs(Number(n) || 0)).toLocaleString("en-NG");
const w2Signed = (n) => (n >= 0 ? "+" : "−") + w2Money(n);
const w2Admin = () => W2.role === "owner" || W2.role === "admin";
const w2FeeText = (kind) => {
  const f = (W2.fees || []).find((x) => x.kind === kind); if (!f || !f.enabled) return "No fee";
  const parts = []; if (Number(f.pct) > 0) parts.push(Number(f.pct) + "%"); if (Number(f.flat_naira) > 0) parts.push(w2Money(f.flat_naira));
  return (parts.join(" + ") || "Fee") + (Number(f.min_naira) > 0 ? ` · min ${w2Money(f.min_naira)}` : "") + (Number(f.cap_naira) > 0 ? ` · max ${w2Money(f.cap_naira)}` : "");
};

async function renderWallet(el) {
  W2.el = document.getElementById("mainContent") || el;
  if (!document.getElementById("wlRoot2")) { W2.view = "home"; W2.send = {}; W2.meta = {}; W2.legacy = undefined; }
  W2.role = window.myProfile?.role || ""; W2.mb = window.myProfile?.media_buyer_id || null;
  if (!W2.ov) W2.el.innerHTML = `<div class="rv-ui"><div class="rv-note"><span class="spin"></span><span>Opening your wallet…</span></div></div>`;
  const [ov, fees] = await Promise.all([sbFn("wallet-topup", { action: "overview" }).catch((e) => ({ error: e.message })), sbFn("wallet-topup", { action: "fees" }).catch(() => null)]);
  W2.ov = ov && !ov.error ? ov : null; W2.err = ov?.error || ""; W2.fees = fees?.fees || W2.fees || [];
  W2.acts = null; w2Draw();
  w2LoadActs(); w2LoadAccounts();
}
async function w2LoadActs() {
  const r = await sbFn("wallet-topup", { action: "activity", limit: 60 }).catch(() => null);
  W2.acts = r && r.ok ? r.items : []; w2Draw();
}
async function w2LoadAccounts() {
  const list = await wlBalances().catch(() => null); W2.acc = (list || []).filter((a) => !a.error && a.is_prepay && a.available != null);
  if (document.getElementById("wlRoot2")) w2Draw();
}
function w2Go(v, sel) { W2.view = v; if (sel !== undefined) W2.sel = sel; W2.msg = ""; w2Draw(); try { W2.el.scrollIntoView({ block: "start" }); } catch {} }
function w2Hide() { W2.hide = !W2.hide; try { localStorage.setItem("rv_wl_hide", W2.hide ? "1" : "0"); } catch {} w2Draw(); }

function w2Day(iso) {
  const d = new Date(iso), t = new Date(), y = new Date(Date.now() - 864e5);
  const same = (a, b) => a.toDateString() === b.toDateString();
  return same(d, t) ? "Today" : same(d, y) ? "Yesterday" : d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}
function w2Row(x) {
  const out = x.amount < 0, ic = x.kind === "to_meta" ? "arrup" : x.kind === "sent_to_user" ? "send" : out ? "arrup" : "arrdn";
  const idx = (W2.acts || []).indexOf(x);
  return `<button type="button" class="w2-row" onclick="w2Go('receipt', ${idx})"><span class="w2-ic ${out ? "out" : "in"}">${rvIc(ic)}</span>
    <span class="w2-t"><b>${escH(x.title)}</b><small>${escH(x.sub ? x.sub + " · " : "")}${new Date(x.at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}</small></span>
    <span class="w2-a ${out ? "" : "pos"}">${w2Signed(x.amount)}${x.fee > 0 ? `<small>fee ${w2Money(x.fee)}</small>` : ""}</span></button>`;
}
function w2Groups(items) {
  let last = "", html = "";
  for (const x of items) { const d = w2Day(x.at); if (d !== last) { html += `<div class="w2-day">${escH(d)}</div>`; last = d; } html += w2Row(x); }
  return html;
}

// ------------------------------------------------------------------ screens
function w2Home() {
  const ov = W2.ov, admin = w2Admin();
  const mine = ov ? Number(ov.me_wallet || 0) : 0, inMeta = (W2.acc || []).reduce((t, a) => t + Number(a.available || 0), 0);
  const pend = ov ? (ov.requests || []).filter((r) => r.status === "pending").length : 0;
  const amt = (n) => (W2.hide ? "••••••" : w2Money(n));
  const accs = W2.acc == null ? `<div class="w2-sk"></div><div class="w2-sk"></div>` : (W2.acc.length ? W2.acc.slice(0, 6).map((a) => `<button type="button" class="w2-mini${a.low_threshold != null && a.available <= a.low_threshold ? " low" : ""}" onclick="${admin ? "" : "w2Go('meta')"}"><small>${escH(a.name)}</small><b>${W2.hide ? "••••" : w2Money(a.available)}</b>${a.low_threshold != null && a.available <= a.low_threshold ? '<span class="chip">Low · top up</span>' : ""}</button>`).join("") : `<div class="w2-empty">No prepaid ad accounts to show.</div>`);
  const recent = W2.acts == null ? `<div class="w2-sk" style="height:56px"></div>` : (W2.acts.length ? W2.acts.slice(0, 3).map(w2Row).join("") : `<div class="w2-empty">Nothing yet. Add money to get started.</div>`);
  return `<div class="w2-head"><h1>Wallet</h1><button type="button" class="w2-ibtn" onclick="renderWallet(W2.el)" aria-label="Refresh">${rvIc("refresh")}</button></div>
    ${W2.err ? `<div class="rv-note warn">${escH(W2.err)}</div>` : ""}
    <div class="w2-card"><div class="w2-cl">${admin ? "Funding wallet" : "My wallet"}<button type="button" class="w2-eye" onclick="w2Hide()" aria-label="${W2.hide ? "Show" : "Hide"} balance">${rvIc(W2.hide ? "eyeoff" : "eye")}</button></div>
      <div class="w2-ca">${amt(mine)}</div>
      <div class="w2-cs"><span>In ad accounts <b>${W2.acc == null ? "…" : amt(inMeta)}</b></span><span>Total <b>${W2.acc == null ? "…" : amt(mine + inMeta)}</b></span></div></div>
    <div class="w2-acts">
      <button type="button" class="w2-act p" onclick="w2Go('add')"><i>${rvIc("plus")}</i>Add money</button>
      ${admin ? `<button type="button" class="w2-act" onclick="w2Go('requests')"><i>${rvIc("inbox")}</i>Requests${pend ? `<em>${pend}</em>` : ""}</button>` : `<button type="button" class="w2-act" onclick="w2Go('request')"><i>${rvIc("arrdn")}</i>Request</button>`}
      <button type="button" class="w2-act" onclick="w2Go('send')"><i>${rvIc("send")}</i>Send</button>
      ${admin ? `<button type="button" class="w2-act" onclick="w2Go('team')"><i>${rvIc("users")}</i>Team</button>` : `<button type="button" class="w2-act" onclick="w2Go('meta')"><i>${rvIc("arrup")}</i>To Meta</button>`}
    </div>
    <div class="w2-sec"><h3>Ad accounts</h3></div><div class="w2-strip">${accs}</div>
    <div class="w2-sec"><h3>Recent</h3><button type="button" class="w2-lnk" onclick="w2Go('activity')">See all</button></div><div class="w2-list">${recent}</div>
    <div class="w2-tiles">
      <button type="button" class="w2-tile" onclick="w2Go('activity')"><i>${rvIc("list")}</i><span>Transactions<small>Everything in and out</small></span></button>
      ${admin ? "" : `<button type="button" class="w2-tile" onclick="w2Go('requests')"><i>${rvIc("inbox")}</i><span>Requests${pend ? ` · ${pend}` : ""}<small>Asked of your admin</small></span></button>`}
      <button type="button" class="w2-tile" onclick="w2Go('fees')"><i>${rvIc("tag")}</i><span>Fees<small>What Revora charges</small></span></button>
      <button type="button" class="w2-tile" onclick="w2Statement()"><i>${rvIc("dl")}</i><span>Statement<small>Download as CSV</small></span></button>
      ${admin ? `<button type="button" class="w2-tile" onclick="w2Go('old')"><i>${rvIc("bank")}</i><span>More tools<small>Collection accounts, auto-approve</small></span></button>` : ""}
    </div>`;
}
function w2Nav(title, back = "home") { return `<div class="w2-nav"><button type="button" class="w2-ibtn" onclick="w2Go('${back}')" aria-label="Back">${rvIc("back")}</button><h2>${escH(title)}</h2></div>`; }
function w2Lines(lines) { return `<div class="w2-sum">${lines.map((l) => `<div class="w2-ln ${l[2] || ""}"><span>${escH(l[0])}</span><span>${l[1]}</span></div>`).join("")}</div>`; }

function w2Activity() {
  const f = W2.filter, all = W2.acts || [];
  const list = all.filter((x) => f === "all" || (f === "in" && x.amount > 0) || (f === "out" && x.amount < 0) || (f === "fees" && x.fee > 0));
  return `${w2Nav("Transactions")}<div class="w2-chips">${[["all", "All"], ["in", "Money in"], ["out", "Money out"], ["fees", "Fees"]].map(([k, l]) => `<button type="button" class="w2-chip${f === k ? " on" : ""}" onclick="W2.filter='${k}';w2Draw()">${l}</button>`).join("")}</div>
    <div class="w2-list">${W2.acts == null ? `<div class="w2-sk" style="height:60px"></div><div class="w2-sk" style="height:60px"></div>` : list.length ? w2Groups(list) : `<div class="w2-empty">Nothing here yet.</div>`}</div>`;
}
function w2Receipt() {
  const x = (W2.acts || [])[W2.sel]; if (!x) return `${w2Nav("Receipt", "activity")}<div class="w2-empty">That transaction is not available.</div>`;
  const out = x.amount < 0, amount = Math.abs(x.amount);
  const lines = [["Date", escH(new Date(x.at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }))]];
  if (x.sub) lines.push(["Details", escH(x.sub)]);
  lines.push([out ? "Amount" : "Amount received", w2Money(amount)]);
  if (x.fee > 0) lines.push(["Fees", w2Money(x.fee), "fee"]);
  lines.push([out ? "Total paid" : "Credited to wallet", w2Money(out ? amount + x.fee : amount), "tot"]);
  lines.push(["Reference", escH(String(x.ref || x.id).slice(-10).toUpperCase())]);
  return `${w2Nav("Receipt", "activity")}<div class="w2-rcpt"><div class="w2-ok ${out ? "out" : ""}">${rvIc(out ? "arrup" : "check", 26)}</div><small>${escH(x.title)}</small><div class="n">${w2Money(amount)}</div></div>${w2Lines(lines)}
    <button type="button" class="w2-cta" onclick="w2Copy(${W2.sel})">Copy receipt</button>`;
}
function w2Copy(i) {
  const x = (W2.acts || [])[i]; if (!x) return;
  const t = `Revora receipt\n${x.title}\n${w2Money(Math.abs(x.amount))}${x.fee > 0 ? `\nFees: ${w2Money(x.fee)}` : ""}\n${new Date(x.at).toLocaleString("en-NG")}\nRef ${String(x.ref || x.id).slice(-10).toUpperCase()}`;
  try { navigator.clipboard.writeText(t); bvToast("Receipt copied"); } catch { bvToast("Could not copy", "err"); }
}
async function w2Statement() {
  const r = await sbFn("wallet-topup", { action: "activity", limit: 100 }).catch(() => null);
  if (!r || !r.ok || !r.items.length) { bvToast("Nothing to export yet", "err"); return; }
  const rows = [["Date", "Description", "Details", "Amount", "Fee"], ...r.items.map((x) => [new Date(x.at).toISOString(), x.title, x.sub || "", x.amount, x.fee || 0])];
  const csv = rows.map((l) => l.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "revora-wallet-statement.csv"; a.click();
}

// ---- Add money (card; the Paystack charge is added at checkout, Revora's deposit fee comes off what lands) ----
function w2Add() {
  const bank = W2.addMode === "bank";
  const seg = `<div class="w2-seg"><button type="button" class="${bank ? "" : "on"}" onclick="W2.addMode='card';w2Draw()">Card</button><button type="button" class="${bank ? "on" : ""}" onclick="W2.addMode='bank';w2Draw();w2LoadDva()">Bank transfer</button></div>`;
  if (bank) {
    const d = W2.dva, admin = w2Admin();
    const acct = d === undefined ? `<div class="w2-sk" style="height:140px"></div>` : d && d.account ? `<div class="w2-acct"><small>${escH(d.account.bank || "")}</small><div class="no">${escH(d.account.number)}</div><small>${escH(d.account.name || "")}</small>
        <button type="button" class="w2-sbtn" onclick="w2CopyAcct()">Copy account number</button></div>` : `<div class="w2-empty">${d && d.error ? escH(d.error) : "You do not have an account number yet."}<br><button type="button" class="w2-cta" style="margin-top:12px" onclick="w2LoadDva(true)">Get my account number</button></div>`;
    return `${w2Nav("Add money")}${seg}${acct}
      <div class="w2-sum"><div class="w2-ln"><span>Paystack fee</span><span>Taken from what you send</span></div><div class="w2-ln"><span>Revora deposit fee</span><span>${escH(w2FeeText("deposit"))}</span></div></div>
      <div class="w2-hint">${admin ? "This is your company account. A payment that matches a customer's order goes to that order; anything else lands in your funding wallet." : "Send from any bank, any time. The money is added to your wallet within a minute or two, minus the fees above, and you get a notification."}</div>`;
  }
  const amt = Number(W2.addAmt || 50000), charged = w2Charge(amt), rf = w2Fee("deposit", amt);
  return `${w2Nav("Add money")}${seg}
    <div class="w2-big"><small>Amount</small><input id="w2AddAmt" type="number" inputmode="numeric" min="1000" step="500" value="${amt}" oninput="W2.addAmt=this.value;w2AddSum()"><div class="w2-qs">${[10000, 20000, 50000, 100000].map((n) => `<button type="button" class="w2-chip${amt === n ? " on" : ""}" onclick="W2.addAmt=${n};w2Draw()">${n / 1000}k</button>`).join("")}</div></div>
    <div id="w2AddSum">${w2Lines([["You pay at checkout", `<b>${w2Money(charged)}</b>`], ["Paystack fee (added at checkout)", w2Money(charged - amt), "fee"], ["Revora deposit fee", "−" + w2Money(rf), "fee"], ["Lands in your wallet", w2Money(amt - rf), "tot g"]])}</div>
    <div class="w2-hint">Card, bank and USSD options appear on the Paystack page. The money is added as soon as the payment is confirmed.</div>
    <div id="w2Msg" class="w2-msg"></div><button type="button" class="w2-cta" id="w2AddGo" onclick="w2AddGo()">Continue to payment</button>`;
}
async function w2LoadDva(create) {
  if (W2.dva !== undefined && !create) return;
  const r = await sbFn("wallet-topup", { action: "dva", create: !!create }).catch((e) => ({ error: e.message }));
  W2.dva = r && r.ok ? r : { error: r?.error || "Could not load your account number." }; if (W2.view === "add") w2Draw();
}
function w2CopyAcct() { try { navigator.clipboard.writeText(W2.dva.account.number); bvToast("Account number copied"); } catch { bvToast("Could not copy", "err"); } }
function w2AddSum() {
  const amt = Number(W2.addAmt || 0), box = document.getElementById("w2AddSum"); if (!box) return;
  const charged = w2Charge(amt), rf = w2Fee("deposit", amt);
  box.innerHTML = w2Lines([["You pay at checkout", `<b>${w2Money(charged)}</b>`], ["Paystack fee (added at checkout)", w2Money(charged - amt), "fee"], ["Revora deposit fee", "−" + w2Money(rf), "fee"], ["Lands in your wallet", w2Money(amt - rf), "tot g"]]);
}
async function w2AddGo() {
  const amt = Math.round(Number(W2.addAmt || 0)), msg = document.getElementById("w2Msg"), btn = document.getElementById("w2AddGo");
  if (!(amt >= 1000)) { msg.textContent = "Add at least ₦1,000."; return; }
  btn.disabled = true; btn.textContent = "Starting…";
  const r = await sbFn("wallet-topup", { action: "start", amount: amt, target: w2Admin() ? "company" : undefined, return_url: location.origin + location.pathname + "?wallet=done" }).catch((e) => ({ error: e.message }));
  if (r.error || !r.authorization_url) { msg.textContent = r.error || "Could not start the payment."; btn.disabled = false; btn.textContent = "Continue to payment"; return; }
  location.href = r.authorization_url;
}

// ---- Send to a Revora user (any company), found by phone number or email ----
function w2PersonCard(p) { return `<button type="button" class="w2-person" onclick="w2Pick('${p.user_id}')"><span class="w2-av">${escH((p.name || "?").slice(0, 1).toUpperCase())}</span><span class="w2-t"><b>${escH(p.name)}</b><small>${escH(p.role === "buyer" ? "Media buyer" : "Admin")} · ${escH(p.company || "")} · ${escH(p.hint || "")}</small></span></button>`; }
function w2Send() {
  const s = W2.send, mine = Number(W2.ov?.me_wallet || 0);
  if (s.done) return `${w2Nav("Sent", "home")}<div class="w2-rcpt"><div class="w2-ok">${rvIc("check", 26)}</div><small>Sent to ${escH(s.done.to_name || "")}</small><div class="n">${w2Money(s.done.amount)}</div></div>
    ${w2Lines([["To", escH(s.done.to_name || "")], ["Amount", w2Money(s.done.amount)], ["Revora fee", w2Money(s.done.fee), "fee"], ["Total from your wallet", w2Money(s.done.sender_pays), "tot"]])}<button type="button" class="w2-cta" onclick="W2.send={};w2Go('home');renderWallet(W2.el)">Done</button>`;
  if (!s.to) return `${w2Nav("Send")}<div class="w2-hint" style="margin-bottom:8px">Send to anyone on Revora, in any company, with their phone number or email. It lands in their wallet at once.</div>
    <div class="w2-find"><input id="w2Key" type="text" inputmode="email" placeholder="Phone number or email" value="${escH(s.key || "")}" onkeydown="if(event.key==='Enter')w2Find()"><button type="button" class="w2-go" onclick="w2Find()">Find</button></div>
    <div id="w2Msg" class="w2-msg">${escH(W2.msg || "")}</div>
    <div class="w2-people">${(s.people || []).map(w2PersonCard).join("")}</div>`;
  const amt = Number(s.amount || 0), fee = w2Fee("wallet", amt), f = (W2.fees || []).find((x) => x.kind === "wallet"), payer = f?.payer || "sender";
  const pays = amt + (payer === "sender" ? fee : 0), gets = amt - (payer === "receiver" ? fee : 0), short = pays > mine;
  return `${w2Nav("Send", "home")}<button type="button" class="w2-person sel" onclick="W2.send.to=null;w2Draw()"><span class="w2-av">${escH((s.to.name || "?").slice(0, 1).toUpperCase())}</span><span class="w2-t"><b>${escH(s.to.name)}</b><small>${escH(s.to.role === "buyer" ? "Media buyer" : "Admin")} · ${escH(s.to.company || "")} · change</small></span></button>
    <div class="w2-big"><small>Amount</small><input id="w2SAmt" type="number" inputmode="numeric" min="100" step="100" placeholder="0" value="${amt || ""}" oninput="W2.send.amount=this.value;w2SendUpdate()"><small>Available ${w2Money(mine)}</small></div>
    <label class="w2-f">Note (optional)<input id="w2SNote" maxlength="120" placeholder="What is it for?" value="${escH(s.note || "")}" oninput="W2.send.note=this.value"></label>
    <div id="w2SSum">${w2SendSum(amt, fee, payer, pays, gets, short)}</div>
    <div id="w2Msg" class="w2-msg">${escH(W2.msg || "")}</div><button type="button" class="w2-cta" id="w2SGo" ${amt >= 100 && !short ? "" : "disabled"} onclick="w2SendGo()">Send ${amt > 0 ? w2Money(amt) : ""}</button>`;
}
function w2SendSum(amt, fee, payer, pays, gets, short) {
  const lines = [[escH(W2.send.to?.name || "They") + " receives", w2Money(gets)], ["Revora fee" + (payer === "receiver" ? " (paid by them)" : ""), (payer === "sender" ? "+" : "") + w2Money(fee), "fee"], ["Total from your wallet", w2Money(pays), "tot"]];
  return w2Lines(lines) + (short ? `<div class="w2-hint bad">Not enough in your wallet. Add ${w2Money(pays - Number(W2.ov?.me_wallet || 0))} or send less.</div>` : "");
}
function w2SendUpdate() {
  const amt = Number(W2.send.amount || 0), fee = w2Fee("wallet", amt), f = (W2.fees || []).find((x) => x.kind === "wallet"), payer = f?.payer || "sender", mine = Number(W2.ov?.me_wallet || 0);
  const pays = amt + (payer === "sender" ? fee : 0), gets = amt - (payer === "receiver" ? fee : 0), short = pays > mine;
  const box = document.getElementById("w2SSum"); if (box) box.innerHTML = w2SendSum(amt, fee, payer, pays, gets, short);
  const go = document.getElementById("w2SGo"); if (go) { go.disabled = !(amt >= 100 && !short); go.textContent = "Send " + (amt > 0 ? w2Money(amt) : ""); }
}
async function w2Find() {
  const key = (document.getElementById("w2Key")?.value || "").trim(); W2.send.key = key; const msg = document.getElementById("w2Msg");
  if (key.length < 6) { msg.textContent = "Enter a full phone number or email."; return; }
  msg.textContent = "Searching…";
  const r = await sbFn("wallet-topup", { action: "lookup", key }).catch((e) => ({ error: e.message }));
  if (r.error) { msg.textContent = r.error; return; }
  W2.send.people = r.people || []; W2.msg = r.people?.length ? "" : "No one on Revora matches that phone number or email."; w2Draw();
}
function w2Pick(id) { const p = (W2.send.people || []).find((x) => x.user_id === id); if (p) { W2.send.to = p; w2Draw(); } }
function w2Pin(title, run) {
  bvCloseModal();
  const ov = document.createElement("div"); ov.id = "bvModalOverlay"; ov.className = "bv-overlay"; ov.onclick = (e) => { if (e.target === ov) bvCloseModal(); };
  ov.innerHTML = `<div class="bv-modal"><button class="bv-modal-close" onclick="bvCloseModal()">✕</button><div class="ph-title" style="margin-bottom:6px;">${escH(title)}</div>
    <form id="w2PinForm" novalidate><div class="field"><label>Your transfer PIN</label><input id="w2PinIn" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="4 to 6 digits"></div>
    <button type="submit" class="btn btn-a btn-full" style="margin-top:12px;" id="w2PinBtn">Confirm</button><div id="w2PinMsg" style="margin-top:8px;"></div></form></div>`;
  document.body.appendChild(ov); document.getElementById("w2PinIn").focus();
  document.getElementById("w2PinForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const pin = document.getElementById("w2PinIn").value.trim(), btn = document.getElementById("w2PinBtn"), msg = document.getElementById("w2PinMsg");
    if (!/^\d{4,6}$/.test(pin)) { msg.innerHTML = `<div class="msg err">❌ Enter your 4 to 6 digit transfer PIN. Set one in Settings → Security if you have not.</div>`; return; }
    btn.disabled = true; btn.textContent = "Working…";
    const err = await run(pin);
    if (err) { msg.innerHTML = `<div class="msg err">❌ ${escH(err)}</div>`; btn.disabled = false; btn.textContent = "Confirm"; } else bvCloseModal();
  });
}
function w2SendGo() {
  const s = W2.send, amt = Math.round(Number(s.amount || 0)); if (!s.to || !(amt >= 100)) return;
  w2Pin(`Send ${w2Money(amt)} to ${s.to.name}`, async (pin) => {
    const r = await sbFn("wallet-topup", { action: "send", to_user: s.to.user_id, amount: amt, note: s.note || "", pin }).catch((e) => ({ error: e.message }));
    if (r.error) return r.error;
    W2.send.done = r; if (W2.ov) W2.ov.me_wallet = Number(W2.ov.me_wallet || 0) - Number(r.sender_pays || 0); w2Draw(); w2LoadActs(); return "";
  });
}

// ---- Request money from an admin (media buyers) ----
function w2Request() {
  const mine = (W2.ov?.requests || []).slice(0, 5), rf = w2Fee("deposit", Number(W2.reqAmt || 0));
  return `${w2Nav("Request money")}<div class="w2-hint" style="margin-bottom:8px">Your admin gets a notification and approves in one tap. It lands in your wallet.</div>
    <div class="w2-big"><small>Amount</small><input id="w2RAmt" type="number" inputmode="numeric" min="500" step="500" placeholder="0" value="${W2.reqAmt || ""}" oninput="W2.reqAmt=this.value;w2ReqSum()"></div>
    <label class="w2-f">What is it for?<input id="w2RNote" maxlength="200" placeholder="e.g. scaling the Friday campaign" value="${escH(W2.reqNote || "")}" oninput="W2.reqNote=this.value"></label>
    <div id="w2RSum" class="w2-hint">${Number(W2.reqAmt) > 0 ? `If approved, ${w2Money(W2.reqAmt)} less the Revora deposit fee of ${w2Money(rf)} lands in your wallet.` : ""}</div>
    <div id="w2Msg" class="w2-msg"></div><button type="button" class="w2-cta" onclick="w2ReqGo()">Send request</button>
    <div class="w2-sec" style="margin-top:14px"><h3>My requests</h3><button type="button" class="w2-lnk" onclick="w2Go('requests')">See all</button></div>
    <div class="w2-list">${mine.length ? mine.map(w2ReqRow).join("") : `<div class="w2-empty">You have not asked for anything yet.</div>`}</div>`;
}
function w2ReqSum() { const rf = w2Fee("deposit", Number(W2.reqAmt || 0)), b = document.getElementById("w2RSum"); if (b) b.textContent = Number(W2.reqAmt) > 0 ? `If approved, ${w2Money(W2.reqAmt)} less the Revora deposit fee of ${w2Money(rf)} lands in your wallet.` : ""; }
function w2ReqRow(r) {
  const st = r.status === "approved" ? ["Approved", "ok"] : r.status === "pending" ? ["Waiting", "w"] : ["Declined", "no"];
  return `<div class="w2-row static"><span class="w2-ic in">${rvIc("arrdn")}</span><span class="w2-t"><b>${w2Money(r.amount_naira)}</b><small>${new Date(r.requested_at).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}${r.note ? " · " + escH(r.note) : ""}</small></span><span class="w2-pill ${st[1]}">${st[0]}</span></div>`;
}
async function w2ReqGo() {
  const amt = Math.round(Number(W2.reqAmt || 0)), msg = document.getElementById("w2Msg");
  if (!(amt >= 500)) { msg.textContent = "Ask for at least ₦500."; return; }
  const r = await sbFn("wallet-topup", { action: "request", amount: amt, note: W2.reqNote || "" }).catch((e) => ({ error: e.message }));
  if (r.error) { msg.textContent = r.error; return; }
  W2.reqAmt = ""; W2.reqNote = ""; bvToast("Request sent to your admin"); renderWallet(W2.el);
}

// ---- Send to Meta (media buyers; comes out of the wallet, no approval) ----
function w2Meta() {
  const m = W2.meta, mine = Number(W2.ov?.me_wallet || 0), amt = Number(m.amount || 0), fee = w2Fee("transfer", amt), total = amt + fee, short = total > mine;
  if (m.done) return `${w2Nav("Sent to Meta", "home")}<div class="w2-rcpt"><div class="w2-ok">${rvIc("check", 26)}</div><small>Sent to ${escH(m.done.account_name || "Meta")}</small><div class="n">${w2Money(m.done.amount)}</div></div>
    ${w2Lines([["Amount", w2Money(m.done.amount)], ["Transfer fee", w2Money(m.done.fee), "fee"], ["Total from your wallet", w2Money(m.done.amount + m.done.fee), "tot"]])}<button type="button" class="w2-cta" onclick="W2.meta={};w2Go('home');renderWallet(W2.el)">Done</button>`;
  return `${w2Nav("Send to Meta")}<div class="w2-hint" style="margin-bottom:8px">Comes out of your wallet (${w2Money(mine)}). In Ads Manager open Billing → Add funds → Bank transfer, then enter the account number and bank Meta shows. Only Meta accounts are accepted.</div>
    ${W2.acc && W2.acc.length ? `<div class="w2-strip" style="margin-bottom:10px">${W2.acc.slice(0, 6).map((a) => `<div class="w2-mini${a.low_threshold != null && a.available <= a.low_threshold ? " low" : ""}"><small>${escH(a.name)}</small><b>${w2Money(a.available)}</b></div>`).join("")}</div>` : ""}
    <div class="w2-big"><small>Amount</small><input id="w2MAmt" type="number" inputmode="numeric" min="100" step="100" placeholder="0" value="${amt || ""}" oninput="W2.meta.amount=this.value;w2MetaUpdate()"><div class="w2-qs">${[5000, 10000, 20000].map((n) => `<button type="button" class="w2-chip${amt === n ? " on" : ""}" onclick="W2.meta.amount=${n};w2Draw()">${n / 1000}k</button>`).join("")}</div></div>
    <label class="w2-f">Bank shown by Meta<select id="w2MBank"><option value="">Loading banks…</option></select></label>
    <label class="w2-f">Account number from Meta<input id="w2MAcct" type="text" inputmode="numeric" maxlength="10" placeholder="10-digit account number" value="${escH(m.acct || "")}" oninput="W2.meta.acct=this.value"></label>
    <div id="w2MSum">${w2MetaSum(amt, fee, total, short, mine)}</div>
    <div id="w2Msg" class="w2-msg"></div><button type="button" class="w2-cta" id="w2MGo" ${amt >= 100 && !short ? "" : "disabled"} onclick="w2MetaGo()">Send ${amt > 0 ? w2Money(amt) : ""} to Meta</button>`;
}
function w2MetaSum(amt, fee, total, short, mine) {
  return w2Lines([["Meta receives", w2Money(amt)], ["Transfer fee", "+" + w2Money(fee), "fee"], ["Total from your wallet", w2Money(total), "tot"], ["Wallet after", w2Money(Math.max(0, mine - total))]]) + (short ? `<div class="w2-hint bad">Not enough in your wallet. Add ${w2Money(total - mine)} or send less.</div>` : "");
}
function w2MetaUpdate() {
  const amt = Number(W2.meta.amount || 0), fee = w2Fee("transfer", amt), total = amt + fee, mine = Number(W2.ov?.me_wallet || 0), short = total > mine;
  const box = document.getElementById("w2MSum"); if (box) box.innerHTML = w2MetaSum(amt, fee, total, short, mine);
  const go = document.getElementById("w2MGo"); if (go) { go.disabled = !(amt >= 100 && !short); go.textContent = "Send " + (amt > 0 ? w2Money(amt) : "") + " to Meta"; }
}
async function w2MetaGo() {
  const amt = Math.round(Number(W2.meta.amount || 0)), bank = document.getElementById("w2MBank")?.value, acct = (document.getElementById("w2MAcct")?.value || "").replace(/\s+/g, ""), msg = document.getElementById("w2Msg"), btn = document.getElementById("w2MGo");
  if (!bank) { msg.textContent = "Pick the bank Meta shows."; return; }
  if (!/^\d{10}$/.test(acct)) { msg.textContent = "The account number is 10 digits."; return; }
  btn.disabled = true; btn.textContent = "Checking the account and sending…";
  const r = await sbFn("fund-request-submit", { from_balance: true, amount_naira: amt, account_number: acct, bank_code: bank, note: "Sent from wallet" }).catch((e) => ({ error: e.message }));
  if (r.verified === false) { msg.textContent = "Nothing was sent. " + (r.reason || "That account was not accepted."); btn.disabled = false; btn.textContent = "Send to Meta"; return; }
  if (r.error) { msg.textContent = r.error; btn.disabled = false; btn.textContent = "Send to Meta"; return; }
  W2.meta.done = { amount: amt, fee: w2Fee("transfer", amt), account_name: r.account_name }; if (W2.ov) W2.ov.me_wallet = Number(W2.ov.me_wallet || 0) - amt - w2Fee("transfer", amt); w2Draw(); w2LoadActs();
  if (r.receipt?.id) window.open("receipt.html?r=" + r.receipt.id, "_blank");
}

// ---- Requests (admins answer them; buyers see theirs) ----
function w2Requests() {
  const ov = W2.ov || {}, admin = w2Admin(), reqs = ov.requests || [], names = Object.fromEntries((ov.buyers || []).map((b) => [b.id, b.name]));
  const legacy = W2.legacy || [];
  const row = (r) => {
    const st = r.status === "approved" ? ["Approved", "ok"] : r.status === "pending" ? ["Waiting", "w"] : ["Declined", "no"];
    return `<div class="w2-row static"><span class="w2-ic in">${rvIc("arrdn")}</span><span class="w2-t"><b>${w2Money(r.amount_naira)}${admin ? " · " + escH(names[r.media_buyer_id] || "Buyer") : ""}</b><small>${new Date(r.requested_at).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}${r.note ? " · " + escH(r.note) : ""}</small></span>
      ${admin && r.status === "pending" ? `<span class="w2-btns"><button type="button" class="w2-sbtn" onclick="bvDecideWalletReq('${r.id}','decline',this)">Decline</button><button type="button" class="w2-sbtn p" onclick="bvDecideWalletReq('${r.id}','approve',this)">Approve</button></span>` : `<span class="w2-pill ${st[1]}">${st[0]}</span>`}</div>`;
  };
  const lrow = (f) => `<div class="w2-row static"><span class="w2-ic ac">${rvIc("ext")}</span><span class="w2-t"><b>${w2Money(f.amount_naira)}${admin ? " · " + escH(names[f.media_buyer_id] || "Buyer") : ""} to ${escH(f.req_account_name || "Meta")}</b><small>${escH(f.req_bank_name || "")} ${escH(f.req_account_number || "")} · ${f.status === "approved" ? "approved" : "waiting"}</small></span>
    ${admin ? `<span class="w2-btns"><button type="button" class="w2-sbtn" onclick="w2DeclineLegacy('${f.id}')">Decline</button><button type="button" class="w2-sbtn p" onclick="w2ApproveLegacy('${f.id}')">Approve & send</button></span>` : `<span class="w2-btns"><button type="button" class="w2-sbtn" onclick="w2CancelLegacy('${f.id}')">Cancel</button></span>`}</div>`;
  return `${w2Nav("Requests")}${legacy.length ? `<div class="w2-day">Ad funding requests</div><div class="w2-list">${legacy.map(lrow).join("")}</div>` : ""}
    <div class="w2-day">Wallet requests</div><div class="w2-list">${reqs.length ? reqs.map(row).join("") : `<div class="w2-empty">No requests.</div>`}</div>${admin ? "" : `<button type="button" class="w2-cta" onclick="w2Go('request')">New request</button>`}`;
}
async function w2LoadLegacy() {
  const rows = await sbQuery("fund_requests", "select=id,amount_naira,status,media_buyer_id,req_account_name,req_bank_name,req_account_number,paystack_transfer_code,paid_from,requested_at&status=in.(pending,approved)&order=requested_at.desc&limit=20").catch(() => []);
  W2.legacy = (rows || []).filter((f) => !f.paystack_transfer_code && f.paid_from !== "buyer"); if (W2.view === "requests") w2Draw();
}
async function w2DeclineLegacy(id) {
  if (!confirm("Decline this funding request?")) return;
  const { error } = await supabaseClient.from("fund_requests").update({ status: "declined", decided_at: new Date().toISOString(), decided_by: sessionData.user.id }).eq("id", id).in("status", ["pending", "approved"]);
  if (error) { bvToast(error.message, "err"); return; }
  sbFn("send-internal-whatsapp", { type: "fund_request_decided", fund_request_id: id }).catch(() => {}); w2LoadLegacy();
}
async function w2CancelLegacy(id) {
  if (!confirm("Cancel this request?")) return;
  const r = await sbFn("fund-request-submit", { action: "cancel", fund_request_id: id }).catch((e) => ({ error: e.message }));
  if (r.error) { bvToast(r.error, "err"); return; } w2LoadLegacy();
}

// ---- Fees, Team (admins), and the old view for the rest ----
function w2Fees() {
  const rows = [["Adding money", "deposit", "Taken from every deposit: card, admin credits and approved requests."], ["Sending to Meta", "transfer", "Includes the bank's own charge."], ["Sending to another user", "wallet", "Wallet to wallet, any company."]];
  return `${w2Nav("Fees")}<div class="w2-sum">${rows.map((r) => `<div class="w2-ln col"><span><b>${r[0]}</b><small>${r[2]}</small></span><span>${escH(w2FeeText(r[1]))}</span></div>`).join("")}</div>
    <div class="w2-hint">Card payments also add Paystack's charge at checkout (1.5% + ₦100, ₦100 waived under ₦2,500, at most ₦2,000). Fees are shown before you confirm and on every receipt.</div>`;
}
function w2Team() {
  const b = W2.ov?.buyers || [], cw = Number(W2.ov?.company_wallet || 0);
  return `${w2Nav("Team wallets")}<div class="w2-sum"><div class="w2-ln"><span>Funding wallet</span><span><b>${w2Money(cw)}</b></span></div></div>
    <div class="w2-list" style="margin-top:12px">${b.length ? b.map((x) => { const nm = JSON.stringify(x.name).replace(/"/g, "&quot;"); return `<div class="w2-row static"><span class="w2-av">${escH((x.name || "?").slice(0, 1).toUpperCase())}</span><span class="w2-t"><b>${escH(x.name)}</b><small>Spent ${w2Money(x.spent)}</small></span><span class="w2-a">${w2Money(x.balance)}</span>
      <details class="w2-menu"><summary>⋯</summary><div><button type="button" onclick="bvMoveFundsModal('${x.id}', ${nm}, 'allocate')">Give funds</button><button type="button" onclick="bvTopUpModal('${x.id}', ${nm})">Top up by card</button><button type="button" onclick="bvMoveFundsModal('${x.id}', ${nm}, 'take_back')">Take back</button></div></details></div>`; }).join("") : `<div class="w2-empty">No team media buyers yet.</div>`}</div>`;
}

function w2Pane() {
  switch (W2.view) {
    case "add": return w2Add();
    case "send": return w2Send();
    case "request": return w2Request();
    case "meta": return w2Meta();
    case "requests": return w2Requests();
    case "fees": return w2Fees();
    case "team": return w2Team();
    case "receipt": return w2Receipt();
    case "old": return `<div id="w2Old"></div>`;
    default: return w2Activity();
  }
}
function w2Draw() {
  const el = W2.el; if (!el) return;
  const keep = { k: document.getElementById("w2Key")?.value, a: document.getElementById("w2SAmt")?.value };
  el.innerHTML = `<div class="rv-ui wl2" id="wlRoot2" data-view="${W2.view === "home" ? "home" : "pane"}"><div class="wl2-home">${w2Home()}</div><div class="wl2-pane">${w2Pane()}</div></div>`;
  if (W2.view === "meta") { const sel = document.getElementById("w2MBank"); if (sel) { sel.innerHTML = `<option value="">Loading banks…</option>`; Promise.resolve(bvLoadBanks(sel)).then(() => { if (W2.meta.bank) sel.value = W2.meta.bank; }); sel.onchange = () => { W2.meta.bank = sel.value; }; } }
  if (W2.view === "requests" && W2.legacy === undefined) w2LoadLegacy();
  if (W2.view === "add" && W2.addMode === "bank" && W2.dva === undefined && !W2.dvaBusy) { W2.dvaBusy = true; w2LoadDva().finally(() => { W2.dvaBusy = false; }); }
  if (W2.view === "old") { const box = document.getElementById("w2Old"); if (box) { const back = document.createElement("div"); back.className = "w2-nav"; back.innerHTML = `<button type="button" class="w2-ibtn" onclick="w2Go('home')" aria-label="Back">${rvIc("back")}</button><h2>More tools</h2>`; box.appendChild(back); const inner = document.createElement("div"); box.appendChild(inner); renderWalletLegacy(inner); } }
}

function w2ApproveLegacy(id) {
  const f = (W2.legacy || []).find((x) => x.id === id); if (!f) return;
  bvShowSendPinModal(id, `<b>${fN(f.amount_naira)}</b> to <b>${escH(f.req_account_name || "Meta")}</b> · ${escH(f.req_bank_name || "")} ${escH(f.req_account_number || "")}`);
}
