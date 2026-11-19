// Revora dashboard, part 18 of 23: TAB: APPROVALS · TAB: EARNINGS · SHARED: media-buyer ROAS aggregation (used by Ad Spend & ROAS + Leaderboard) · TAB: LEADERBOARD · TAB: WALLET

// ── TAB: APPROVALS ────────────────────────────────────────────────────────────
async function renderApprovals(el) {
  const rows = await sbQuery("pending_approvals", "order=requested_at.desc&limit=100");

  const pend = (rows||[]).filter(a => a.status === "pending").length;
  const appr = (rows||[]).filter(a => a.status === "approved").length;
  const rej  = (rows||[]).filter(a => a.status === "rejected").length;
  const isAdmin = window.myProfile?.role === "owner" || window.myProfile?.role === "admin";

  el.innerHTML = `
    <div class="sh"><div class="sh-title">Approvals</div></div>

    <div class="g4">
      <div class="kc"><div class="kc-lbl">Pending</div><div class="kc-val ${pend?"w":""}">${pend}</div><div class="kc-sub">${pend ? (isAdmin ? "⚠ act below, or on WhatsApp" : "⚠ waiting on an owner/admin") : "all clear ✓"}</div></div>
      <div class="kc"><div class="kc-lbl">Approved</div><div class="kc-val a">${appr}</div></div>
      <div class="kc"><div class="kc-lbl">Rejected</div><div class="kc-val d">${rej}</div></div>
      <div class="kc"><div class="kc-lbl">Total logged</div><div class="kc-val">${rows?.length ?? 0}</div></div>
    </div>

    ${pend > 0 ? `<div class="msg info" style="margin-bottom:14px;">⚠ ${pend} pending approval${pend>1?"s":""} below${isAdmin ? ` — click Approve/Reject, or reply <b>APPROVE &lt;id&gt;</b>/<b>REJECT &lt;id&gt;</b> on WhatsApp if you'd rather` : `, waiting on an owner/admin to act`}.</div>` : ""}
    <div id="approvalActionMsg"></div>

    <div class="panel">
      <div class="ph"><div class="ph-title">Approval log</div><div class="ph-count">${rows?.length ?? 0} total</div></div>
      ${!rows?.length ? `<div class="empty"><div class="empty-ico">✅</div>No approval requests yet.</div>` : `
      <div class="tbl-wrap"><table>
        <tr><th>Type</th><th>Reason / Summary</th><th>Status</th><th>Requested</th><th>ID</th>${isAdmin ? "<th></th>" : ""}</tr>
        ${rows.map(a => `<tr>
          <td class="s n">${(a.approval_type ?? "—").replace(/_/g," ")}</td>
          <td class="n" style="max-width:260px;color:var(--text2);">${a.reason ?? a.summary ?? "—"}</td>
          <td><span class="pill ${a.status === "approved" ? "approved" : a.status === "rejected" ? "rejected" : "pending"}">${a.status ?? "pending"}</span></td>
          <td>${ago(a.requested_at)}</td>
          <td style="font-size:10px;color:var(--muted);">${(a.id ?? "").slice(0,8)}</td>
          ${isAdmin ? `<td style="display:flex;gap:6px;">
            ${a.status === "pending" ? `
              <button type="button" class="btn btn-a" id="appr-approve-${a.id}" style="padding:4px 10px;font-size:10px;" onclick="bvProcessApproval('${a.id}','approve')">Approve</button>
              <button type="button" class="btn btn-g" id="appr-reject-${a.id}" style="padding:4px 10px;font-size:10px;color:var(--danger);" onclick="bvProcessApproval('${a.id}','reject')">Reject</button>
            ` : ""}
          </td>` : ""}
        </tr>`).join("")}
      </table></div>`}
    </div>`;
}

// Mirrors exactly what replying APPROVE/REJECT <id> on WhatsApp does (same
// process-approval function, same Meta calls) -- for an owner/admin with no
// WhatsApp number configured, or who'd simply rather click a button.
async function bvProcessApproval(approvalId, action) {
  const approveBtn = document.getElementById(`appr-approve-${approvalId}`);
  const rejectBtn = document.getElementById(`appr-reject-${approvalId}`);
  const msg = document.getElementById("approvalActionMsg");
  [approveBtn, rejectBtn].forEach(b => { if (b) b.disabled = true; });
  const actingBtn = action === "approve" ? approveBtn : rejectBtn;
  if (actingBtn) actingBtn.textContent = action === "approve" ? "Approving…" : "Rejecting…";
  try {
    const r = await sbFn("process-approval", { approval_id: approvalId, action });
    if (r.error) throw new Error(r.error);
    bvToast(action === "approve" ? "Approved — live on Meta now." : "Rejected.");
    render();
  } catch (err) {
    msg.innerHTML = `<div class="msg err">❌ ${escH(err.message)}</div>`;
    [approveBtn, rejectBtn].forEach(b => { if (b) b.disabled = false; });
    if (approveBtn) approveBtn.textContent = "Approve";
    if (rejectBtn) rejectBtn.textContent = "Reject";
  }
}

// ── TAB: EARNINGS ─────────────────────────────────────────────────────────────
async function renderEarnings(el) {
  const [earnings, monthly] = await Promise.all([
    sbQuery("personal_earnings", "order=earning_date.desc&limit=60"),
    sbQuery("monthly_summary", "order=month.desc&limit=3").catch(() => []),
  ]);
  const total = (earnings||[]).reduce((s,e) => s + Number(e.amount_naira||0), 0);
  const cur   = monthly?.[0];

  el.innerHTML = `
    <div class="sh"><div class="sh-title">Earnings</div></div>

    <div class="g4">
      <div class="kc"><div class="kc-lbl">Total logged</div><div class="kc-val a">${fN(total)}</div><div class="kc-sub">all entries</div></div>
      <div class="kc"><div class="kc-lbl">Base salary</div><div class="kc-val">${fN(cur?.base_salary_naira ?? 150000)}</div><div class="kc-sub">monthly</div></div>
      <div class="kc"><div class="kc-lbl">Delivery rate</div><div class="kc-val">${fP(cur?.delivery_rate_pct)}</div><div class="kc-sub">this month</div></div>
      <div class="kc"><div class="kc-lbl">Projected total</div><div class="kc-val w">${fN(cur?.total_earnings_naira)}</div><div class="kc-sub">salary + commission</div></div>
    </div>

    ${monthly?.length ? `
    <div class="panel">
      <div class="ph"><div class="ph-title">Monthly breakdown</div></div>
      <div class="tbl-wrap"><table>
        <tr><th>Month</th><th>Base salary</th><th>Delivery rate</th><th>Commission</th><th>Total</th></tr>
        ${monthly.map(m => `<tr>
          <td class="s">${m.month ?? "—"}</td>
          <td>${fN(m.base_salary_naira)}</td>
          <td class="${parseFloat(m.delivery_rate_pct||0) >= 70 ? "ctr-hot" : "ctr-warm"}">${fP(m.delivery_rate_pct)}</td>
          <td>${fN(m.commission_naira)}</td>
          <td class="s">${fN(m.total_earnings_naira)}</td>
        </tr>`).join("")}
      </table></div>
    </div>` : ""}

    <div class="panel">
      <div class="ph"><div class="ph-title">Earnings log</div><div class="ph-count">${earnings?.length ?? 0} entries</div></div>
      ${!earnings?.length ? `<div class="empty"><div class="empty-ico">💰</div>No earnings logged yet. Salary payments and commissions appear here automatically.</div>` : `
      <div class="tbl-wrap"><table>
        <tr><th>Date</th><th>Source</th><th>Amount</th><th>Notes</th></tr>
        ${earnings.map(e => `<tr>
          <td>${e.earning_date ?? "—"}</td>
          <td class="n">${(e.source||"").replace(/_/g," ")}</td>
          <td class="s">${fN(e.amount_naira)}</td>
          <td class="n" style="color:var(--muted);max-width:200px;">${e.notes ?? ""}</td>
        </tr>`).join("")}
      </table></div>`}
    </div>`;
}

