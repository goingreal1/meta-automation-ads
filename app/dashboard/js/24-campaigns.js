// Revora dashboard, part 24 of 25: CAMPAIGNS (rebuilt, Ads Manager layout). The list on the left nests campaign > ad sets > ads (copies are their own rows);
// the details of whatever is selected show on the right. It runs on the same live-from-Meta data and the same actions as before
// (am.data from ads-manager "list", amSwitch / amSetStatus / amBulk / amOpenMsgEdit / amPreviewAd, the New campaign and Drafts flows).

const CP = { sel: null, open: new Set(), tab: "overview", mDetail: false, selectMode: false };
const cpL = { campaigns: "campaign", adsets: "adset", ads: "ad" };
const cpAlive = (r) => !["DELETED", "ARCHIVED"].includes(r.effective_status);
// Meta names a duplicate "<name> – Copy" (and "– Copy 2"); that is the only signal we have, so it is only used as a label.
const cpCopy = (n) => { const m = String(n || "").match(/[–—-]\s*copy(?:\s*(\d+))?\s*$/i); return m ? (m[1] ? "COPY " + m[1] : "COPY") : ""; };
const cpName = (n) => String(n || "").replace(/\s*[–—-]\s*copy(?:\s*\d+)?\s*$/i, "") || String(n || "");
const cpDot = (r) => { const c = amStatusWord(r.effective_status || r.status)[1]; return c === "active" ? "" : (c === "paused" || c === "off") ? "p" : c === "rejected" ? "b" : "w"; };
const cpPillClass = (c) => ({ active: "ok", paused: "", off: "", pending: "warn", watch: "warn", rejected: "bad" }[c] ?? "");
const cpMoney = (n) => "₦" + ovShort(n || 0);

function cpGroups() {
  const d = am.data, q = (am.q || "").toLowerCase().trim();
  const camps = d.campaigns.filter(cpAlive), sets = d.adsets.filter(cpAlive), ads = d.ads.filter(cpAlive);
  const hit = (r) => !q || String(r.name || "").toLowerCase().includes(q);
  const campIds = new Set(camps.map((c) => c.id)), byCamp = new Map(), bySet = new Map();
  sets.forEach((s) => { const k = campIds.has(s.campaign_id) ? s.campaign_id : "__none"; if (!byCamp.has(k)) byCamp.set(k, []); byCamp.get(k).push(s); });
  ads.forEach((a) => { if (!bySet.has(a.adset_id)) bySet.set(a.adset_id, []); bySet.get(a.adset_id).push(a); });
  const order = (a, b) => (b.status === "ACTIVE") - (a.status === "ACTIVE") || (b.spend || 0) - (a.spend || 0);
  let groups = camps.map((c) => ({ c, sets: (byCamp.get(c.id) || []).sort(order) })).sort((x, y) => order(x.c, y.c));
  const loose = byCamp.get("__none") || [];
  if (loose.length) groups.push({ c: { id: "__none", name: "Ad sets without a campaign", status: "PAUSED", effective_status: "PAUSED", spend: loose.reduce((t, s) => t + (s.spend || 0), 0), __none: true }, sets: loose.sort(order) });
  if (q) {
    groups = groups.map((g) => {
      const campHit = hit(g.c);
      const keep = g.sets.map((s) => { const kids = bySet.get(s.id) || [], setHit = hit(s), adHits = kids.filter(hit); return { s, show: campHit || setHit || adHits.length, ads: setHit || campHit ? kids : adHits }; }).filter((x) => x.show);
      return { c: g.c, sets: keep.map((x) => x.s), adsOf: new Map(keep.map((x) => [x.s.id, x.ads])), keep: campHit || keep.length };
    }).filter((g) => g.keep);
  }
  return { groups, bySet, q };
}

function cpRow(l, r, o) {
  const on = CP.sel && CP.sel.id === r.id, tag = cpCopy(r.name), ck = CP.selectMode && l === "campaigns" && !r.__none;
  const lead = l === "ads" ? `<div class="rv-th">${r.thumbnail_url ? `<img src="${escH(r.thumbnail_url)}" alt="" loading="lazy">` : ""}</div>` : `<i class="rv-dot ${cpDot(r)}"></i>`;
  return `<div class="rv-tr ${on ? "on" : ""} ${o.open ? "open" : ""}" onclick="cpSelect('${l}','${r.id}')">
    ${l === "ads" ? "" : `<span class="ch" onclick="cpToggle(event,'${r.id}')">${o.kids ? rvIc("chev") : ""}</span>`}
    ${ck ? `<input type="checkbox" class="rv-ck" ${am.sel.campaigns.has(r.id) ? "checked" : ""} onclick="event.stopPropagation()" onchange="amToggleSel('campaigns','${r.id}',this.checked)" aria-label="Select">` : ""}
    ${lead}<div class="nm"><b>${escH(tag ? cpName(r.name) : r.name)}${tag ? ` <span class="rv-cp2">${tag}</span>` : ""}</b><small>${o.sub}</small></div><span class="sp3">${cpMoney(r.spend)}</span></div>`;
}

