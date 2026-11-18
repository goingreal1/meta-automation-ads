// Revora dashboard, part 23 of 25: OVERVIEW (rebuilt). One screen for everyone; what it shows depends on the role and on what data exists.
//   - People with ad accounts see live Meta numbers (spend, cost per order, page views ...) next to their orders.
//   - Everyone sees orders, the order pipeline and what needs attention. Admins also see the media buyers table.
// Nothing here is invented: a number that the system does not have is left out, not guessed.

const RV_IC = {
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 010-4h14v4"/><path d="M3 5v14a2 2 0 002 2h16v-5"/><path d="M18 12a2 2 0 000 4h4v-4z"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8"/>',
  dots: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  refresh: '<path d="M21 12a9 9 0 01-15.5 6.2L3 16M3 12a9 9 0 0115.5-6.2L21 8M21 3v5h-5M3 21v-5h5"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
};
const rvIc = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${RV_IC[n] || ""}</svg>`;
const OV = { range: 7, chartArgs: null };
const ovWat = (iso) => new Date(new Date(iso).getTime() + 3600000).toISOString().slice(0, 10);
const ovDates = (since, n) => Array.from({ length: n }, (_, i) => new Date(new Date(since + "T00:00:00Z").getTime() + i * 86400000).toISOString().slice(0, 10));
const ovShort = (n) => n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M" : n >= 1e4 ? Math.round(n / 1e3) + "K" : Number(n).toLocaleString("en-NG", { maximumFractionDigits: 0 });
const ovNum = (n, d = 0) => n == null ? "—" : Number(n).toLocaleString("en-NG", { maximumFractionDigits: d, minimumFractionDigits: d });

// Change versus the previous period. For costs, lower is the good direction.
function ovDelta(c, p, lowerBetter) {
  if (c == null || p == null || p === 0) return { t: "no earlier data", c: "fl" };
  const pct = (c - p) / p * 100;
  if (Math.abs(pct) < 0.5) return { t: "no change", c: "fl" };
  return { t: (pct > 0 ? "▲ " : "▼ ") + Math.abs(pct).toFixed(0) + "%", c: (lowerBetter ? pct < 0 : pct > 0) ? "up" : "dn" };
}
function ovSpark(vals, color) {
  const v = vals.map((x) => (x == null ? 0 : x)), w = 200, h = 34;
  if (v.length < 2 || Math.max(...v) === Math.min(...v)) return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="M0 ${h - 2} L${w} ${h - 2}" stroke="${color}" stroke-width="1.8" fill="none" opacity=".4"/></svg>`;
  const mx = Math.max(...v), mn = Math.min(...v), r = mx - mn, st = w / (v.length - 1);
  const pts = v.map((x, i) => [i * st, h - 2 - ((x - mn) / r) * (h - 4)]);
  const d = "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L");
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d} L${w} ${h} L0 ${h} Z" fill="${color}" opacity=".10"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}
function ovDrawChart() {
  const el = document.getElementById("rvChart"), a = OV.chartArgs; if (!el || !a) return;
  const W = el.clientWidth || 600, H = el.clientHeight || 230, L = 52, B = 26, T = 10, n = a.dates.length, cw = (W - L) / n;
  const mxB = Math.max(1, ...a.bars), mxL = Math.max(1, ...(a.line || [0]));
  const niceTop = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return ([1, 2, 4, 8, 10].find((f) => m <= f) || 10) * p; }; // 4 clean steps: 25, 50, 75, 100 ...
  const top = niceTop(mxB);
  const lab = (v) => a.money ? "₦" + ovShort(v) : ovShort(v);
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escH(a.label)}">`;
  for (let g = 0; g <= 4; g++) { const y = T + (H - B - T) * g / 4; s += `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--border,#e4e6eb)"/><text x="0" y="${y + 4}" font-size="11" fill="var(--muted,#8a8d91)">${lab(top - top * g / 4)}</text>`; }
  const step = n > 14 ? Math.ceil(n / 8) : 1;
  a.bars.forEach((v, i) => { const h = (H - B - T) * v / top; s += `<rect x="${L + i * cw + cw * .2}" y="${H - B - h}" width="${cw * .6}" height="${h}" rx="4" fill="${a.barColor}"/>`; if (i % step === 0) s += `<text x="${L + i * cw + cw / 2}" y="${H - 8}" font-size="11.5" fill="var(--text2,#65676b)" text-anchor="middle">${escH(a.dates[i])}</text>`; });
  if (a.line) { const pts = a.line.map((v, i) => [L + i * cw + cw / 2, H - B - (H - B - T) * v / mxL]); s += `<path d="M${pts.map((p) => p[0] + " " + p[1]).join(" L")}" fill="none" stroke="var(--text,#1c1e21)" stroke-width="2" stroke-linejoin="round"/>`; if (n <= 31) pts.forEach((p) => { s += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="var(--panel,#fff)" stroke="var(--text,#1c1e21)" stroke-width="2"/>`; }); }
  el.innerHTML = s + "</svg>";
}
window.addEventListener("resize", () => { if (document.getElementById("rvChart")) ovDrawChart(); });

async function renderOverview(el) {
  const role = window.myProfile?.role, isAdmin = bvIsAdminRole();
  const canAds = ["owner", "admin", "buyer"].includes(role);
  const n = OV.range, until = watDate(0), since = watDate(-(n - 1)), pUntil = watDate(-n), pSince = watDate(-(2 * n - 1));
  el.innerHTML = `<div class="rv-ui"><div class="rv-note">Loading your overview…</div></div>`;
  const [orders, buyers, wallet, setup, live, bals, aiReady, aiTeam] = await Promise.all([
    sbQuery("orders", `select=order_status,order_value_naira,media_buyer_id,ordered_at,delivery_stage&ordered_at=gte.${pSince}T00:00:00%2B01:00&order=ordered_at.desc&limit=5000`).catch(() => []),
    isAdmin ? sbQuery("media_buyers", "select=id,code,name&order=code.asc").catch(() => []) : Promise.resolve([]),
    fetchWalletBalances().catch(() => ({ walletBalances: {}, fundingWalletBalance: null })),
    bvSetupState().catch(() => null),
    canAds ? fetchLiveDaily(pSince, until) : Promise.resolve({ ok: true, rows: [], accounts: [] }),
    canAds ? amCall({ action: "balances" }) : Promise.resolve(null),
    canAds ? sbCount("ai_team_images", "status=eq.ready").catch(() => 0) : Promise.resolve(0),
    canAds ? sbQuery("ai_teams", "select=daily_meeting,meeting_hour_lagos,auto_launch&limit=1").then((r) => r?.[0] || null).catch(() => null) : Promise.resolve(null),
  ]);

  const inCur = (d) => d >= since && d <= until, inPrev = (d) => d >= pSince && d <= pUntil;
  const rows = live.rows || [], curRows = rows.filter((r) => inCur(r.date)), prevRows = rows.filter((r) => inPrev(r.date));
  const C = liveSum(curRows), P = liveSum(prevRows);
  const cur = [], old = [];
  (orders || []).forEach((o) => (inCur(ovWat(o.ordered_at)) ? cur : old).push(o));
  const sumV = (a) => a.reduce((t, o) => t + Number(o.order_value_naira || 0), 0);
  const isDel = (o) => o.order_status === "delivered";
  const delCur = cur.filter(isDel), delOld = old.filter(isDel);
  const hasAds = canAds && live.ok && (C.spend > 0 || P.spend > 0);
  const dates = ovDates(since, n);
  const spendByDay = new Map(), ordersByDay = new Map(), delValByDay = new Map();
  curRows.forEach((r) => spendByDay.set(r.date, (spendByDay.get(r.date) || 0) + r.spend));
  cur.forEach((o) => { const d = ovWat(o.ordered_at); ordersByDay.set(d, (ordersByDay.get(d) || 0) + 1); if (isDel(o)) delValByDay.set(d, (delValByDay.get(d) || 0) + Number(o.order_value_naira || 0)); });
  const dSpend = dates.map((d) => spendByDay.get(d) || 0), dOrders = dates.map((d) => ordersByDay.get(d) || 0);
  const dCpo = dates.map((d, i) => (dOrders[i] > 0 ? dSpend[i] / dOrders[i] : null)), dRoas = dates.map((d, i) => (dSpend[i] > 0 ? (delValByDay.get(d) || 0) / dSpend[i] : null));

  // ---- headline numbers
  const roas = C.spend > 0 && delCur.length ? sumV(delCur) / C.spend : null, roasP = P.spend > 0 && delOld.length ? sumV(delOld) / P.spend : null;
  const cpo = C.spend > 0 && cur.length ? C.spend / cur.length : null, cpoP = P.spend > 0 && old.length ? P.spend / old.length : null;
  const doneC = cur.filter((o) => ["delivered", "returned", "cancelled", "failed"].includes(o.order_status)), doneO = old.filter((o) => ["delivered", "returned", "cancelled", "failed"].includes(o.order_status));
  const rateC = doneC.length ? delCur.length / doneC.length * 100 : null, rateO = doneO.length ? delOld.length / doneO.length * 100 : null;
  const pendingC = cur.filter((o) => o.order_status === "pending").length;
  const kpis = hasAds ? [
    { l: "Spend", v: fN(C.spend), d: ovDelta(C.spend, P.spend, false, true), neutral: true, s: dSpend, col: "#1877f2" },
    { l: "Orders", v: ovNum(cur.length), d: ovDelta(cur.length, old.length, false), s: dOrders, col: "#1a8f4c" },
    { l: "Cost per order", v: cpo == null ? "—" : fN(cpo), d: ovDelta(cpo, cpoP, true), s: dCpo.map((x) => x ?? 0), col: "#1877f2" },
    { l: "Real ROAS", v: roas == null ? "—" : roas.toFixed(1) + "x", d: roas == null ? { t: "no delivered orders yet", c: "fl" } : ovDelta(roas, roasP, false), s: dRoas.map((x) => x ?? 0), col: "#1a8f4c" },
  ] : [
    { l: "Orders", v: ovNum(cur.length), d: ovDelta(cur.length, old.length, false), s: dOrders, col: "#1a8f4c" },
    { l: "Order value", v: fN(sumV(cur)), d: ovDelta(sumV(cur), sumV(old), false), s: dates.map((d) => cur.filter((o) => ovWat(o.ordered_at) === d).reduce((t, o) => t + Number(o.order_value_naira || 0), 0)), col: "#1877f2" },
    { l: "Delivery rate", v: rateC == null ? "—" : rateC.toFixed(0) + "%", d: ovDelta(rateC, rateO, false), s: [], col: "#1a8f4c" },
    { l: "Waiting to be handled", v: ovNum(pendingC), d: { t: "pending orders", c: "fl" }, s: [], col: "#b36b00", novs: true },
  ];

  // ---- needs attention (only real, checkable things)
  const attn = [];
  const stale = (orders || []).filter((o) => o.order_status === "pending" && Date.now() - new Date(o.ordered_at).getTime() > 86400000);
  if (stale.length) attn.push({ k: "b", ic: "alert", t: `${stale.length} order${stale.length > 1 ? "s" : ""} wait for confirmation`, s: `The oldest is ${Math.floor((Date.now() - Math.min(...stale.map((o) => new Date(o.ordered_at).getTime()))) / 3600000)} hours old`, b: "Open", go: "orders" });
  const fund = wallet.fundingWalletBalance;
  if (isAdmin && fund != null && fund < 0) attn.push({ k: "w", ic: "wallet", t: "Funding wallet is low", s: `${fN(fund)} available`, b: "Wallet", go: "wallet" });
  ((bals && bals.ok && bals.accounts) || []).forEach((a) => {
    if (a.available != null && a.low_threshold != null && a.available <= a.low_threshold) attn.push({ k: "w", ic: "wallet", t: `${escH(a.name || "Ad account")} balance is low`, s: `${fN2(a.available)} left on Meta`, b: "Top up", go: "wallet" });
    if (a.account_status && a.account_status !== 1) attn.push({ k: "b", ic: "alert", t: `${escH(a.name || "Ad account")}: ${escH(AM_ACCT_STATUS[a.account_status] || "account issue")}`, s: "Meta flagged this ad account", b: "Settings", go: "settings" });
  });
  if (setup && !setup.done) { const nx = setup.items.find((i) => !i.done); if (nx) attn.push({ k: "i", ic: "star", t: `Next step: ${escH(nx.label)}`, s: "Finish setup to unlock everything", b: "Do it", setup: nx.go }); }

  // ---- pipeline
  const out = cur.filter((o) => o.order_status === "valid" && ["on_the_way", "out_for_delivery", "picked_up", "in_transit"].includes(o.delivery_stage)).length;
  const pipe = [["New", pendingC, "#f0b429"], ["Confirmed", cur.filter((o) => o.order_status === "valid").length - out, "#1877f2"], ["Out for delivery", out, "#7c5cff"], ["Delivered", delCur.length, "#1a8f4c"], ["Cancelled", cur.filter((o) => ["cancelled", "failed", "returned"].includes(o.order_status)).length, "#c5c9cf"]];
  const pipeTot = pipe.reduce((t, p) => t + p[1], 0);

  // ---- best ad sets (from the live rows)
  const bySet = new Map();
  curRows.forEach((r) => { const k = r.adset_id; const x = bySet.get(k) || { name: r.adset_name, camp: r.campaign_name, kind: r.kind, spend: 0, res: 0, lpv: 0 }; x.spend += r.spend; x.res += (r.kind === "purchase" ? r.purchases : r.conversations) || 0; x.lpv += r.landing_page_views || 0; bySet.set(k, x); });
  const sets = [...bySet.values()].filter((x) => x.spend > 0).sort((a, b) => b.res - a.res || b.spend - a.spend).slice(0, 5);

  // ---- media buyers (admins)
  const byBuyer = new Map();
  cur.forEach((o) => { const k = o.media_buyer_id || "none"; const r = byBuyer.get(k) || { n: 0, rev: 0, del: 0, ret: 0 }; r.n++; r.rev += Number(o.order_value_naira || 0); if (isDel(o)) r.del++; if (o.order_status === "returned") r.ret++; byBuyer.set(k, r); });
  const nameOf = (id) => { const b = (buyers || []).find((x) => x.id === id); return b ? (b.name || b.code) : "Unassigned"; };
  const buyerRows = [...byBuyer.entries()].sort((a, b) => b[1].n - a[1].n);

  // ---- all metrics (every number Meta gives us for the period)
  const cpm = (x) => (x.impressions > 0 ? x.spend / x.impressions * 1000 : null), cpc = (x) => (x.clicks > 0 ? x.spend / x.clicks : null);
  const mx = hasAds ? [
    ["Impressions", ovShort(C.impressions), ovDelta(C.impressions, P.impressions, false)], ["CPM", cpm(C) == null ? "—" : fN(cpm(C)), ovDelta(cpm(C), cpm(P), true)],
    ["Link clicks", ovNum(C.clicks), ovDelta(C.clicks, P.clicks, false)], ["CTR (link)", C.linkCtr == null ? "—" : C.linkCtr.toFixed(2) + "%", ovDelta(C.linkCtr, P.linkCtr, false)],
    ["CPC (link)", cpc(C) == null ? "—" : fN2(cpc(C)), ovDelta(cpc(C), cpc(P), true)], ["Purchases (Meta)", ovNum(C.purchases), ovDelta(C.purchases, P.purchases, false)],
    ["Page views", ovNum(C.lpv), ovDelta(C.lpv, P.lpv, false), 1], ["Cost per page view", C.costPerLpv == null ? "—" : fN2(C.costPerLpv), ovDelta(C.costPerLpv, P.costPerLpv, true), 1],
    ["Page view rate", C.lpvRate == null ? "—" : C.lpvRate.toFixed(1) + "%", ovDelta(C.lpvRate, P.lpvRate, false), 1], ["Messages started", ovNum(C.conversations), ovDelta(C.conversations, P.conversations, false)],
    ["Cost per message", C.costPerConv == null ? "—" : fN(C.costPerConv), ovDelta(C.costPerConv, P.costPerConv, true)], ["Order value", fN(sumV(cur)), ovDelta(sumV(cur), sumV(old), false)],
  ] : [];

  const hour = new Date(Date.now() + 3600000).getUTCHours(), first = String(window.myProfile?.display_name || "").split(" ")[0];
  const greet = (hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening") + (first ? ", " + escH(first) : "");
  const dd = (x) => `<span class="rv-d ${x.c}">${x.t}</span>`;
  const meetHour = aiTeam?.meeting_hour_lagos != null ? ((aiTeam.meeting_hour_lagos % 12) || 12) + ":00 " + (aiTeam.meeting_hour_lagos < 12 ? "AM" : "PM") : "";

  OV.chartArgs = hasAds
    ? { dates: dates.map((d) => d.slice(5)), bars: dSpend.map((x) => Math.round(x)), line: dOrders, barColor: "color-mix(in srgb, #1877f2 28%, transparent)", money: true, label: "Spend per day with orders" }
    : { dates: dates.map((d) => d.slice(5)), bars: dOrders, line: null, barColor: "color-mix(in srgb, #1877f2 35%, transparent)", money: false, label: "Orders per day" };

  el.innerHTML = `<div class="rv-ui">
    <div class="rv-head"><div><h1>${greet}</h1><p>${canAds && !live.ok ? "Live numbers from Meta could not be loaded just now." : "Here is how your business is doing."}</p></div><div class="rv-sp"></div>
      <div class="rv-seg">${[[1, "Today"], [7, "7 days"], [30, "30 days"]].map((r) => `<button class="${OV.range === r[0] ? "on" : ""}" onclick="OV.range=${r[0]};render()">${r[1]}</button>`).join("")}</div>
      ${canAds ? `<details class="rv-menu"><summary class="rv-btn" aria-label="Data options" data-hint="Refresh and sync data">${rvIc("dots")}</summary><div class="rv-pop">
        <button type="button" onclick="this.closest('details').open=false;liveDaily.at=0;render()">${rvIc("refresh")} Refresh live data</button>
        <button type="button" id="btnPull" onclick="triggerMetrics()">${rvIc("refresh")} Pull Meta metrics</button>
        <button type="button" id="btnStructSync" onclick="triggerStructureSync()">${rvIc("refresh")} Sync campaigns from Meta</button>
        <button type="button" id="btnSync" onclick="triggerSync()">${rvIc("refresh")} Sync audiences</button></div></details>` : ""}
    </div>
    <div id="actionMsg"></div><div id="actionResult"></div><div id="qaActions" style="display:none"></div>
    ${canAds && !live.ok ? `<div class="rv-note">${rvIc("alert")}<span>Couldn't load live numbers from Meta: ${escH(live.error || "unknown error")}</span><button type="button" class="rv-btn s" style="margin-left:auto" onclick="liveDaily.at=0;render()">Try again</button></div>` : ""}
    ${canAds && live.ok && (live.accounts || []).some((a) => a.error) ? `<div class="rv-note">${rvIc("alert")}<span>Some ad accounts could not be read from Meta (${(live.accounts || []).filter((a) => a.error).map((a) => escH(a.name || "account")).join(", ")}), so their numbers are missing.</span></div>` : ""}

    <div class="rv-grid rv-kpis">${kpis.map((k) => `<div class="rv-card rv-kpi"><div class="lb">${k.l}</div><div class="v">${k.v}</div><div class="sub">${k.neutral ? `<span class="rv-d fl">${k.d.t.replace(/^[▲▼] /, (m) => m)}</span>` : dd(k.d)}${k.novs ? "" : `<span class="rv-vs">vs previous ${n === 1 ? "day" : n + " days"}</span>`}</div>${k.s.length ? `<div class="sp2">${ovSpark(k.s, k.col)}</div>` : ""}</div>`).join("")}</div>

    <div class="rv-grid rv-two">
      <section class="rv-card rv-cp"><div class="rv-ct"><h3>${hasAds ? "Spend and orders" : "Orders per day"}</h3>${hasAds ? `<span class="rv-pill n rv-lgd" style="margin-left:6px"><span style="width:8px;height:8px;border-radius:2px;background:#bcd3f7;display:inline-block"></span>Spend</span><span class="rv-pill n rv-lgd"><span style="width:8px;height:8px;border-radius:50%;background:var(--text,#1c1e21);display:inline-block"></span>Orders</span>` : ""}<button type="button" class="l rv-hm" onclick="bvGoToTab('${hasAds ? "performance" : "orders"}')">Open report</button></div><div class="rv-chart" id="rvChart"></div></section>
      <section class="rv-card rv-cp"><div class="rv-ct"><h3>Needs your attention</h3>${attn.length ? `<span class="rv-pill bad n" style="margin-left:auto">${attn.length}</span>` : ""}</div>
        ${attn.length ? attn.map((a) => `<div class="rv-attn"><div class="rv-ico ${a.k}">${rvIc(a.ic)}</div><div><b>${a.t}</b><span class="t">${a.s}</span></div><button type="button" class="rv-btn s" ${a.setup ? `onclick="bvSetupGo('${a.setup[0]}','${a.setup[1] || ""}')"` : `onclick="bvGoToTab('${a.go}')"`}>${a.b}</button></div>`).join("") : `<div class="rv-empty"><span class="rv-ico i">${rvIc("check")}</span>Nothing needs your attention right now.</div>`}
      </section>
    </div>

    <div class="rv-grid rv-two">
      <div class="rv-stack">
        ${hasAds ? `<section class="rv-card rv-cp"><div class="rv-ct"><h3>Best ad sets</h3><button type="button" class="l" onclick="bvGoToTab('campaigns')">All campaigns</button></div>
          ${sets.length ? `<table class="rv-tbl"><thead><tr><th>Ad set</th><th class="num">Spend</th><th class="num">Results</th><th class="num rv-hm">Cost / result</th><th class="num rv-hm">Page views</th></tr></thead><tbody>${sets.map((x) => `<tr><td><b>${escH(x.name || "Ad set")}</b><span class="s2">${escH(x.camp || "")}</span></td><td class="num">${fN(x.spend)}</td><td class="num">${ovNum(x.res)}</td><td class="num rv-hm">${x.res > 0 ? fN(x.spend / x.res) : "—"}</td><td class="num rv-hm">${x.kind === "purchase" ? ovNum(x.lpv) : "—"}</td></tr>`).join("")}</tbody></table>` : `<div class="rv-empty">No ad set spent money in this period.</div>`}
        </section>` : ""}
        ${isAdmin ? `<section class="rv-card rv-cp"><div class="rv-ct"><h3>Media buyers</h3><span class="rv-mut3">${(buyers || []).length} buyers</span><button type="button" class="l" onclick="bvGoToTab('leaderboard')">Leaderboard</button></div>
          ${buyerRows.length ? `<table class="rv-tbl"><thead><tr><th>Buyer</th><th class="num">Orders</th><th class="num">Order value</th><th class="num rv-hm">Delivered</th><th class="num rv-hm">Returned</th></tr></thead><tbody>${buyerRows.map(([id, r]) => `<tr><td><b>${escH(id === "none" ? "Unassigned" : nameOf(id))}</b></td><td class="num">${r.n}</td><td class="num">${fN(r.rev)}</td><td class="num rv-hm">${r.del}</td><td class="num rv-hm">${r.ret}</td></tr>`).join("")}</tbody></table>` : `<div class="rv-empty">No orders in this period.</div>`}
        </section>` : ""}
      </div>
      <div class="rv-stack">
        <section class="rv-card rv-cp"><div class="rv-ct"><h3>Orders ${n === 1 ? "today" : "this period"}</h3><button type="button" class="l" onclick="bvGoToTab('orders')">Open</button></div>
          ${pipeTot ? `<div class="rv-pipe">${pipe.filter((p) => p[1] > 0).map((p) => `<i style="width:${Math.max(2, p[1] / pipeTot * 100)}%;background:${p[2]}"></i>`).join("")}</div>` : ""}
          <div class="rv-leg">${pipe.map((p) => `<span class="k" style="--c:${p[2]}">${p[0]}</span><b>${p[1]}</b>`).join("")}</div></section>
        ${canAds ? `<section class="rv-card rv-cp"><div class="rv-ai"><div class="rv-ico i">${rvIc("users")}</div><div><b>AI Team</b><div class="rv-mut" style="margin-top:2px;font-size:14px">${aiReady > 0 ? `${aiReady} image${aiReady > 1 ? "s are" : " is"} waiting for your approval.` : aiTeam?.daily_meeting ? `Your daily meeting is at ${meetHour}.` : "Let your AI team plan, make images and launch for you."}</div><div style="margin-top:12px"><button type="button" class="rv-btn s p" onclick="location.href='/ai-team.html'">${aiReady > 0 ? "Review images" : "Open AI Team"}</button></div></div></div></section>` : ""}
        ${bals && bals.ok && (bals.accounts || []).length ? `<section class="rv-card rv-cp"><div class="rv-ct"><h3>Ad account balances</h3><span class="rv-mut3" style="font-size:12.5px">live from Meta</span></div>${bals.accounts.map((a) => a.error ? `<div class="rv-bal"><div><div class="nm">${escH(a.name || "Ad account")}</div></div><span class="rv-pill warn n" style="margin-left:auto">unavailable</span></div>` : `<div class="rv-bal"><div><div class="nm">${escH(a.name || "Ad account")}</div>${a.available == null ? `<span class="rv-mut3" style="font-size:12.5px">Card billed, no prepaid balance</span>` : ""}</div><span class="amt">${a.available != null ? fN2(a.available) : "—"}</span></div>`).join("")}</section>` : ""}
      </div>
    </div>

    ${mx.length ? `<section class="rv-card" style="margin-top:16px"><div class="rv-cp" style="padding-bottom:6px"><div class="rv-ct" style="margin-bottom:0"><h3>All metrics</h3><span class="rv-mut3 rv-hm" style="font-size:13px">Every number from Meta for this period.</span></div></div>
      <div class="rv-mx" style="margin-top:10px">${mx.map((m) => `<div class="${m[3] ? "hi" : ""}"><div class="l">${m[0]}</div><div class="v">${m[1]}</div><div>${dd(m[2])}</div></div>`).join("")}</div>
      <div class="rv-mut3" style="font-size:12px;padding:10px 20px 14px">Reach and frequency are not added up here because Meta cannot sum them across ad sets.</div></section>` : ""}
  </div>`;
  requestAnimationFrame(ovDrawChart);
}