// ── SHARED: media-buyer ROAS aggregation (used by Ad Spend & ROAS + Leaderboard) ─
const escH = v => String(v ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));

// Short-lived confirmation popup (bottom of screen) -- for actions like
// "Save" that otherwise re-render a whole panel with no obvious signal
// that anything actually happened.
// Full-screen viewer for any image or video marked with data-view="<url>" data-type="image|video". Tap outside, press Esc or tap the X to close.
function bvViewMedia(url, type) {
  document.getElementById("bvMediaView")?.remove();
  const o = document.createElement("div"); o.id = "bvMediaView";
  o.innerHTML = `<button type="button" class="x" aria-label="Close">✕</button>${type === "video" ? `<video src="${escH(url)}" controls autoplay playsinline></video>` : `<img src="${escH(url)}" alt="">`}`;
  const close = () => { o.querySelector("video")?.pause(); o.remove(); document.removeEventListener("keydown", esc); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  o.addEventListener("click", (e) => { if (e.target === o || e.target.classList.contains("x")) close(); });
  document.addEventListener("keydown", esc);
  document.body.appendChild(o);
}
document.addEventListener("click", (e) => {
  const t = e.target.closest?.("[data-view]");
  if (t && t.dataset.view) { e.preventDefault(); bvViewMedia(t.dataset.view, t.dataset.type); }
});

function bvToast(message, type = "ok") {
  const wrap = document.getElementById("bvToastWrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = `bv-toast ${type}`;
  el.innerHTML = `${type === "ok" ? "✅" : type === "err" ? "❌" : ""} ${escH(message)}`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add("closing");
    setTimeout(() => el.remove(), 200);
  }, 2600);
}
const roasFmt  = (rev, sp) => sp > 0 ? (rev / sp).toFixed(2) + "x" : "—";
const roasCls  = (rev, sp) => sp <= 0 ? "" : rev / sp >= 2 ? "ctr-hot" : rev / sp >= 1 ? "ctr-warm" : "ctr-cold";

// fromDateStr/toDateStr = null means no bound on that side (all-time when both omitted).
async function fetchBuyerRoas(fromDateStr, toDateStr, companyWide = false) {
  const [buyers, rows] = await Promise.all([
    sbQuery("media_buyers", "select=*&order=code.asc").catch(() => []),
    // security-definer RPC, not a direct table/view read -- buyer-role RLS
    // restricts the underlying orders/payments/daily_metrics tables to each
    // buyer's own rows, so the RPC itself still filters by media_buyer_id
    // per caller UNLESS company_wide is passed -- that's what the
    // Leaderboard tab uses to show every buyer ranked against each other;
    // the Ad Spend & ROAS tab leaves it false so a buyer still only sees
    // their own numbers there.
    sbRpc("media_buyer_daily_roas_agg_v2", { from_date: fromDateStr || null, to_date: toDateStr || null, company_wide: companyWide }).catch(() => []),
  ]);
  const extraRows = await sbRpc("media_buyer_roas_extra", { from_date: fromDateStr || null, to_date: toDateStr || null, company_wide: companyWide }).catch(() => []);
  const extra = new Map((extraRows || []).map(r => [r.media_buyer_id ?? "none", r]));
  const agg = new Map();
  for (const r of rows || []) {
    const k = r.media_buyer_id ?? "none";
    const a = agg.get(k) ?? { spend: 0, orders: 0, revenue: 0, delivered: 0, confirmed: 0 };
    a.spend += Number(r.spend_naira || 0); a.orders += Number(r.orders || 0);
    a.revenue += Number(r.revenue_naira || 0); a.delivered += Number(r.delivered_revenue_naira || 0);
    a.confirmed += Number(r.confirmed_revenue_naira || 0);
    agg.set(k, a);
  }
  const byId = new Map((buyers || []).map(b => [b.id, b]));
  const ex = k => { const e = extra.get(k) || {}; return { awaiting: Number(e.cod_awaiting_naira || 0), awaitingOrders: Number(e.cod_awaiting_orders || 0), fees: Number(e.delivery_fees_naira || 0) + Number(e.cod_fees_naira || 0), unassigned: Number(e.unattributed_orders || 0) }; };
  const list = [...agg.entries()].map(([id, a]) => ({ id, buyer: byId.get(id), ...a, ...ex(id) }));
  for (const b of buyers || []) if (!agg.has(b.id)) list.push({ id: b.id, buyer: b, spend: 0, orders: 0, revenue: 0, delivered: 0, confirmed: 0, ...ex(b.id) });
  const tot = list.reduce((t, r) => ({ spend: t.spend + r.spend, revenue: t.revenue + r.revenue, delivered: t.delivered + r.delivered, confirmed: t.confirmed + r.confirmed, orders: t.orders + r.orders, awaiting: t.awaiting + (r.awaiting || 0), awaitingOrders: t.awaitingOrders + (r.awaitingOrders || 0), fees: t.fees + (r.fees || 0), unassigned: t.unassigned + (r.unassigned || 0) }), { spend: 0, revenue: 0, delivered: 0, confirmed: 0, orders: 0, awaiting: 0, awaitingOrders: 0, fees: 0, unassigned: 0 });
  return { list, tot };
}

// ── TAB: LEADERBOARD ──────────────────────────────────────────────────────────
let leaderboardRangeDays = 7;