function cpTreeHtml() {
  const { groups, bySet, q } = cpGroups();
  if (!groups.length) return `<div class="rv-empty" style="padding:20px 14px">${q ? "Nothing matches your search." : am.filter === "live" ? "No live campaigns. Switch to Paused or All to see the rest." : "No campaigns here yet."}</div>`;
  const adsOf = (g, s) => (g.adsOf ? g.adsOf.get(s.id) : bySet.get(s.id)) || [];
  return groups.map((g) => {
    const c = g.c, open = q ? true : CP.open.has(c.id), nAds = g.sets.reduce((t, s) => t + adsOf(g, s).length, 0);
    const warn = g.sets.some((s) => adsOf(g, s).some((a) => a.status === "ACTIVE" && a.suggestion?.kill));
    const sub = `${g.sets.length} ad set${g.sets.length === 1 ? "" : "s"} · ${nAds} ad${nAds === 1 ? "" : "s"}${warn ? " · over a kill rule" : ""}${!c.__none && c.effective_status !== "ACTIVE" ? " · " + escH(amStatusWord(c.effective_status || c.status)[0]) : ""}`;
    return `<div class="rv-tr1">${cpRow("campaigns", c, { open, kids: g.sets.length, sub })}${open ? `<div class="rv-l2">${g.sets.map((s) => {
      const kids = adsOf(g, s), so = q ? true : CP.open.has(s.id);
      const ssub = `${kids.length} ad${kids.length === 1 ? "" : "s"}${s.daily_budget ? " · " + fN(s.daily_budget) + " a day" : ""}${s.effective_status !== "ACTIVE" ? " · " + escH(amStatusWord(s.effective_status || s.status)[0]) : ""}`;
      return cpRow("adsets", s, { open: so, kids: kids.length, sub: ssub }) + (so ? `<div class="rv-l3">${kids.map((a) => cpRow("ads", a, { sub: escH(a.effective_status !== "ACTIVE" ? amStatusWord(a.effective_status || a.status)[0] : (a.kind === "purchase" ? "Website ad" : a.kind === "messaging" ? "WhatsApp ad" : "Ad")) })).join("")}</div>` : "");
    }).join("")}</div>` : ""}</div>`;
  }).join("");
}

