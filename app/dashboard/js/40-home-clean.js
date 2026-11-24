// ── Home, light and visual: spend hero, what needs you, where people drop off, campaign bars, ad accounts.
// Same data as the previous Home (orders, live Meta daily numbers, balances, reach, AI Team). If anything here fails, the previous Home is drawn instead.
(function () {
  if (window.__hxInstalled) return; window.__hxInstalled = true;
  const oldRender = window.renderOverview;

  const css = `
  .hx{max-width:640px;margin:0 auto;padding:4px 0 24px;color:var(--text)}
  .hx button{font-family:inherit}
  .hx-greet{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:2px 4px 12px}
  .hx-greet b{font-size:20px;font-weight:750;letter-spacing:-.01em}.hx-greet small{display:block;font-size:12px;color:var(--muted);font-weight:500}
  .hx-hero{padding:18px 18px 8px;border-radius:26px;background:#0f2a66;color:#fff;overflow:hidden}
  .hx-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .hx-hero small{font-size:13px;color:#b8c8ee;font-weight:600}
  .hx-seg{display:flex;background:rgba(255,255,255,.12);border-radius:10px;padding:2px}
  .hx-seg button{height:32px;padding:0 11px;border:0;border-radius:8px;background:transparent;color:#b8c8ee;font-size:12px;font-weight:600;cursor:pointer}
  .hx-seg button.on{background:#fff;color:#0f2a66;font-weight:700}
  .hx-spend{font-size:42px;font-weight:750;letter-spacing:-.03em;margin-top:4px;line-height:1.1}
  .hx-delta{font-size:13px;color:#b8c8ee;font-weight:600;margin-left:8px;letter-spacing:0}
  .hx-spark{display:block;margin-top:6px;width:100%;height:84px}
  .hx-three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:12px 0;border-top:1px solid rgba(255,255,255,.14)}
  .hx-three b{display:block;font-size:22px;font-weight:750}.hx-three span{font-size:12px;color:#b8c8ee}
  .hx-note{display:flex;align-items:center;gap:10px;margin-top:12px;padding:10px 14px;border-radius:16px;background:rgba(217,130,0,.14);font-size:13px;color:var(--text)}
  .hx-note span{flex:1}.hx-note button{height:40px;padding:0 14px;border:0;border-radius:12px;background:var(--panel);color:var(--text);font-weight:700;cursor:pointer}
  .hx-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px}
  .hx-tile{border:0;padding:14px 12px;border-radius:20px;background:var(--panel);color:var(--text);text-align:left;cursor:pointer;box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06)}
  .hx-tile i{width:36px;height:36px;border-radius:12px;display:flex;align-items:center;justify-content:center}
  .hx-tile i svg,.hx-ic svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .hx-tile b{display:block;font-size:20px;font-weight:750;margin-top:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .hx-tile span{display:block;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .hx-ok{display:flex;align-items:center;gap:12px;margin-top:12px;padding:14px 16px;border-radius:20px;background:rgba(24,163,90,.12);font-weight:650}
  .hx-ok i{width:36px;height:36px;border-radius:12px;background:#18a35a;color:#fff;display:flex;align-items:center;justify-content:center;flex:none}
  .hx-ok svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
  .hx-card{margin-top:12px;padding:18px;border-radius:24px;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06)}
  .hx-card h3{margin:0;font-size:16px;font-weight:700}
  .hx-ch{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .hx-q{width:44px;height:44px;margin:-10px -10px -10px 0;border:0;background:transparent;color:var(--muted);display:flex;align-items:center;justify-content:center;cursor:pointer}
  .hx-q svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .hx-fn{display:grid;gap:6px;margin-top:12px}
  .hx-drop{display:flex;align-items:center;gap:6px;padding:2px 0 2px 4px;font-size:12px;font-weight:650;color:var(--muted)}
  .hx-drop svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
  .hx-step{display:flex;align-items:center;gap:10px}
  .hx-bar{height:40px;min-width:48px;border-radius:12px;display:flex;align-items:center;padding:0 12px;color:#fff;font-weight:750;font-size:15px}
  .hx-step em{font-style:normal;font-size:13px;color:var(--muted);white-space:nowrap}
  .hx-cta{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:48px;margin-top:14px;border:0;border-radius:14px;background:#1f6fff;color:#fff;font-size:14px;font-weight:700;cursor:pointer}
  .hx-cta svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
  .hx-link{border:0;background:none;color:#1f6fff;font-size:13px;font-weight:650;cursor:pointer;min-height:44px;padding:0 4px}
  .hx-camp{margin-top:6px;display:grid;gap:16px}
  .hx-camp>div{cursor:pointer}
  .hx-cn{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
  .hx-cn b{font-weight:650;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hx-cn span{font-weight:750}
  .hx-cb{height:10px;border-radius:5px;background:var(--panel2);margin-top:8px;overflow:hidden}.hx-cb i{display:block;height:100%;border-radius:5px;background:#1f6fff}
  .hx-dots{display:flex;gap:5px;margin-top:8px;align-items:center;font-size:12px;color:var(--muted)}.hx-dots i{width:12px;height:12px;border-radius:50%;background:#18a35a}
  .hx-pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .hx-p{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 14px;border-radius:18px;background:var(--panel2);font-size:13px;font-weight:650}
  .hx-p i{width:8px;height:8px;border-radius:50%;background:#18a35a}.hx-p.bad{background:rgba(229,72,77,.14)}.hx-p.bad i{background:#e5484d}.hx-p.warn{background:rgba(217,130,0,.16)}.hx-p.warn i{background:#d98200}
  .hx-bt{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}.hx-bt td{padding:10px 0;border-bottom:1px solid var(--border)}.hx-bt tr:last-child td{border:0}.hx-bt td:not(:first-child){text-align:right;font-weight:650}
  .hx-empty{padding:18px 4px;color:var(--text2);font-size:14px}
  .hx-ex{padding:8px 0 0}.hx-ex p{margin:0 0 14px;font-size:14px;color:var(--text2);line-height:1.45}.hx-ex b{color:var(--text)}
  `;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  const I = {
    card: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="14" rx="3"/><path d="M2 10h20"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
    img: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="m6 13 6 6 6-6"/></svg>',
    arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  };
  const esc = (s) => escH(String(s == null ? "" : s));

  async function hx(el) {
    const role = window.myProfile?.role, isAdmin = bvIsAdminRole(), canAds = ["owner", "admin", "buyer"].includes(role);
    const n = OV.range, until = watDate(0), since = watDate(-(n - 1)), pUntil = watDate(-n), pSince = watDate(-(2 * n - 1));
    el.innerHTML = `<div class="rv-ui">${typeof bvSkel === "function" ? bvSkel() : '<div class="rv-note">Loading your overview…</div>'}</div>`;
    const [orders, buyers, , , live, bals, aiReady, , rcCur] = await Promise.all([
      sbQuery("orders", `select=order_status,order_value_naira,media_buyer_id,ordered_at,delivery_stage&ordered_at=gte.${pSince}T00:00:00%2B01:00&order=ordered_at.desc&limit=5000`).catch(() => []),
      isAdmin ? sbQuery("media_buyers", "select=id,code,name&order=code.asc").catch(() => []) : Promise.resolve([]),
      Promise.resolve(null), Promise.resolve(null),
      canAds ? fetchLiveDaily(pSince, until) : Promise.resolve({ ok: true, rows: [], accounts: [] }),
      canAds ? amCall({ action: "balances" }) : Promise.resolve(null),
      canAds ? sbCount("ai_team_images", "status=eq.ready").catch(() => 0) : Promise.resolve(0),
      Promise.resolve(null),
      canAds ? amCall({ action: "reach", since, until }).catch(() => null) : Promise.resolve(null),
    ]);
    const inCur = (d) => d >= since && d <= until, inPrev = (d) => d >= pSince && d <= pUntil;
    const rows = live.rows || [], curRows = rows.filter((r) => inCur(r.date)), prevRows = rows.filter((r) => inPrev(r.date));
    const C = liveSum(curRows), P = liveSum(prevRows), RC = rcCur && rcCur.ok ? rcCur : null;
    const cur = [], old = [];
    (orders || []).forEach((o) => (inCur(ovWat(o.ordered_at)) ? cur : old).push(o));
    const sumV = (a) => a.reduce((t, o) => t + Number(o.order_value_naira || 0), 0), isDel = (o) => o.order_status === "delivered";
    const delCur = cur.filter(isDel), hasAds = canAds && live.ok && (C.spend > 0 || P.spend > 0);
    const dates = ovDates(since, n), spendByDay = new Map();
    curRows.forEach((r) => spendByDay.set(r.date, (spendByDay.get(r.date) || 0) + r.spend));
    const dSpend = dates.map((d) => spendByDay.get(d) || 0);
    const roas = C.spend > 0 && delCur.length ? sumV(delCur) / C.spend : null, cpo = C.spend > 0 && cur.length ? C.spend / cur.length : null;
    const done = cur.filter((o) => ["delivered", "returned", "cancelled", "failed"].includes(o.order_status)), rate = done.length ? delCur.length / done.length * 100 : null;
    const pendingC = cur.filter((o) => o.order_status === "pending").length;

    // spend curve for the hero
    const pts = dSpend.length > 1 ? dSpend : [0, ...dSpend, 0], mx = Math.max(1, ...pts);
    const xy = pts.map((v, i) => [i * (330 / (pts.length - 1)), 78 - (v / mx) * 66]);
    const line = "M" + xy.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L"), area = line + " L330 90 L0 90 Z";
    const dl = hasAds ? ovDelta(C.spend, P.spend, false, true) : null;

    const three = hasAds
      ? [[ovNum(cur.length), "Orders"], [cpo == null ? "—" : fN(cpo), "Each order"], [roas == null ? "—" : roas.toFixed(1) + "x", "Real ROAS"]]
      : [[ovNum(cur.length), "Orders"], [fN(sumV(cur)), "Order value"], [rate == null ? "—" : rate.toFixed(0) + "%", "Delivered"]];

    // what needs you: only real, checkable things
    const tiles = [];
    const stale = (orders || []).filter((o) => o.order_status === "pending" && Date.now() - new Date(o.ordered_at).getTime() > 86400000);
    const lowAcc = ((bals && bals.ok && bals.accounts) || []).filter((a) => !a.error && ((a.available != null && a.low_threshold != null && a.available <= a.low_threshold) || (a.account_status && a.account_status !== 1)));
    if (lowAcc.length) tiles.push({ c: "#e5484d", bg: "rgba(229,72,77,.14)", ic: I.card, v: lowAcc.length === 1 && lowAcc[0].available != null ? fN(lowAcc[0].available) : String(lowAcc.length), l: lowAcc.length === 1 ? lowAcc[0].name || "Ad account" : "accounts need you", go: "wallet" });
    if (stale.length) tiles.push({ c: "#d98200", bg: "rgba(217,130,0,.16)", ic: I.clock, v: String(stale.length), l: "to confirm", go: "orders" });
    if (aiReady > 0) tiles.push({ c: "#1f6fff", bg: "rgba(31,111,255,.14)", ic: I.img, v: String(aiReady), l: aiReady === 1 ? "image to OK" : "images to OK", href: "/ai-team.html" });
    const tilesHtml = tiles.length
      ? `<div class="hx-tiles">${tiles.slice(0, 3).map((t) => `<button type="button" class="hx-tile" onclick="${t.href ? `location.href='${t.href}'` : `bvGoToTab('${t.go}')`}"><i style="background:${t.bg};color:${t.c}">${t.ic}</i><b>${esc(t.v)}</b><span>${esc(t.l)}</span></button>`).join("")}</div>`
      : `<div class="hx-ok"><i>${I.check}</i>All clear</div>`;

    // funnel (website ads): reached > clicked > opened page > ordered
    let funnel = "";
    if (hasAds && C.clicks > 0) {
      const first = RC && RC.reach > 0 ? RC.reach : C.impressions, firstLabel = RC && RC.reach > 0 ? "Reached" : "Seen";
      const steps = [[firstLabel, first, null]];
      steps.push(["Clicked", C.clicks, first > 0 ? C.clicks / first * 100 : null, "clicked"]);
      if (C.lpv > 0) steps.push(["Opened page", C.lpv, C.clicks > 0 ? Math.min(100, C.lpv / C.clicks * 100) : null, "stayed"]);
      const prevV = steps[steps.length - 1][1];
      steps.push(["Ordered", cur.length, prevV > 0 ? cur.length / prevV * 100 : null, "ordered"]);
      const colors = ["#1f6fff", "#3d86ff", "#5c9bff", cur.length > 0 ? "#18a35a" : "#e5484d"];
      funnel = `<section class="hx-card"><div class="hx-ch"><h3>Where people drop off</h3><button type="button" class="hx-q" onclick="hxExplain()" aria-label="How to read this">${I.info}</button></div>
        <div class="hx-fn">${steps.map((s, i) => `<div>${s[2] != null ? `<div class="hx-drop">${I.down}${s[2] < 10 ? s[2].toFixed(1) : Math.round(s[2])}% ${s[3]}</div>` : ""}<div class="hx-step"><div class="hx-bar" style="width:${Math.max(14, Math.sqrt(s[1] / (steps[0][1] || 1)) * 100 * 0.72)}%;background:${colors[Math.min(i, colors.length - 1)]}">${ovNum(s[1])}</div><em>${esc(s[0])}</em></div></div>`).join("")}</div>
        <button type="button" class="hx-cta" onclick="hxJourney()">See what visitors did${I.arrow}</button></section>`;
    }

    // campaigns as bars
    const byC = new Map();
    curRows.forEach((r) => { const k = r.campaign_name || "Campaign"; const x = byC.get(k) || { name: k, spend: 0, res: 0 }; x.spend += r.spend; x.res += (r.kind === "purchase" ? r.purchases : r.conversations) || 0; byC.set(k, x); });
    const camps = [...byC.values()].filter((x) => x.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 3), topSpend = camps.length ? camps[0].spend : 1;
    const campHtml = hasAds ? `<section class="hx-card"><div class="hx-ch"><h3>Campaigns</h3><button type="button" class="hx-link" onclick="bvGoToTab('campaigns')">See all</button></div>
      ${camps.length ? `<div class="hx-camp">${camps.map((x) => `<div onclick="bvGoToTab('campaigns')"><div class="hx-cn"><b>${esc(x.name)}</b><span>${fN(x.spend)}</span></div><div class="hx-cb"><i style="width:${Math.max(4, x.spend / topSpend * 100)}%"></i></div><div class="hx-dots">${Array.from({ length: Math.min(8, x.res) }, () => "<i></i>").join("")}<span style="margin-left:${x.res ? 4 : 0}px">${x.res} result${x.res === 1 ? "" : "s"}</span></div></div>`).join("")}</div>` : `<div class="hx-empty">No campaign spent money in this period.</div>`}</section>` : "";

    // ad accounts
    const accs = (bals && bals.ok && bals.accounts) || [];
    const accHtml = accs.length ? `<section class="hx-card"><h3>Ad accounts</h3><div class="hx-pills">${accs.map((a) => { const bad = !a.error && ((a.available != null && a.low_threshold != null && a.available <= a.low_threshold) || (a.account_status && a.account_status !== 1)); return `<span class="hx-p ${a.error ? "warn" : bad ? "bad" : ""}"><i></i>${esc(a.name || "Account")}</span>`; }).join("")}</div></section>` : "";

    // media buyers (admins)
    const byBuyer = new Map(); cur.forEach((o) => { const k = o.media_buyer_id || "none"; const r = byBuyer.get(k) || { n: 0, rev: 0 }; r.n++; r.rev += Number(o.order_value_naira || 0); byBuyer.set(k, r); });
    const nameOf = (id) => { const b = (buyers || []).find((x) => x.id === id); return b ? (b.name || b.code) : "Unassigned"; };
    const buyerHtml = isAdmin && byBuyer.size ? `<section class="hx-card"><div class="hx-ch"><h3>Media buyers</h3><button type="button" class="hx-link" onclick="bvGoToTab('leaderboard')">Leaderboard</button></div><table class="hx-bt">${[...byBuyer.entries()].sort((a, b) => b[1].n - a[1].n).map(([id, r]) => `<tr><td>${esc(id === "none" ? "Unassigned" : nameOf(id))}</td><td>${r.n}</td><td>${fN(r.rev)}</td></tr>`).join("")}</table></section>` : "";

    const failed = canAds && live.ok ? (live.accounts || []).filter((a) => a.error) : [];
    const notes = (canAds && !live.ok ? `<div class="hx-note"><span>Live numbers from Meta could not be loaded just now.</span><button type="button" onclick="liveDaily.at=0;render()">Try again</button></div>` : "")
      + (failed.length ? `<div class="hx-note"><span>${failed.map((a) => esc(a.name || "An ad account")).join(", ")} could not be read from Meta, so ${failed.length === 1 ? "its" : "their"} numbers are missing.</span><button type="button" onclick="liveDaily.at=0;render()">Retry</button></div>` : "");

    const hour = new Date(Date.now() + 3600000).getUTCHours(), first = String(window.myProfile?.display_name || "").split(" ")[0];
    const greet = (hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening") + (first ? ", " + esc(first) : "");
    const spendLabel = hasAds ? "Spent" : "Orders";
    el.innerHTML = `<div class="rv-ui"><div class="hx">
      <div class="hx-greet"><div><b>${greet}</b></div></div>
      <div class="hx-hero"><div class="hx-row"><small>${spendLabel}</small><div class="hx-seg">${[[1, "Today"], [7, "7d"], [30, "30d"]].map((r) => `<button type="button" class="${OV.range === r[0] ? "on" : ""}" onclick="OV.range=${r[0]};render()">${r[1]}</button>`).join("")}</div></div>
        <div class="hx-spend">${hasAds ? fN(C.spend) : ovNum(cur.length)}${dl && dl.t ? `<span class="hx-delta">${esc(dl.t)}</span>` : ""}</div>
        ${hasAds ? `<svg class="hx-spark" viewBox="0 0 330 90" preserveAspectRatio="none" aria-hidden="true"><path d="${area}" fill="rgba(120,170,255,.22)"/><path d="${line}" fill="none" stroke="#7fb0ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>` : '<div style="height:14px"></div>'}
        <div class="hx-three">${three.map((t) => `<div><b>${esc(t[0])}</b><span>${esc(t[1])}</span></div>`).join("")}</div></div>
      ${notes}${tilesHtml}${funnel}${campHtml}${accHtml}${buyerHtml}</div></div>`;
  }

  window.hxExplain = function () {
    const old = document.getElementById("hxSheet"); if (old) old.remove();
    const w = document.createElement("div"); w.id = "hxSheet";
    w.innerHTML = `<div class="cx-scrim" style="position:fixed;inset:0;background:rgba(8,14,30,.45);z-index:9998"></div><div class="cx-sheet" role="dialog" aria-label="How to read this" style="position:fixed;left:0;right:0;bottom:0;max-height:88vh;overflow:auto;background:var(--panel);border-radius:28px 28px 0 0;padding:10px 20px calc(22px + env(safe-area-inset-bottom));z-index:9999;max-width:560px;margin:0 auto;color:var(--text)">
      <div style="width:40px;height:5px;border-radius:3px;background:var(--panel2);margin:0 auto 14px"></div><h3 style="font-size:19px;font-weight:750;margin:0 0 12px">How to read this</h3><div class="hx-ex">
      <p><b>Reached</b> is how many different people saw your ads.</p><p><b>Clicked</b> is how many tapped the link in your ad.</p>
      <p><b>Opened page</b> is how many of those actually saw your page load. The rest left before it opened.</p><p><b>Ordered</b> is the orders you recorded in this period.</p>
      <p>The percentage between two steps is how many of the step above carried on. A small number at the bottom means people see your page but do not buy.</p></div>
      <button type="button" class="hx-cta" onclick="document.getElementById('hxSheet').remove()">Got it</button></div>`;
    w.querySelector(".cx-scrim").onclick = () => w.remove();
    document.body.appendChild(w);
  };
  window.hxJourney = function () { if (typeof window.jnOpen === "function") window.jnOpen(); else bvGoToTab("journeys"); };

  window.renderOverview = async function (el) {
    try { await hx(el); } catch (e) { console.error("home", e); await oldRender(el); }
  };
})();