async function renderLeaderboard(el) {
  const since = leaderboardRangeDays ? new Date(Date.now() - (leaderboardRangeDays - 1) * 86400000).toISOString().slice(0, 10) : null;
  const [roasRaw, live] = await Promise.all([
    fetchBuyerRoas(since, null, true),
    // Spend is read live from Meta (same source as Overview and Ad Spend & ROAS), not from the
    // old saved copy, which had stopped updating. Meta history here is capped at 92 days.
    fetchLiveDaily(since || watDate(-91), watDate(0)),
  ]);
  const { list } = bvMergeLiveSpend(roasRaw, live.rows);
  // A buyer's login can only read their own ad accounts, so other buyers' spend is unknown to them.
  const adminView = bvIsAdminRole(), myBuyerId = window.myProfile?.media_buyer_id;
  const spendKnown = r => adminView || r.buyer?.id === myBuyerId;
  const sp = r => spendKnown(r) ? fN(r.spend) : "—";
  const rs = (num, r) => spendKnown(r) ? roasFmt(num, r.spend) : "—";

  // Rank named buyers only (an "Unattributed" bucket can't be ranked) --
  // by revenue by default, since that's what the business actually cares about.
  const ranked = list.filter(r => r.buyer).sort((a, b) => b.revenue - a.revenue);
  const unattributed = list.find(r => !r.buyer);

  el.innerHTML = `
    <div class="sh"><div class="sh-title">Leaderboard</div><div class="sh-actions">
      <select id="lbRange" style="width:auto;padding:5px 9px;font-size:12px;">
        <option value="1"  ${leaderboardRangeDays===1 ?"selected":""}>Today</option>
        <option value="7"  ${leaderboardRangeDays===7 ?"selected":""}>Last 7 days</option>
        <option value="30" ${leaderboardRangeDays===30?"selected":""}>Last 30 days</option>
        <option value="0"  ${leaderboardRangeDays===0 ?"selected":""}>All time</option>
      </select>
      <button class="btn btn-g" onclick="render()">↺ Refresh</button></div></div>

    <div class="panel">
      <div class="ph"><div class="ph-title">Media buyer rankings</div><div class="ph-count">Ranked by order revenue · spend live from Meta${leaderboardRangeDays === 0 ? " (last 92 days)" : ""}</div></div>
      ${live.ok ? "" : `<div class="msg err" style="display:block;margin-bottom:10px;">Couldn't read live spend from Meta (${escH(live.error || "")}) — spend and ROAS may be wrong until you refresh.</div>`}
      ${!ranked.length ? `<div class="empty"><div class="empty-ico">🏆</div>No media buyers yet -- add one from Settings.</div>` : `
      <div class="tbl-wrap"><table>
        <tr><th>Rank</th><th>Buyer</th><th>Spend</th><th>Orders</th><th>Revenue</th><th>ROAS</th><th>Delivered ROAS</th><th>Real ROAS</th></tr>
        ${ranked.map((r, i) => `<tr ${i < 3 ? 'style="background:var(--accentBg);"' : ""}>
          <td style="font-size:14px;font-weight:700;">#${i + 1}</td>
          <td class="s"><a href="javascript:void(0)" class="lbBuyerLink" data-id="${r.buyer.id}" style="color:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer;">${escH(r.buyer.name)}</a></td>
          <td>${sp(r)}</td>
          <td>${r.orders}</td>
          <td class="s">${fN(r.revenue)}</td>
          <td class="${spendKnown(r) ? roasCls(r.revenue, r.spend) : ""}">${rs(r.revenue, r)}</td>
          <td class="${spendKnown(r) ? roasCls(r.delivered, r.spend) : ""}">${rs(r.delivered, r)}</td>
          <td class="${spendKnown(r) ? roasCls(r.confirmed, r.spend) : ""}" title="Based on confirmed Paystack payments only -- the only figure that's actual cash in hand.">${rs(r.confirmed, r)}</td>
        </tr>`).join("")}
      </table></div>`}
    </div>

    ${unattributed && unattributed.orders > 0 ? `
    <div class="panel">
      <div class="ph"><div class="ph-title">Unattributed</div></div>
      <div style="padding:10px 14px;font-size:12.5px;color:var(--muted);">${unattributed.orders} order(s) worth ${fN(unattributed.revenue)} in this range aren't tagged to any buyer -- their order-form link wasn't generated from the Order Forms tab (so it carries no buyer id), or their ad set name is missing the older <code>[CODE]</code> fallback.</div>
    </div>` : ""}`;

  document.getElementById("lbRange").addEventListener("change", e => { leaderboardRangeDays = Number(e.target.value); render(); });
  document.querySelectorAll(".lbBuyerLink").forEach(a => a.addEventListener("click", () => {
    const row = ranked.find(r => r.buyer.id === a.dataset.id);
    if (row) bvShowBuyerProfile(row);
  }));
}

// Click a buyer's name on the Leaderboard to see everything tied to them in
// one place -- the "click a rep, see their full record" pattern every real
// CRM has (Salesforce rep view, HubSpot owner view, etc.), instead of an
// admin having to cross-reference Orders/Campaigns/ROAS tabs by hand.
async function bvShowBuyerProfile(row) {
  const overlay = document.createElement("div");
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `<div class="bv-modal" style="max-width:640px;">
    <button class="bv-modal-close" onclick="this.closest('.bv-overlay').remove()">✕</button>
    <h3 style="margin:0 0 4px;">${escH(row.buyer.name)}</h3>
    <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${escH(row.buyer.code)} · media buyer</div>
    <div class="g4" style="margin-bottom:14px;">
      <div class="kc"><div class="kc-lbl">Spend</div><div class="kc-val">${fN(row.spend)}</div></div>
      <div class="kc"><div class="kc-lbl">Orders</div><div class="kc-val">${row.orders}</div></div>
      <div class="kc"><div class="kc-lbl">Revenue</div><div class="kc-val">${fN(row.revenue)}</div></div>
      <div class="kc"><div class="kc-lbl">ROAS</div><div class="kc-val ${roasCls(row.revenue, row.spend)}">${roasFmt(row.revenue, row.spend)}</div></div>
    </div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:6px;">Recent orders</div>
    <div id="bvProfileOrders" style="max-height:320px;overflow-y:auto;"><div class="empty" style="padding:20px;"><div class="empty-ico">⏳</div>Loading…</div></div>
  </div>`;
  document.body.appendChild(overlay);

  const orders = await sbQuery("orders", `select=customer_name,product_name,order_value_naira,order_status,ordered_at&media_buyer_id=eq.${row.buyer.id}&order=ordered_at.desc&limit=20`).catch(() => []);
  const ordersEl = document.getElementById("bvProfileOrders");
  if (!ordersEl) return; // modal closed before this resolved
  ordersEl.innerHTML = !orders?.length ? `<div class="empty" style="padding:20px;"><div class="empty-ico">📦</div>No orders yet.</div>` : `
    <table style="width:100%;">
      <tr><th>Customer</th><th>Product</th><th>Value</th><th>Status</th><th>Date</th></tr>
      ${orders.map(o => `<tr>
        <td class="s n">${escH(o.customer_name ?? "—")}</td>
        <td class="n">${escH(o.product_name ?? "—")}</td>
        <td>${fN(o.order_value_naira)}</td>
        <td><span class="pill ${o.order_status}">${escH(o.order_status)}</span></td>
        <td class="n">${ago(o.ordered_at)}</td>
      </tr>`).join("")}
    </table>`;
}

// ── TAB: WALLET ───────────────────────────────────────────────────────────────

// Shared by the Wallet tab and the Overview balance chip, so both always
// agree on the number instead of two separate computations drifting apart.
// A fund_requests row's lifecycle is pending -> approved -> transferred (or
// declined). "approved" means an admin signed off on the amount but the
// Two separate wallets, deliberately not merged into one number:
//   REVENUE WALLET -- confirmed customer payments. Informational/ROAS
//   attribution only. Real money, but not what funding requests draw
//   against -- it's sales revenue, not an ad-spend pool the admin has
//   consciously committed.
//   FUNDING WALLET -- only what the admin has personally deposited via
//   their own DVA (admin_topup), minus what's approved/sent/withdrawn.
//   THIS is the pool a funding request is approved against -- approving
//   a request the funding wallet can't cover is the bug that produced a
//   negative balance before; now it's gated in the UI against this
//   number specifically.
// A buyer's DVA only ever collects customer payments -- never their own
// spendable wallet. walletBalances below is per-buyer REVENUE wallet
// attribution (plus their own approved/transferred activity), never a
// balance a buyer can spend directly.
const walletBlank = () => ({ confirmed: 0, approved: 0, transferred: 0 });
// Revora-managed ad accounts are paid for by Revora's card, so nothing goes live on one while the wallet is empty.
async function bvWalletGate() {
  const a = (accountsList || []).find(x => x.id === activeAccountId);
  if (!a || a.billing_mode !== "managed") return;
  const r = await supabaseClient.rpc("my_account_wallet_balance", { p_account: a.id });
  if (!r.error && Number(r.data || 0) <= 0) throw new Error("The wallet for this ad account is empty, so this can't go live yet. Top up your wallet in the Wallet tab, then publish again.");
}

async function fetchWalletBalances() {
  const [buyers, confirmedPayments, fundRequests, withdrawals, managedSpendRes] = await Promise.all([
    sbQuery("media_buyers", "select=*&order=code.asc").catch(() => []),
    // RLS scopes this to "my own buyer row" for a buyer, or the whole
    // company for an admin -- one query serves both.
    sbQuery("payments", "select=media_buyer_id,amount_naira,source&status=eq.confirmed").catch(() => []),
    sbQuery("fund_requests", "select=*&order=requested_at.desc&limit=100").catch(() => []),
    sbQuery("admin_withdrawals", "select=amount_naira,status&order=created_at.desc&limit=200").catch(() => []),
    // What this company's Revora-managed ad accounts have spent (shown with Revora's markup): paid out of the same funding wallet.
    supabaseClient.rpc("my_managed_billed_spend").then(r => Number(r.data || 0)).catch(() => 0),
  ]);
  const managedSpend = Number(managedSpendRes || 0);
  const walletBalances = {};
  for (const b of buyers || []) walletBalances[b.id] = walletBlank();
  let companyTopups = 0;
  for (const p of confirmedPayments || []) {
    if (p.media_buyer_id) {
      walletBalances[p.media_buyer_id] = walletBalances[p.media_buyer_id] || walletBlank();
      walletBalances[p.media_buyer_id].confirmed += Number(p.amount_naira || 0);
    } else if (p.source === "admin_topup") {
      companyTopups += Number(p.amount_naira || 0);
    }
  }
  let approvedTotal = 0, transferredTotal = 0;
  for (const f of fundRequests || []) {
    if (f.status !== "approved" && f.status !== "transferred") continue;
    walletBalances[f.media_buyer_id] = walletBalances[f.media_buyer_id] || walletBlank();
    walletBalances[f.media_buyer_id][f.status] += Number(f.amount_naira || 0);
    if (f.status === "approved") approvedTotal += Number(f.amount_naira || 0);
    else transferredTotal += Number(f.amount_naira || 0);
  }
  const withdrawnTotal = (withdrawals || []).filter(w => w.status === "sent").reduce((s, w) => s + Number(w.amount_naira || 0), 0);
  const totalRevenue = Object.values(walletBalances).reduce((s, w) => s + w.confirmed, 0);
  const fundingWalletBalance = companyTopups - approvedTotal - transferredTotal - withdrawnTotal - managedSpend;
  return { managedSpend, buyers: buyers || [], fundRequests: fundRequests || [], withdrawals: withdrawals || [], walletBalances, companyTopups, approvedTotal, transferredTotal, withdrawnTotal, totalRevenue, fundingWalletBalance };
}

// Admin-only. One focused modal per action -- "Add funds", "Withdraw" --
// each opened by its own button on the Funding wallet card. Fund requests
// are deliberately NOT in a modal: they're an always-visible panel on the
// page itself, so approving one is a single tap, not open-modal-then-tap.
async function bvShowAddFundsModal() {
  bvCloseModal();
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay";
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
  overlay.innerHTML = `<div class="bv-modal"><div style="text-align:center;padding:30px;color:var(--muted);font-size:12px;">Loading…</div></div>`;
  document.body.appendChild(overlay);
  await bvRenderAddFundsModal();
}

async function bvRenderAddFundsModal() {
  const modal = document.querySelector("#bvModalOverlay .bv-modal");
  if (!modal) return;
  const companyRows = await sbQuery("companies", "select=id,name,dedicated_account_number,dedicated_account_bank&limit=1").catch(() => []);
  const company = companyRows?.[0];

  modal.innerHTML = `
    <button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
    <div class="ph-title" style="margin-bottom:10px;">Add funds</div>
    ${company?.dedicated_account_number ? `
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:6px;">Transfer from your own bank (Opay, Access, etc.) into this account -- it lands in your funding wallet automatically.</div>
    <div style="font-size:20px;font-weight:700;font-family:'JetBrains Mono',monospace;">${escH(company.dedicated_account_number)}</div>
    <div style="font-size:12px;color:var(--muted);">${escH(company.dedicated_account_bank || "")}</div>
    ` : `
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;">Set up a deposit account once, then transfer into it any time.</div>
    <button type="button" class="btn btn-a" id="modalCreateCompanyAcctBtn" style="padding:4px 10px;font-size:10px;">Create deposit account</button>
    <div id="modalCompanyAcctResult" style="margin-top:8px;"></div>
    `}
  `;

  document.getElementById("modalCreateCompanyAcctBtn")?.addEventListener("click", async (e) => {
    const btn = e.target;
    const result = document.getElementById("modalCompanyAcctResult");
    btn.disabled = true; btn.textContent = "Creating…";
    try {
      const r = await sbFn("paystack-create-company-account", { access_token: sessionData.access_token });
      if (r.error) throw new Error(r.error);
      await bvRenderAddFundsModal();
    } catch (err) {
      result.innerHTML = `<div class="msg err">❌ ${escH(err.message)}</div>`;
      btn.disabled = false; btn.textContent = "Create deposit account";
    }
  });
}

// One customer's full picture across every channel that collects a phone
// number -- every order's own confirmed-payment history, plus any website
// lead -- resolved via orders.customer_id / website_leads.customer_id,
// which a DB trigger now sets automatically off the normalized phone number
// no matter which form or channel the person came in through.
const BV_EVENT_FIELD_LABELS = {
  order_status: "Status",
  delivery_agent_id: "Delivery agent",
  assignment_status: "Rider assignment",
  media_buyer_id: "Media buyer",
};

// "Who changed this to cancelled, and from what" previously had no answer --
// every status/reassignment change just overwrote the row. order_events is
// an append-only log a trigger writes automatically on orders; this is just
// reading it back. changed_by is null for an automated change (the rider
// auto-assignment sweep, the AI call webhook) rather than a person.
async function bvShowOrderHistoryModal(orderId) {
  if (!orderId) return;
  bvCloseModal();
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay";
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
  overlay.innerHTML = `<div class="bv-modal"><button class="bv-modal-close" onclick="bvCloseModal()">✕</button><div class="ph-title">Loading…</div></div>`;
  document.body.appendChild(overlay);

  const events = await sbQuery("order_events",
    `select=field_name,old_value,new_value,changed_by,created_at,profiles(display_name)&order_id=eq.${orderId}&order=created_at.desc`
  ).catch(() => []);

  const modal = document.querySelector("#bvModalOverlay .bv-modal");
  if (!modal) return;
  modal.innerHTML = `
    <button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
    <div class="ph-title" style="margin-bottom:4px;">Change history</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">Every status change and reassignment recorded on this order.</div>
    ${!events?.length ? `<div style="font-size:12px;color:var(--muted);">No changes recorded yet.</div>` : `
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${events.map(ev => `
        <div style="border-left:2px solid var(--border);padding-left:10px;">
          <div style="font-size:12.5px;"><b>${escH(BV_EVENT_FIELD_LABELS[ev.field_name] ?? ev.field_name)}</b>: ${escH(ev.old_value ?? "—")} → ${escH(ev.new_value ?? "—")}</div>
          <div style="font-size:11px;color:var(--muted);">${ev.profiles?.display_name ? escH(ev.profiles.display_name) : "Automated"} · ${ago(ev.created_at)}</div>
        </div>`).join("")}
    </div>`}
  `;
}

async function bvShowCustomerModal(customerId) {
  if (!customerId) return;
  bvCloseModal();
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay";
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
  overlay.innerHTML = `<div class="bv-modal"><button class="bv-modal-close" onclick="bvCloseModal()">✕</button><div class="ph-title">Loading…</div></div>`;
  document.body.appendChild(overlay);

  const [custArr, orders, leadRows] = await Promise.all([
    sbQuery("conversation_customers", `select=*&id=eq.${customerId}`),
    sbQuery("orders", `select=id,product_name,order_value_naira,order_status,ordered_at,payments(status,amount_naira,paid_at)&customer_id=eq.${customerId}&order=ordered_at.desc`),
    sbQuery("website_leads", `select=id,product_name,created_at&customer_id=eq.${customerId}&order=created_at.desc`),
  ]);
  const cust = custArr?.[0];
  for (const o of orders || []) o.payment = (o.payments || [])[0] || null;
  const delivered = (orders || []).filter(o => o.order_status === "delivered");
  const deliveredValue = delivered.reduce((s, o) => s + Number(o.order_value_naira || 0), 0);
  const confirmedRevenue = (orders || [])
    .filter(o => o.payment?.status === "confirmed")
    .reduce((s, o) => s + Number(o.payment.amount_naira || 0), 0);

  const modal = document.querySelector("#bvModalOverlay .bv-modal");
  if (!modal) return;
  modal.innerHTML = `
    <button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
    <div class="ph-title" style="margin-bottom:4px;">${escH(cust?.name || "Unknown customer")}</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">${escH(cust?.phone || "—")}${cust?.city ? ` · ${escH(cust.city)}` : ""}${cust?.state ? `, ${escH(cust.state)}` : ""}</div>
    <div class="g4" style="margin-bottom:14px;">
      <div class="kc"><div class="kc-lbl">Orders</div><div class="kc-val">${orders?.length || 0}</div></div>
      <div class="kc"><div class="kc-lbl">Delivered</div><div class="kc-val a">${delivered.length}</div></div>
      <div class="kc"><div class="kc-lbl">Delivered value</div><div class="kc-val a">${fN(deliveredValue)}</div></div>
      <div class="kc"><div class="kc-lbl">Confirmed paid</div><div class="kc-val a">${fN(confirmedRevenue)}</div></div>
    </div>
    <div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:6px;">Order history</div>
    ${!orders?.length ? `<div style="font-size:12px;color:var(--muted);margin-bottom:12px;">No orders yet.</div>` : `
    <div class="tbl-wrap" style="margin-bottom:12px;"><table>
      <tr><th>Product</th><th>Value</th><th>Payment</th><th>Status</th><th>When</th></tr>
      ${orders.map(o => `<tr>
        <td class="s n">${escH(o.product_name ?? "—")}</td>
        <td>${fN(o.order_value_naira)}</td>
        <td>${bvPaymentCell(o)}</td>
        <td><span class="pill ${o.order_status}">${escH(o.order_status)}</span></td>
        <td>${ago(o.ordered_at)}</td>
      </tr>`).join("")}
    </table></div>`}
    ${leadRows?.length ? `
    <div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:6px;">Also came in as a website lead</div>
    <div style="font-size:12px;color:var(--muted);">${leadRows.map(l => `${escH(l.product_name ?? "an interest form")} · ${ago(l.created_at)}`).join("<br>")}</div>` : ""}
  `;
}

// Owner/admin: send money from the funding wallet to ANY Nigerian bank account. The bank's name for the account is shown first and the
// transfer PIN is needed to send. (Media buyers can only ask for Meta funding; they never send.)
async function bvShowAdminWithdrawModal() {
  bvCloseModal();
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay";
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
  overlay.innerHTML = `
    <div class="bv-modal">
      <button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
      <div class="ph-title" style="margin-bottom:6px;">Send money</div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;">Pay any Nigerian bank account from the funding wallet: your own account, a supplier, a rider. Revora shows who owns the account before you confirm with your transfer PIN.</div>
      <form id="sendMoneyForm" novalidate>
        <div class="fg">
          <div class="field"><label>Bank *</label><select id="smBank"><option value="">Loading banks…</option></select></div>
          <div class="field"><label>Account number *</label><input type="text" id="smAcct" inputmode="numeric" maxlength="10" placeholder="10-digit account number"></div>
          <div class="field"><label>Amount (₦) *</label><input type="number" min="100" step="1" id="smAmt" placeholder="e.g. 50000"></div>
        </div>
        <div id="smName" style="margin-top:8px;"></div>
        <div class="field" id="smPinWrap" style="display:none;margin-top:8px;"><label>Your transfer PIN *</label><input id="smPin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="4 to 6 digits"></div>
        <button type="submit" class="btn btn-a btn-full" style="margin-top:10px;" id="smBtn">Check account</button>
        <div id="smMsg" style="margin-top:8px;"></div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  bvLoadBanks(document.getElementById("smBank"));
  let checked = ""; // "bank|account" that has been looked up
  const form = document.getElementById("sendMoneyForm");
  const reset = () => { checked = ""; document.getElementById("smName").innerHTML = ""; document.getElementById("smPinWrap").style.display = "none"; document.getElementById("smBtn").textContent = "Check account"; };
  document.getElementById("smBank").addEventListener("change", reset);
  document.getElementById("smAcct").addEventListener("input", reset);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = document.getElementById("smBtn"), msg = document.getElementById("smMsg");
    const bank_code = document.getElementById("smBank").value, account_number = document.getElementById("smAcct").value.replace(/\s+/g, "");
    const amount_naira = Number(document.getElementById("smAmt").value);
    if (!bank_code || !/^\d{10}$/.test(account_number)) { msg.innerHTML = `<div class="msg err">❌ Pick the bank and enter the 10-digit account number.</div>`; return; }
    if (!amount_naira || amount_naira < 100) { msg.innerHTML = `<div class="msg err">❌ Enter an amount of at least ₦100.</div>`; return; }
    if (btn.disabled) return;
    msg.innerHTML = ""; btn.disabled = true;
    try {
      if (checked !== bank_code + "|" + account_number) {
        btn.textContent = "Checking…";
        const r = await sbFn("fund-request-send", { action: "lookup", account_number, bank_code });
        if (r.error) throw new Error(r.error);
        checked = bank_code + "|" + account_number;
        document.getElementById("smName").innerHTML = `<div style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12.5px;">Pay <b>${fN(amount_naira)}</b> to <b>${escH(r.account_name)}</b><div style="color:var(--muted);font-size:10.5px;">Check the name is right before you continue.</div></div>`;
        document.getElementById("smPinWrap").style.display = "";
        document.getElementById("smPin").focus();
        btn.textContent = "Confirm and send";
      } else {
        const pin = document.getElementById("smPin").value.trim();
        if (!/^\d{4,6}$/.test(pin)) throw new Error("Enter your 4 to 6 digit transfer PIN. Set one in Settings → Security if you have not.");
        btn.textContent = "Sending…";
        const r = await sbFn("fund-request-send", { action: "withdraw", amount_naira, account_number, bank_code, pin });
        if (r.error) throw new Error(r.error);
        bvToast(`Sent to ${r.account_name}`);
        bvCloseModal();
        if (r.receipt?.id) window.open("receipt.html?r=" + r.receipt.id, "_blank");
        renderWallet(document.getElementById("mainContent"));
        return;
      }
    } catch (err) {
      msg.innerHTML = `<div class="msg err">❌ ${escH(err.message)}</div>`;
      btn.textContent = checked ? "Confirm and send" : "Check account";
    }
    btn.disabled = false;
  });
}