// ---- details on the right ----
function cpFindSel() {
  const s = CP.sel, d = am.data; if (!s || !d) return null;
  if (s.l === "campaigns" && s.id === "__none") {
    const sets = d.adsets.filter((x) => cpAlive(x) && !d.campaigns.some((c) => c.id === x.campaign_id)), t = amTotals(sets);
    return { r: { id: "__none", name: "Ad sets without a campaign", effective_status: "PAUSED", status: "PAUSED", __none: true, spend: t.spend, results: t.label ? t.results : null, result_label: t.label || "Results", cost_per_result: t.cpr, impressions: t.imp, clicks: t.clk, ctr: t.imp ? t.clk / t.imp * 100 : 0, landing_page_views: t.hasWeb ? t.lpv : null, cost_per_landing_page_view: t.cpl, kind: t.hasWeb ? "purchase" : "messaging" }, kids: sets, kind: "adsets", sets, ads: d.ads.filter((a) => sets.some((x) => x.id === a.adset_id)) };
  }
  const r = (s.l === "campaigns" ? d.campaigns : s.l === "adsets" ? d.adsets : d.ads).find((x) => x.id === s.id); if (!r) return null;
  const sets = s.l === "campaigns" ? d.adsets.filter((x) => x.campaign_id === r.id && cpAlive(x)) : [];
  const ads = s.l === "campaigns" ? d.ads.filter((a) => a.campaign_id === r.id && cpAlive(a)) : s.l === "adsets" ? d.ads.filter((a) => a.adset_id === r.id && cpAlive(a)) : [];
  return { r, sets, ads, kids: s.l === "campaigns" ? sets : ads, kind: s.l === "campaigns" ? "adsets" : "ads" };
}
function cpMetrics(r) {
  const n = (v) => Number(v || 0), clk = n(r.clicks), imp = n(r.impressions);
  const cpc = clk > 0 ? n(r.spend) / clk : null, rate = clk > 0 && r.landing_page_views != null ? Math.min(100, n(r.landing_page_views) / clk * 100) : null;
  const web = r.kind === "purchase" || (r.landing_page_views > 0);
  const tiles = [
    ["Spend", fN(r.spend)], [r.result_label || "Results", r.results == null ? "—" : ovNum(r.results)], [amCostLabel(r.kind), r.cost_per_result != null ? fN(r.cost_per_result) : "—"],
    ["Impressions", ovShort(imp)], ["Reach", r.reach ? ovShort(r.reach) : "—"], ["Frequency", r.reach ? Number(r.frequency).toFixed(2) + "×" : "—"], ["CPM", r.cpm ? fN2(r.cpm) : "—"],
    ["Link clicks", ovNum(clk)], ["CTR (link)", imp ? Number(r.ctr).toFixed(2) + "%" : "—"], ["CPC (link)", cpc != null ? fN2(cpc) : "—"],
    ["Page views", web ? ovNum(r.landing_page_views) : "—", 1], ["Cost / page view", web && r.cost_per_landing_page_view != null ? fN2(r.cost_per_landing_page_view) : "—", 1], ["Page view rate", web && rate != null ? rate.toFixed(1) + "%" : "—", 1],
    ["Messages started", r.conversations != null ? ovNum(r.conversations) : "—"], ["Purchases", r.purchases != null ? ovNum(r.purchases) : "—"],
  ];
  return tiles.filter((t, i) => i < 3 || !((t[0] === "Messages started" && r.result_label === "Conversations") || (t[0] === "Purchases" && r.result_label === "Purchases"))); // the 2nd and 3rd tiles are the main result; do not repeat it later
}
function cpStatusPill(r) {
  const sd = amScheduled(r);
  if (sd) return `<span class="rv-pill br">Scheduled</span><span class="rv-mut3">Starts ${escH(sd.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }))}</span>`;
  const [label, cls] = amStatusWord(r.effective_status || r.status);
  return `<span class="rv-pill ${cpPillClass(cls)}">${escH(label)}</span>`;
}
function cpMetaUrl(l, id) {
  const a = (accountsList || []).find((x) => x.id === activeAccountId), act = String(a?.meta_ad_account_id || "").replace(/^act_/, "");
  const key = { campaigns: "campaigns", adsets: "adsets", ads: "ads" }[l], sel = { campaigns: "selected_campaign_ids", adsets: "selected_adset_ids", ads: "selected_ad_ids" }[l];
  return `https://adsmanager.facebook.com/adsmanager/manage/${key}?act=${encodeURIComponent(act)}${id && id !== "__none" ? `&${sel}=${encodeURIComponent(id)}` : ""}`;
}

function cpChildTable(f, l) {
  const rows = f.kids; if (!rows.length) return `<div class="rv-empty" style="padding:14px 20px">${l === "campaigns" ? "No ad sets in this campaign." : "No ads in this ad set."}</div>`;
  const nl = l === "campaigns" ? "adsets" : "ads", web = rows.some((r) => r.kind === "purchase");
  return `<div style="padding:0 8px;overflow:auto"><table class="rv-tbl rv-at"><thead><tr><th>${l === "campaigns" ? "Ad set" : "Ad"}</th><th>Status</th><th class="num">Spend</th><th class="num">Results</th><th class="num">Cost / result</th><th class="num">Link clicks</th><th class="num">CTR</th>${web ? `<th class="num">Page views</th><th class="num">Cost / page view</th>` : ""}</tr></thead><tbody>${rows.map((r) => `<tr class="rv-click" onclick="cpSelect('${nl}','${r.id}')"><td><div class="rv-cell">${nl === "ads" ? `<div class="rv-th">${r.thumbnail_url ? `<img src="${escH(r.thumbnail_url)}" alt="" loading="lazy">` : ""}</div>` : ""}<div><b>${escH(cpCopy(r.name) ? cpName(r.name) : r.name)}</b>${cpCopy(r.name) ? ` <span class="rv-cp2">${cpCopy(r.name)}</span>` : ""}</div></div></td><td>${cpStatusPill(r)}</td><td class="num">${fN(r.spend)}</td><td class="num">${r.results == null ? "—" : ovNum(r.results)}</td><td class="num">${r.cost_per_result != null ? fN(r.cost_per_result) : "—"}</td><td class="num">${ovNum(r.clicks)}</td><td class="num">${r.impressions ? Number(r.ctr).toFixed(2) + "%" : "—"}</td>${web ? `<td class="num">${r.kind === "purchase" ? ovNum(r.landing_page_views) : "—"}</td><td class="num">${r.kind === "purchase" && r.cost_per_landing_page_view != null ? fN2(r.cost_per_landing_page_view) : "—"}</td>` : ""}</tr>`).join("")}</tbody></table></div>`;
}