// Buyer-only: "Request funds". A buyer never sends money. They give the amount plus the account number and bank that Meta shows
// under Ads Manager > Billing > Add funds; Revora asks the bank who owns it and only accepts Meta/Facebook. The admin then approves
// with their transfer PIN, which sends the money.
let bvBanksCache = null;
async function bvLoadBanks(sel) {
  try {
    if (!bvBanksCache) { const r = await sbFn("paystack-list-banks", null, "GET"); bvBanksCache = r.banks || []; }
    if (!bvBanksCache.length) throw new Error("none");
    sel.innerHTML = `<option value="">Select bank…</option>` + bvBanksCache.map(b => `<option value="${escH(b.code)}">${escH(b.name)}</option>`).join("");
  } catch { sel.innerHTML = `<option value="">Couldn't load banks</option>`; }
}
async function bvShowRequestFundsModal(editId) {
  bvCloseModal();
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay";
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
  overlay.innerHTML = `
    <div class="bv-modal">
      <button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
      <div class="ph-title" style="margin-bottom:6px;">${editId ? "Send a fresh Meta account number" : "Request funds"}</div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">In Facebook Ads Manager open <b>Billing → Add funds → Bank transfer</b>. Meta shows an account number and a bank: enter them here. ${window.myProfile?.role === "buyer" ? "Your admin approves with their PIN and the money goes straight to Meta." : "You will approve it with your own transfer PIN and the money goes straight to Meta."}</div>
      <form id="modalFundReqForm" novalidate>
        <div class="fg">
          ${editId ? "" : `<div class="field"><label>Amount to request *</label><input id="modal_fr_amount" type="number" min="100" step="1" inputmode="numeric" placeholder="e.g. 50000"></div>`}
          <div class="field"><label>Bank shown by Meta *</label><select id="modal_fr_bank"><option value="">Loading banks…</option></select></div>
          <div class="field"><label>Account number from Meta *</label><input id="modal_fr_acct" type="text" inputmode="numeric" maxlength="10" placeholder="10-digit account number"></div>
          ${editId ? "" : `<div class="field"><label>Note (optional)</label><input id="modal_fr_note" placeholder="what it's for"></div>`}
        </div>
        <button type="submit" class="btn btn-a btn-full" style="margin-top:12px;">${editId ? "Update request" : "Request funds"}</button>
        <div id="modalFundReqMsg"></div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  bvLoadBanks(document.getElementById("modal_fr_bank"));

  // novalidate + manual checks on purpose: the browser's native "required" bubble does not position itself reliably inside this modal.
  document.getElementById("modalFundReqForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    const msg = document.getElementById("modalFundReqMsg");
    const amount = editId ? 0 : Number(document.getElementById("modal_fr_amount").value);
    const bank_code = document.getElementById("modal_fr_bank").value;
    const account_number = document.getElementById("modal_fr_acct").value.replace(/\s+/g, "");
    const note = editId ? "" : document.getElementById("modal_fr_note").value.trim();
    if (!editId && (!amount || amount < 100)) { msg.innerHTML = `<div class="msg err">❌ Enter an amount of at least ₦100.</div>`; return; }
    if (!bank_code) { msg.innerHTML = `<div class="msg err">❌ Pick the bank Meta shows.</div>`; return; }
    if (!/^\d{10}$/.test(account_number)) { msg.innerHTML = `<div class="msg err">❌ The account number is 10 digits.</div>`; return; }
    if (btn.disabled) return;
    btn.disabled = true; btn.textContent = "Checking the account…";
    try {
      const r = await sbFn("fund-request-submit", editId ? { action: "change_account", fund_request_id: editId, account_number, bank_code } : { amount_naira: amount, account_number, bank_code, note });
      if (r.verified === false) { msg.innerHTML = `<div class="msg err">❌ ${escH(r.reason || "That account was not accepted.")}</div>`; btn.disabled = false; btn.textContent = editId ? "Update request" : "Request funds"; return; }
      if (r.error) throw new Error(r.error);
      const solo = window.myProfile?.role === "owner" || window.myProfile?.role === "admin";
      if (!editId && solo) {
        // A one-person workspace: you asked, so you approve with your PIN right away.
        const nm = bvBanksCache?.find(b => b.code === bank_code)?.name || "";
        bvShowSendPinModal(r.id, `<b>${fN(amount)}</b> to <b>${escH(r.account_name || "Meta")}</b> · ${escH(nm)} ${escH(account_number)}`);
        return;
      }
      if (r.auto_sent) {
        bvToast("Sent to Meta automatically");
        if (r.receipt?.id) window.open("receipt.html?r=" + r.receipt.id, "_blank");
      } else {
        bvToast(editId ? "Account updated" : `Request sent. Bank says: ${r.account_name}`);
        if (r.auto_note) alert(r.auto_note);
      }
      bvCloseModal();
      renderWallet(document.getElementById("mainContent"));
    } catch (err) {
      msg.innerHTML = `<div class="msg err">❌ ${escH(err.message)}</div>`;
      btn.disabled = false; btn.textContent = editId ? "Update request" : "Request funds";
    }
  });
}


// A media buyer sends money from their OWN held balance straight to Meta. No admin approval; only a verified Meta/Facebook account is accepted.
async function bvShowSendToMetaModal() {
  bvCloseModal();
  const bal = Math.max(0, Number((await sbFn("wallet-topup", { action: "overview" }).catch(() => null))?.my_wallet || 0));
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay"; overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
  overlay.innerHTML = `<div class="bv-modal"><button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
    <div class="ph-title" style="margin-bottom:6px;">Send to Meta</div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">Comes out of your wallet (${fN(bal)}). In Ads Manager open <b>Billing → Add funds → Bank transfer</b>, then enter the account number and bank Meta shows. Only a Meta account is accepted.</div>
    <form id="sendMetaForm" novalidate><div class="fg">
      <div class="field"><label>Amount *</label><input id="sm_amount" type="number" min="100" step="1" inputmode="numeric" placeholder="e.g. 10000"></div>
      <div class="field"><label>Bank shown by Meta *</label><select id="sm_bank"><option value="">Loading banks…</option></select></div>
      <div class="field"><label>Account number from Meta *</label><input id="sm_acct" type="text" inputmode="numeric" maxlength="10" placeholder="10-digit account number"></div>
    </div><button type="submit" class="btn btn-a btn-full" style="margin-top:12px;">Send to Meta</button><div id="sendMetaMsg"></div></form></div>`;
  document.body.appendChild(overlay);
  bvLoadBanks(document.getElementById("sm_bank"));
  document.getElementById("sendMetaForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]"), msg = document.getElementById("sendMetaMsg");
    const amount = Number(document.getElementById("sm_amount").value), bank_code = document.getElementById("sm_bank").value, account_number = document.getElementById("sm_acct").value.replace(/\s+/g, "");
    if (!amount || amount < 100) { msg.innerHTML = `<div class="msg err">❌ Enter an amount of at least ₦100.</div>`; return; }
    if (amount > bal) { msg.innerHTML = `<div class="msg err">❌ Your wallet has ${fN(bal)}. Add money first.</div>`; return; }
    if (!bank_code) { msg.innerHTML = `<div class="msg err">❌ Pick the bank Meta shows.</div>`; return; }
    if (!/^\d{10}$/.test(account_number)) { msg.innerHTML = `<div class="msg err">❌ The account number is 10 digits.</div>`; return; }
    if (btn.disabled) return;
    btn.disabled = true; btn.textContent = "Checking the account and sending…";
    try {
      const r = await sbFn("fund-request-submit", { from_balance: true, amount_naira: amount, account_number, bank_code, note: "Sent from wallet" });
      if (r.verified === false) { msg.innerHTML = `<div class="msg err">❌ Nothing was sent. ${escH(r.reason || "That account was not accepted.")}</div>`; btn.disabled = false; btn.textContent = "Send to Meta"; return; }
      if (r.error) throw new Error(r.error);
      bvCloseModal(); bvToast(`Sent ${fN(amount)} to ${r.account_name || "Meta"}`);
      if (r.receipt?.id) window.open("receipt.html?r=" + r.receipt.id, "_blank");
      renderWallet(document.getElementById("mainContent"));
    } catch (err) { msg.innerHTML = `<div class="msg err">❌ ${escH(err.message)}</div>`; btn.disabled = false; btn.textContent = "Send to Meta"; }
  });
}

// Log money received for ads (shows as "Fund received" in the 12pm / 4pm / 8pm reports).
async function bvLogFundsModal() {
  bvCloseModal();
  const p = window.myProfile || {}, isAdmin = p.role === "owner" || p.role === "admin";
  let buyers = [];
  if (isAdmin) buyers = await sbQuery("media_buyers", "select=id,name&order=name").catch(() => []) || [];
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay"; overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
  overlay.innerHTML = `<div class="bv-modal"><button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
    <div class="ph-title" style="margin-bottom:6px;">Log funds received</div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">Money you were given for ads. It appears as Fund received in your daily reports.</div>
    <form id="logFundsForm" novalidate><div class="fg">
      ${isAdmin ? `<div class="field"><label>Media buyer *</label><select id="lf_buyer">${buyers.map((b) => `<option value="${b.id}" ${b.id === p.media_buyer_id ? "selected" : ""}>${escH(b.name)}</option>`).join("")}</select></div>` : ""}
      <div class="field"><label>Amount *</label><input id="lf_amount" type="number" min="1" step="1" inputmode="numeric" placeholder="e.g. 50000"></div>
      <div class="field"><label>Date</label><input id="lf_date" type="date" value="${today}"></div>
      <div class="field"><label>Note (optional)</label><input id="lf_note" placeholder="e.g. from the boss, Opay transfer"></div>
    </div><button type="submit" class="btn btn-a btn-full" style="margin-top:12px;">Save</button><div id="logFundsMsg"></div></form></div>`;
  document.body.appendChild(overlay);
  document.getElementById("logFundsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]"), msg = document.getElementById("logFundsMsg");
    const amount = Number(document.getElementById("lf_amount").value), buyer = isAdmin ? document.getElementById("lf_buyer")?.value : p.media_buyer_id;
    if (!amount || amount <= 0) { msg.innerHTML = `<div class="msg err">❌ Enter the amount.</div>`; return; }
    if (!buyer) { msg.innerHTML = `<div class="msg err">❌ Pick the media buyer.</div>`; return; }
    btn.disabled = true;
    const { error } = await supabaseClient.from("fund_logs").insert({ company_id: p.company_id, media_buyer_id: buyer, amount_naira: amount, log_date: document.getElementById("lf_date").value || today, note: document.getElementById("lf_note").value.trim() || null, logged_by: sessionData.user.id });
    if (error) { msg.innerHTML = `<div class="msg err">❌ ${escH(error.message)}</div>`; btn.disabled = false; return; }
    bvCloseModal(); bvToast("Logged " + fN(amount)); renderWallet(document.getElementById("mainContent"));
  });
}

// Owner/admin: approve one funding request with the transfer PIN. The PIN check, a fresh bank check of the Meta account name and
// the transfer all happen in one step on the server (fund-request-send). If the account can no longer be verified nothing is sent.
function bvShowSendPinModal(id, summary) {
  bvCloseModal();
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay";
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
  overlay.innerHTML = `
    <div class="bv-modal">
      <button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
      <div class="ph-title" style="margin-bottom:6px;">Approve and send</div>
      <div style="font-size:12px;margin-bottom:10px;">${summary}</div>
      <form id="sendPinForm" novalidate>
        <div class="field"><label>Your transfer PIN *</label><input id="sendPinInput" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="4 to 6 digits"></div>
        <button type="submit" class="btn btn-a btn-full" style="margin-top:12px;" id="sendPinBtn">Approve and send</button>
        <div id="sendPinMsg"></div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById("sendPinInput")?.focus();
  document.getElementById("sendPinForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = document.getElementById("sendPinBtn"), msg = document.getElementById("sendPinMsg");
    const pin = document.getElementById("sendPinInput").value.trim();
    if (!/^\d{4,6}$/.test(pin)) { msg.innerHTML = `<div class="msg err">❌ Enter your 4 to 6 digit transfer PIN. Set one in Settings → Security if you have not.</div>`; return; }
    if (btn.disabled) return;
    btn.disabled = true; btn.textContent = "Checking the account and sending…";
    try {
      const r = await sbFn("fund-request-send", { action: "send", fund_request_id: id, pin });
      if (r.verified === false) {
        msg.innerHTML = `<div class="msg err">❌ Nothing was sent. ${escH(r.reason || "The account could not be verified.")}</div>`;
        btn.disabled = false; btn.textContent = "Approve and send";
        return;
      }
      if (r.error) throw new Error(r.error);
      bvCloseModal();
      bvToast(`Sent to ${r.account_name || "Meta"}`);
      if (r.receipt?.id) window.open("receipt.html?r=" + r.receipt.id, "_blank");
      renderWallet(document.getElementById("mainContent"));
    } catch (err) {
      msg.innerHTML = `<div class="msg err">❌ ${escH(err.message)}</div>`;
      btn.disabled = false; btn.textContent = "Approve and send";
    }
  });
}

// Matching an unmatched (held) deposit to an order. An admin matches directly; a buyer can only ask, for their own orders.
async function bvShowMatchModal(paymentId, amount) {
  bvCloseModal();
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay";
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
  overlay.innerHTML = `<div class="bv-modal"><div style="text-align:center;padding:30px;color:var(--muted);font-size:12px;">Loading orders…</div></div>`;
  document.body.appendChild(overlay);
  const isAdmin = window.myProfile?.role === "owner" || window.myProfile?.role === "admin";
  const orders = await sbQuery("orders", "select=id,customer_name,customer_phone,product_name,order_value_naira,order_status,ordered_at,media_buyers(name),payments(status)&order_status=in.(pending,valid,delivered)&order=ordered_at.desc&limit=300").catch(() => []);
  const cands = (orders || []).filter(o => Math.abs(Number(o.order_value_naira || 0) - Number(amount)) <= 1 && !(o.payments || []).some(x => x.status === "confirmed"));
  const modal = overlay.querySelector(".bv-modal");
  modal.innerHTML = `
    <button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
    <div class="ph-title" style="margin-bottom:6px;">${isAdmin ? "Match deposit to an order" : "Match deposit to my order"}</div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">Deposit of ${fN(amount)}. Only orders worth exactly this amount with no confirmed payment are shown.${isAdmin ? "" : " Your admin must approve the match before it counts."}</div>
    ${!cands.length ? `<div class="empty"><div class="empty-ico">🔎</div>No ${isAdmin ? "" : "of your "}orders of exactly ${fN(amount)} are waiting for payment.</div>` : `
    <div class="field"><label>Order</label><select id="bvMatchOrder">${cands.map(o => `<option value="${o.id}">${escH(o.customer_name || "Customer")} · ${escH(o.product_name || "")} · ${fN(o.order_value_naira)} · ${new Date(o.ordered_at).toLocaleDateString()}${isAdmin && o.media_buyers?.name ? " · " + escH(o.media_buyers.name) : ""}</option>`).join("")}</select></div>
    <div id="bvMatchMsg" style="font-size:11.5px;margin:8px 0;"></div>
    <button type="button" class="btn btn-a" id="bvMatchGo">${isAdmin ? "Match now" : "Request approval"}</button>`}`;
  document.getElementById("bvMatchGo")?.addEventListener("click", async (e) => {
    const btn = e.target, msg = document.getElementById("bvMatchMsg"), orderId = document.getElementById("bvMatchOrder").value;
    btn.disabled = true; msg.textContent = "Working…";
    let err = null;
    if (isAdmin) {
      const { error } = await supabaseClient.rpc("match_held_payment", { p_payment_id: paymentId, p_order_id: orderId });
      err = error;
    } else {
      const { error } = await supabaseClient.from("payment_match_requests").insert({ company_id: window.myProfile.company_id, payment_id: paymentId, order_id: orderId, media_buyer_id: window.myProfile.media_buyer_id });
      err = error;
    }
    if (err) { msg.style.color = "var(--danger)"; msg.textContent = (err.message || "Could not do that.").replace(/^.*?:\s*/, ""); btn.disabled = false; return; }
    bvCloseModal();
    renderWallet(document.getElementById("mainContent"));
  });
}
async function bvDecideMatch(requestId, decision, paymentId, orderId) {
  if (decision === "approve") {
    if (!confirm("Count this deposit as the payment for that order? It leaves the company wallet.")) return;
    const { error } = await supabaseClient.rpc("match_held_payment", { p_payment_id: paymentId, p_order_id: orderId, p_request_id: requestId });
    if (error) { alert((error.message || "Could not match.").replace(/^.*?:\s*/, "")); return; }
  } else {
    const { error } = await supabaseClient.from("payment_match_requests").update({ status: "declined", decided_at: new Date().toISOString(), decided_by: (await supabaseClient.auth.getUser()).data.user.id }).eq("id", requestId);
    if (error) { alert("Could not decline: " + error.message); return; }
  }
  renderWallet(document.getElementById("mainContent"));
}