function cpDetailHtml() {
  const f = cpFindSel(), d = am.data;
  if (!f) return `<div class="rv-empty" style="padding:40px 20px;justify-content:center">Pick a campaign, ad set or ad on the left to see its numbers.</div>`;
  const { r } = f, l = CP.sel.l, lvl = cpL[l], real = !r.__none;
  const camp = l === "campaigns" ? null : d.campaigns.find((c) => c.id === (r.campaign_id)), set = l === "ads" ? d.adsets.find((s) => s.id === r.adset_id) : null;
  const crumb = [camp && camp.name, set && set.name].filter(Boolean).map(escH).join("  ›  ");
  const on = r.status === "ACTIVE", busy = am.busy.has(r.id);
  const flagged = l === "ads" ? (r.suggestion?.kill && on ? [r] : []) : f.ads.filter((a) => a.status === "ACTIVE" && a.suggestion?.kill);
  const kidsLabel = l === "campaigns" ? "Ad sets" : "Ads";
  const tabs = [["overview", "Overview"], ...(l !== "ads" ? [["kids", kidsLabel + " (" + f.kids.length + ")"]] : []), ["settings", "Settings"]];
  if (!tabs.some((t) => t[0] === CP.tab)) CP.tab = "overview";
  const m = cpMetrics(r);
  const rules = l === "ads" && r.suggestion
    ? `<div class="rv-rules">${r.suggestion.kill && on ? `<div class="rv-rule bad">${rvIc("alert")}<span>${escH(r.suggestion.reason)}</span><button type="button" class="rv-btn s" onclick="amSetStatus('ad','${r.id}','PAUSED','kill rule suggestion')">Pause this ad</button></div>` : `<div class="rv-rule">${rvIc("check")}<span>Within your kill rules</span></div>`}</div>`
    : (flagged.length ? `<div class="rv-rules">${flagged.slice(0, 4).map((a) => `<div class="rv-rule bad">${rvIc("alert")}<span><b>${escH(a.name)}</b>: ${escH(a.suggestion.reason)}</span><button type="button" class="rv-btn s" onclick="amSetStatus('ad','${a.id}','PAUSED','kill rule suggestion')">Pause this ad</button></div>`).join("")}</div>` : "");
  const kindWord = r.kind === "purchase" ? "Website purchases" : r.kind === "messaging" ? "WhatsApp messages" : "Other";
  const started = r.start_time ? new Date(r.start_time) : (r.created_time ? new Date(r.created_time) : null);
  const settings = `<div class="rv-set"><div><div class="l">Budget</div><div class="v">${r.daily_budget ? fN(r.daily_budget) + " a day" : l === "campaigns" ? "Set on each ad set" : "Set on the ad set"}</div></div>
    <div><div class="l">Goal</div><div class="v">${kindWord}</div></div><div><div class="l">${r.start_time ? "Starts" : "Created"}</div><div class="v">${started ? escH(started.toLocaleString("en-NG", { dateStyle: "medium" })) : "—"}</div></div>
    ${l === "ads" && r.wa_prefill != null ? `<div class="full"><div class="l">WhatsApp message people send</div><div class="v">${escH(r.wa_prefill || "—")} <a class="rv-lnk" onclick="amOpenMsgEdit('${r.id}')">Edit</a></div></div>` : ""}</div>`;
  const body = CP.tab === "kids" ? cpChildTable(f, l) : CP.tab === "settings" ? settings : `<div class="rv-mg">${m.map((x) => `<div class="${x[2] ? "hi" : ""}"><div class="l">${escH(x[0])}</div><div class="v">${x[1]}</div></div>`).join("")}</div>${rules}
    ${l === "ads" ? `<div style="padding:16px 20px 0" class="rv-row"><button type="button" class="rv-btn s" onclick="amPreviewAd('${r.id}')">Preview</button>${r.picture_url ? `<button type="button" class="rv-btn s" onclick="amFitImage('${r.id}')" data-hint="Re-fit the whole image so Meta does not crop it">Fit image</button>` : ""}</div>` : `<div class="rv-ct" style="padding:20px 20px 4px;margin:0"><h3>${kidsLabel}</h3></div>${cpChildTable(f, l)}`}`;
  return `<div style="padding:18px 20px 14px"><div class="rv-back" onclick="cpBack()">${rvIc("chev")}Back</div>${crumb ? `<div class="rv-crumb">${crumb}</div>` : ""}
    <div class="rv-row rv-hdr"><div style="min-width:0"><h2>${escH(cpCopy(r.name) ? cpName(r.name) : r.name)}${cpCopy(r.name) ? ` <span class="rv-cp2">${cpCopy(r.name)}</span>` : ""}</h2><div class="rv-row" style="margin-top:8px;flex-wrap:wrap">${busy ? '<span class="spin"></span>' : cpStatusPill(r)}${r.daily_budget ? `<span class="rv-mut3">${fN(r.daily_budget)} a day</span>` : ""}</div></div><div class="rv-sp"></div>
    ${real ? `<div class="rv-act">${l !== "ads" || true ? `<label class="switch am-sw" title="${on ? "Pause on Meta" : "Turn on in Meta"}"><input type="checkbox" ${on ? "checked" : ""} ${busy ? "disabled" : ""} onchange="amSwitch('${lvl}','${r.id}',this)"><span class="sw-track"></span></label>` : ""}
      <button type="button" class="rv-btn s" onclick="cpDuplicate('${l}','${r.id}')">Duplicate</button>
      ${l === "ads" ? `<button type="button" class="rv-btn s" onclick="amOpenMsgEdit('${r.id}')">Edit message</button>` : `<button type="button" class="rv-btn s" onclick="cpEditBudget('${l}','${r.id}')">Edit budget</button>`}
      <a class="rv-btn s" href="${escH(cpMetaUrl(l, r.id))}" target="_blank" rel="noopener">Open on Meta</a></div>` : ""}</div></div>
    <div class="rv-tabs">${tabs.map((t) => `<a class="${CP.tab === t[0] ? "on" : ""}" onclick="cpTab('${t[0]}')">${t[1]}</a>`).join("")}</div><div style="padding-top:18px">${body}</div>`;
}