// ---- Revora ad-account wallets: a buyer's own wallet pays for the Revora accounts shared with them ----
function bvWalletModal(inner) {
  bvCloseModal();
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay"; overlay.className = "bv-overlay";
  overlay.onclick = e => { if (e.target === overlay) bvCloseModal(); };
  overlay.innerHTML = `<div class="bv-modal"><button class="bv-modal-close" onclick="bvCloseModal()">✕</button>${inner}</div>`;
  document.body.appendChild(overlay);
  return overlay;
}
function bvTopUpModal(target, name) {
  const who = name ? `${escH(name)}'s Revora wallet` : target === "company" ? "the company wallet" : "your Revora wallet";
  const ov = bvWalletModal(`<div class="ph-title" style="margin-bottom:6px;">Top up ${who}</div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">Pay securely with card, bank transfer or USSD. The money is added to the wallet as soon as the payment is confirmed.</div>
    <div class="field"><label>Amount (₦)</label><input id="tuAmt" type="number" min="1000" step="500" value="10000"></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;">${[5000, 10000, 20000, 50000, 100000].map(n => `<button type="button" class="btn" data-a="${n}" style="padding:3px 10px;font-size:10.5px;">${n.toLocaleString()}</button>`).join("")}</div>
    <button type="button" class="btn btn-a btn-full" id="tuGo">Continue to payment</button><div id="tuMsg" style="margin-top:8px;"></div>`);
  ov.querySelectorAll("[data-a]").forEach(b => b.onclick = () => { ov.querySelector("#tuAmt").value = b.dataset.a; });
  ov.querySelector("#tuGo").onclick = async e => {
    const btn = e.target, msg = ov.querySelector("#tuMsg"); btn.disabled = true; btn.textContent = "Starting…";
    const r = await sbFn("wallet-topup", { action: "start", amount: Number(ov.querySelector("#tuAmt").value), target, return_url: location.origin + location.pathname + "?wallet=done" }).catch(err => ({ error: err.message }));
    if (r.error || !r.authorization_url) { msg.innerHTML = `<div class="msg err">❌ ${escH(r.error || "Could not start the payment.")}</div>`; btn.disabled = false; btn.textContent = "Continue to payment"; return; }
    location.href = r.authorization_url;
  };
}
function bvMoveFundsModal(buyerId, name, mode) {
  const give = mode === "allocate";
  const ov = bvWalletModal(`<div class="ph-title" style="margin-bottom:6px;">${give ? "Give funds to" : "Take funds back from"} ${escH(name)}</div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">${give ? "Moves money from the company wallet into their Revora wallet, so their Revora ad accounts can run." : "Moves unused money from their Revora wallet back to the company wallet."}</div>
    <div class="field"><label>Amount (₦)</label><input id="mvAmt" type="number" min="100" step="500" value="5000"></div>
    <button type="button" class="btn btn-a btn-full" id="mvGo" style="margin-top:8px;">${give ? "Give funds" : "Take back"}</button><div id="mvMsg" style="margin-top:8px;"></div>`);
  ov.querySelector("#mvGo").onclick = async e => {
    const btn = e.target, msg = ov.querySelector("#mvMsg"); btn.disabled = true;
    const r = await sbFn("wallet-topup", { action: mode, buyer_id: buyerId, amount: Number(ov.querySelector("#mvAmt").value) }).catch(err => ({ error: err.message }));
    if (r.error) { msg.innerHTML = `<div class="msg err">❌ ${escH(r.error)}</div>`; btn.disabled = false; return; }
    bvCloseModal(); bvToast(give ? "Funds given" : "Funds taken back"); renderWallet(document.getElementById("mainContent"));
  };
}
function bvAskWalletModal() {
  const ov = bvWalletModal(`<div class="ph-title" style="margin-bottom:6px;">Ask your admin for funds</div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">Your admin sends the money straight into your Revora wallet, so your Revora ad accounts can keep running. (For an ad account you brought yourself, use "Request funds" in the section above instead.)</div>
    <div class="field"><label>Amount (₦)</label><input id="awAmt" type="number" min="500" step="500" value="10000"></div>
    <div class="field" style="margin-top:8px;"><label>Note (optional)</label><input id="awNote" maxlength="200" placeholder="e.g. scaling the herbal tea campaign"></div>
    <button type="button" class="btn btn-a btn-full" id="awGo" style="margin-top:10px;">Send request</button><div id="awMsg" style="margin-top:8px;"></div>`);
  ov.querySelector("#awGo").onclick = async e => {
    const btn = e.target, msg = ov.querySelector("#awMsg"); btn.disabled = true;
    const r = await sbFn("wallet-topup", { action: "request", amount: Number(ov.querySelector("#awAmt").value), note: ov.querySelector("#awNote").value }).catch(err => ({ error: err.message }));
    if (r.error) { msg.innerHTML = `<div class="msg err">❌ ${escH(r.error)}</div>`; btn.disabled = false; return; }
    bvCloseModal(); bvToast("Request sent to your admin"); renderWallet(document.getElementById("mainContent"));
  };
}
async function bvDecideWalletReq(id, decision, btn) {
  btn.disabled = true;
  const r = await sbFn("wallet-topup", { action: "decide", id, decision }).catch(err => ({ error: err.message }));
  if (r.error) { bvToast(r.error, "err"); btn.disabled = false; return; }
  bvToast(decision === "approve" ? "Sent to their wallet" : "Declined"); renderWallet(document.getElementById("mainContent"));
}
// Coming back from Paystack: confirm the payment and credit the wallet.
async function bvTopUpReturn() {
  try {
    const q = new URLSearchParams(location.search), ref = q.get("reference") || q.get("trxref");
    if (q.get("wallet") !== "done" || !ref || !/^wt_/.test(ref)) return;
    const v = await sbFn("wallet-topup", { action: "verify", reference: ref });
    history.replaceState(null, "", location.pathname);
    bvToast(v?.ok ? "Top-up received. Your wallet is updated." : (v?.error || "We could not confirm that payment yet. If you were charged it will show within a few minutes."), v?.ok ? "ok" : "err");
    const t = document.querySelector('[data-tab="wallet"]'); if (t) t.click();
  } catch (e) { console.warn("wallet return", e); }
}