// ---- actions ----
function cpSelect(l, id) {
  CP.sel = { l, id }; CP.tab = "overview"; CP.mDetail = true;
  const d = am.data;
  if (l === "adsets") { const s = d.adsets.find((x) => x.id === id); if (s) CP.open.add(s.campaign_id); }
  if (l === "ads") { const a = d.ads.find((x) => x.id === id); if (a) { CP.open.add(a.adset_id); CP.open.add(a.campaign_id); } }
  if (l !== "ads") CP.open.add(id);
  amDraw();
  if (mobileMq.matches) window.scrollTo({ top: 0 });
}
function cpToggle(e, id) { e.stopPropagation(); if (CP.open.has(id)) CP.open.delete(id); else CP.open.add(id); const tl = document.getElementById("cpTreeList"); if (tl) tl.innerHTML = cpTreeHtml(); }
function cpTab(t) { CP.tab = t; const dt = document.getElementById("cpDetail"); if (dt) dt.innerHTML = cpDetailHtml(); }
function cpBack() { CP.mDetail = false; amDraw(); }
function cpQuery(v) { am.q = v; const tl = document.getElementById("cpTreeList"); if (tl) tl.innerHTML = cpTreeHtml(); }
function cpSelectMode(on) { CP.selectMode = on; if (!on) am.sel = { campaigns: new Set(), adsets: new Set() }; amDraw(); }

function cpEditBudget(l, id) {
  const f = cpFindSel(); if (!f) return; const r = f.r;
  if (l === "campaigns" && !r.daily_budget) { bvToast("This campaign's budget is set on each ad set. Open an ad set to change it.", "err"); return; }
  bvModal("Edit daily budget", `<div style="font-size:13px;color:var(--text2);margin-bottom:12px"><b>${escH(r.name)}</b><br>The new amount is sent to Meta right away.</div>
    <div class="field"><label>Daily budget (₦)</label><input type="number" id="cpBudget" min="0" step="100" value="${Math.round(r.daily_budget || 0)}"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn btn-g" onclick="bvCloseModal()">Cancel</button><button class="btn btn-a" onclick="cpSaveBudget('${l}','${id}')">Save on Meta</button></div>`);
}
async function cpSaveBudget(l, id) {
  const v = Number(document.getElementById("cpBudget")?.value); if (!(v > 0)) { bvToast("Enter an amount above 0.", "err"); return; }
  bvCloseModal();
  const res = await amCall({ action: "set_budget", ad_account_id: activeAccountId, level: l === "campaigns" ? "campaign" : "adset", object_id: id, daily_budget: v, reason: "Edited in the dashboard" });
  if (res && res.ok) { const r = amFind(cpL[l], id); if (r) r.daily_budget = v; bvToast("Budget updated on Meta."); amDraw(); amQuietRefresh(); } else bvToast(res?.error || "Meta did not accept that change.", "err");
}
function cpDuplicate(l, id) {
  const f = cpFindSel(); if (!f) return;
  bvModal("Duplicate " + (cpL[l] === "adset" ? "ad set" : cpL[l]), `<div style="font-size:13px;color:var(--text2);margin-bottom:12px"><b>${escH(f.r.name)}</b><br>A copy is made on Meta, with everything inside it.</div>
    <label class="rv-opt"><input type="radio" name="cpDup" value="paused" checked> <span><b>Start paused</b><small>Safe. Nothing spends until you turn it on.</small></span></label>
    <label class="rv-opt"><input type="radio" name="cpDup" value="live"> <span><b>Start live</b><small>The copy begins delivering right away.</small></span></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn btn-g" onclick="bvCloseModal()">Cancel</button><button class="btn btn-a" id="cpDupGo" onclick="cpDoDuplicate('${l}','${id}')">Duplicate</button></div>`);
}
async function cpDoDuplicate(l, id) {
  const f = cpFindSel(), live = document.querySelector('input[name="cpDup"]:checked')?.value === "live", b = document.getElementById("cpDupGo");
  if (b) { b.disabled = true; b.textContent = "Duplicating…"; }
  const res = await sbFn("ai-chat", { action: "duplicate", ad_account_id: activeAccountId, level: cpL[l], object_id: id, object_name: f?.r?.name || "", start_paused: !live }).catch((e) => ({ error: e.message }));
  bvCloseModal();
  if (res && res.ok) { bvToast("Duplicated on Meta" + (live ? "." : " (paused).")); amFetch(); } else bvToast(res?.error || "Meta did not accept the copy.", "err");
}


// ---- phone: the flat list (campaigns / ad sets / ads tabs, on-off switch, key numbers on every row). Tapping a row opens the details. ----
CP.mlevel = "campaigns";
function cpMLevel(l) { CP.mlevel = l; amDraw(); }
function cpMRow(level, r) {
  const d = am.data, on = r.status === "ACTIVE", busy = am.busy.has(r.id);
  let sub = "";
  if (level === "adsets") sub = d.campaigns.find((c) => c.id === r.campaign_id)?.name || "";
  if (level === "ads") sub = d.adsets.find((x) => x.id === r.adset_id)?.name || "";
  if (level !== "ads" && r.daily_budget) sub += (sub ? " · " : "") + fN(r.daily_budget) + "/day";
  const flag = level === "ads" && on && r.suggestion?.kill;
  const thumb = level === "ads" && r.thumbnail_url ? `<img class="cp-mth" src="${escH(r.thumbnail_url)}" alt="" loading="lazy">` : "";
  const cl = r.kind === "messaging" ? "Per chat" : r.kind === "purchase" ? "Per purchase" : "Per result";
  return `<div class="cp-mr${on ? "" : " off"}${flag ? " flag" : ""}" onclick="cpSelect('${level}','${r.id}')">
    <div class="cp-mt"><label class="switch" onclick="event.stopPropagation()"><input type="checkbox" ${on ? "checked" : ""} ${busy ? "disabled" : ""} onchange="amSwitch('${AM_SINGULAR[level]}','${r.id}',this)" aria-label="${on ? "Pause" : "Turn on"}"><span class="sw-track"></span></label>
      ${thumb}<div class="cp-mn"><b>${escH(r.name)}</b>${sub ? `<small>${escH(sub)}</small>` : ""}<div class="cp-md">${busy ? '<span class="spin"></span>' : amDelivery(r)}</div></div></div>
    <div class="cp-mm"><div><small>${escH(r.result_label || "Results")}</small><b>${r.results != null ? r.results : "—"}</b></div><div><small>${cl}</small><b>${r.cost_per_result != null ? fN(r.cost_per_result) : "—"}</b></div><div><small>Spent</small><b>${fN(r.spend)}</b></div></div>
    ${flag ? `<div class="cp-mf" onclick="event.stopPropagation()">${rvIc("alert")}<span>${escH(r.suggestion.reason)}</span><button type="button" class="rv-btn s" onclick="amSetStatus('ad','${r.id}','PAUSED','kill rule suggestion')">Pause</button></div>` : ""}</div>`;
}
function cpMobileHtml() {
  const lvl = CP.mlevel, counts = { campaigns: amRows("campaigns").length, adsets: amRows("adsets").length, ads: amRows("ads").length };
  const rows = amRows(lvl), tot = amTotals(rows), word = lvl === "campaigns" ? "campaign" : lvl === "adsets" ? "ad set" : "ad";
  return `<div class="tb"><div class="rv-fld">${rvIc("search")}<input type="search" placeholder="Search" value="${escH(am.q || "")}" oninput="cpQuery(this.value)" aria-label="Search"></div>
    <div class="rv-seg rv-w100">${[["campaigns", "Campaigns"], ["adsets", "Ad sets"], ["ads", "Ads"]].map(([k, l]) => `<button type="button" class="${lvl === k ? "on" : ""}" onclick="cpMLevel('${k}')">${l}<em>${counts[k]}</em></button>`).join("")}</div>
    <div class="rv-seg rv-w100" style="margin-top:8px">${[["live", "Live"], ["paused", "Paused"], ["all", "All"]].map(([k, l]) => `<button type="button" class="${am.filter === k ? "on" : ""}" onclick="amSetFilter('${k}')">${l}</button>`).join("")}</div></div>
    ${rows.length ? rows.map((r) => cpMRow(lvl, r)).join("") + `<div class="cp-mtot"><b>Total · ${rows.length} ${word}${rows.length === 1 ? "" : "s"}</b><span>${fN(tot.spend)} spent${tot.label ? ` · ${tot.results.toLocaleString("en-NG")} ${tot.label.toLowerCase()}` : ""}</span></div>` : `<div class="rv-empty" style="padding:20px 14px">${am.q ? "Nothing matches your search." : "Nothing here for this filter."}</div>`}`;
}

// ---- the whole screen ----
function amDraw() {
  const root = amEl(); if (!root) return;
  root.classList.add("rv-ui");
  const d = am.data;
  const SEG = [["today", "Today"], ["last7", "7 days"], ["last30", "30 days"]], more = AM_RANGES.filter(([k]) => !SEG.some((x) => x[0] === k));
  const head = `<div class="rv-head rv-head2"><div><h1>Campaigns</h1></div><div class="rv-sp"></div>
    <button type="button" class="rv-btn rv-hm" onclick="bvOpenDraftsModal()">Drafts</button>
    <button type="button" class="rv-btn" id="amRefresh" onclick="amFetch()" ${am.loading ? "disabled" : ""} aria-label="Refresh">${am.loading ? '<span class="spin"></span>' : rvIc("refresh")}</button>
    <button type="button" class="rv-btn p" onclick="bvOpenObjectiveGateModal()">${rvIc("plus")}New campaign</button></div>`;
  const tools = `<div class="cp-tools"><div class="rv-seg">${SEG.map(([k, l]) => `<button type="button" class="${am.range === k ? "on" : ""}" onclick="amSetRange('${k}')">${l}</button>`).join("")}</div>
    <select class="rv-sel" onchange="amSetRange(this.value)" aria-label="More date ranges"><option value="">More…</option>${more.map(([k, l]) => `<option value="${k}" ${am.range === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>`;
  if (am.error && !d) { root.innerHTML = head + `<div class="rv-note">${rvIc("alert")}<span>${escH(am.error)}</span><button type="button" class="rv-btn s" style="margin-left:auto" onclick="amFetch()">Try again</button></div>`; return; }
  if (!d) { root.innerHTML = head + tools + `<div class="rv-note"><span class="spin"></span><span>Loading live numbers from Meta…</span></div>`; return; }

  // keep a valid selection
  if (CP.sel && !cpFindSel()) CP.sel = null;
  if (!CP.sel) { const first = d.campaigns.filter(cpAlive)[0]; if (first) { CP.sel = { l: "campaigns", id: first.id }; CP.open.add(first.id); } }
  const tl0 = document.getElementById("cpTreeList"), st = tl0 ? tl0.scrollTop : 0;
  const flaggedAds = d.ads.filter((a) => a.status === "ACTIVE" && a.suggestion?.kill);
  const b = am.balKey === activeAccountId ? am.bal : null;
  const T0 = amTotals(d.campaigns.filter(cpAlive));
  const nCamp0 = d.campaigns.filter(cpAlive).length;
  const bal = (() => { const dys = { today: 1, last3: 3, last7: 7, last30: 30 }[am.range]; const synced = am.at ? "Live from Meta · updated " + ago(new Date(am.at).toISOString()) : "Live from Meta";
    return rvAdWalletCard(b || { loading: true, name: d.account?.name || "Ad account" }, { hero: true, daily: dys && T0.spend > 0 ? T0.spend / dys : null, isAdmin: window.myProfile?.role === "owner" || window.myProfile?.role === "admin",
      stats: [[nCamp0, nCamp0 === 1 ? "campaign" : "campaigns"], [d.adsets.filter(cpAlive).length, "ad sets"], [d.ads.filter(cpAlive).length, "ads"]], foot: synced }); })();
  const nCamp = d.campaigns.filter(cpAlive).length;
  const T = amTotals(d.campaigns.filter(cpAlive)), liveAds = d.ads.filter((a) => a.status === "ACTIVE" && a.effective_status === "ACTIVE" && !amScheduled(a)).length;
  const rangeLbl = (AM_RANGES.find((x) => x[0] === am.range) || [])[1] || "";
  const tile = (l, v, sub) => `<div><div class="l">${l}</div><div class="v">${v}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  const summary = `<div class="rv-card rv-sum">${[
    tile("Spent", fN(T.spend), escH(rangeLbl)),
    tile(escH(T.label || "Results"), ovNum(T.results), T.label === "Conversations" ? "WhatsApp chats started" : ""),
    tile("Cost per " + (T.label === "Purchases" ? "purchase" : "conversation"), T.cpr != null ? fN(T.cpr) : "—", ""),
    tile("Ads delivering", `${liveAds} <span class="of">of ${d.ads.filter(cpAlive).length}</span>`, ""),
    ...(T.hasWeb ? [tile("Page views", ovNum(T.lpv), "website ads"), tile("Cost / page view", T.cpl != null ? fN2(T.cpl) : "—", "website spend ÷ page views"), tile("Page view rate", T.lpvRate != null ? T.lpvRate.toFixed(0) + "%" : "—", "page views ÷ link clicks")] : []),
  ].join("")}</div>`;
  root.innerHTML = head + bal + tools + summary + (flaggedAds.length ? `<div class="rv-note warn">${rvIc("alert")}<span><b>${flaggedAds.length} ad${flaggedAds.length === 1 ? "" : "s"}</b> ${flaggedAds.length === 1 ? "breaks" : "break"} your kill rule.</span><button type="button" class="rv-btn s" style="margin-left:auto" onclick="cpSelect('ads','${flaggedAds[0].id}')">Review</button></div>` : "") + `
    <div class="rv-split ${CP.mDetail ? "m-detail" : ""}">
      <section class="rv-card rv-mlist">${cpMobileHtml()}</section>
      <section class="rv-card rv-tree"><div class="tb"><div class="rv-fld">${rvIc("search")}<input type="search" placeholder="Search campaigns, ad sets, ads" value="${escH(am.q || "")}" oninput="cpQuery(this.value)" aria-label="Search"></div>
        <div class="rv-seg rv-w100">${[["live", "Live"], ["paused", "Paused"], ["all", "All"]].map(([k, l]) => `<button type="button" class="${am.filter === k ? "on" : ""}" onclick="amSetFilter('${k}')">${l}${am.filter === k ? `<em>${nCamp}</em>` : ""}</button>`).join("")}</div>
        <div class="rv-row" style="margin-top:10px">${CP.selectMode ? `<b style="font-size:13px">${am.sel.campaigns.size} selected</b><div class="rv-sp"></div><button type="button" class="rv-btn s" ${am.sel.campaigns.size ? "" : "disabled"} onclick="amBulk('PAUSED')">Pause</button><button type="button" class="rv-btn s" ${am.sel.campaigns.size ? "" : "disabled"} onclick="amBulk('ACTIVE')">Turn on</button><button type="button" class="rv-btn s" onclick="cpSelectMode(false)">Done</button>` : `<span class="rv-mut3" style="font-size:12.5px">${nCamp} campaign${nCamp === 1 ? "" : "s"}</span><div class="rv-sp"></div><button type="button" class="rv-lnk" onclick="cpSelectMode(true)">Select several</button>`}</div></div>
        <div class="rv-tl" id="cpTreeList">${cpTreeHtml()}</div></section>
      <section class="rv-card rv-dt" id="cpDetail">${cpDetailHtml()}</section>
    </div>`;
  const tl = document.getElementById("cpTreeList"); if (tl && st) tl.scrollTop = st;
}
