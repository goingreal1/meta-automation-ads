// ── Campaigns, light and clear. One card per campaign / ad set / ad with the key numbers as pills; the detail screens always say which level you are on.
// Runs on the same live-from-Meta data and actions as before (am.data, amSwitch, amSetStatus, cpDuplicate, cpEditBudget, amOpenMsgEdit, amPreviewAd).
// Replaces: cpMobileHtml (phone list) and cpDetailHtml (details). The desktop tables are untouched.
(function () {
  if (window.__cxInstalled) return; window.__cxInstalled = true;

  const css = `
  .cx{padding:0 0 8px;color:var(--text)}
  .cx button{font-family:inherit}
  .cx-bar{display:flex;flex-direction:column;gap:10px;padding:2px 0 12px}
  .cx-seg{display:flex;background:var(--panel2);border-radius:14px;padding:3px}
  .cx-seg button{flex:1;min-height:40px;border:0;border-radius:11px;background:transparent;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer}
  .cx-seg button.on{background:var(--panel);color:var(--text);font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.14)}
  .cx-seg em{font-style:normal;font-weight:600;color:var(--muted);margin-left:5px;font-size:12px}
  .cx-tools{display:flex;gap:8px;align-items:center}
  .cx-search{flex:1;min-width:0;height:44px;border:1px solid var(--border);border-radius:22px;background:var(--panel);color:var(--text);padding:0 16px;font:inherit;font-size:14px}
  .cx-num{height:44px;padding:0 16px;border:0;border-radius:22px;background:var(--panel);color:var(--text);font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:7px;box-shadow:0 1px 2px rgba(15,30,70,.08),0 4px 14px rgba(15,30,70,.06);white-space:nowrap}
  .cx-num svg{width:16px;height:16px;stroke:#1f6fff;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
  .cx-card{background:var(--panel);border-radius:24px;padding:16px;margin:0 0 12px;box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06);cursor:pointer}
  .cx-card.off{opacity:.78}
  .cx-hd{display:flex;align-items:center;gap:10px}
  .cx-dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--muted)}
  .cx-dot.ok{background:#18a35a}.cx-dot.warn{background:#d98200}.cx-dot.bad{background:#e5484d}
  .cx-th{width:44px;height:44px;border-radius:12px;object-fit:cover;background:var(--panel2);flex:none}
  .cx-nm{flex:1;min-width:0}
  .cx-nm b{display:block;font-size:15px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cx-nm small{display:block;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
  .cx-big{margin-top:14px}
  .cx-big small{display:block;font-size:12px;color:var(--muted)}
  .cx-big b{display:block;font-size:28px;font-weight:750;letter-spacing:-.02em;line-height:1.12}
  .cx-pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)}
  .cx-pill{height:30px;padding:0 11px;border-radius:15px;background:var(--panel2);color:var(--muted);font-size:12px;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
  .cx-pill b{color:var(--text);font-weight:700}
  .cx-v{display:inline-flex;align-items:center;height:30px;padding:0 12px;border-radius:15px;font-size:12px;font-weight:700;margin-top:12px;background:var(--panel2);color:var(--text2)}
  .cx-v.ok{background:rgba(24,163,90,.14);color:#127a43}.cx-v.warn{background:rgba(217,130,0,.16);color:#8a5600}.cx-v.bad{background:rgba(229,72,77,.14);color:#b3262c}
  .cx-tot{text-align:center;font-size:13px;color:var(--muted);padding:6px 0 4px}
  .cx-empty{padding:28px 12px;text-align:center;color:var(--text2);font-size:15px}
  /* detail */
  .cx-detail{max-width:640px;margin:0 auto;padding:12px 0 24px}
  .cx-top{display:flex;align-items:center;gap:10px}
  .cx-back{width:44px;height:44px;border:0;border-radius:50%;background:var(--panel);color:var(--text);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 1px 2px rgba(15,30,70,.08),0 4px 14px rgba(15,30,70,.06);flex:none}
  .cx-back svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .cx-tag{display:inline-flex;align-items:center;height:24px;padding:0 10px;border-radius:12px;background:rgba(31,111,255,.14);color:#1f6fff;font-size:11px;font-weight:800;letter-spacing:.07em}
  .cx-title{font-size:20px;font-weight:750;line-height:1.2;overflow-wrap:anywhere;margin:2px 0 0}
  .cx-crumb{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;font-size:12px;color:var(--muted);margin:10px 4px 0}
  .cx-crumb a{color:#1f6fff;font-weight:650;cursor:pointer;text-decoration:none;min-height:24px;display:inline-flex;align-items:center}
  .cx-hero{margin-top:14px;padding:20px 18px;border-radius:26px;background:#0f2a66;color:#fff}
  .cx-hero small{display:block;font-size:13px;color:#b8c8ee;font-weight:600}
  .cx-hero .cx-hv{display:block;font-size:40px;font-weight:750;letter-spacing:-.03em;margin-top:2px}
  .cx-hero .cx-v{background:rgba(255,255,255,.14);color:#fff;margin-top:10px}
  .cx-hero .cx-v.ok{background:rgba(90,208,142,.2);color:#8be8b3}.cx-hero .cx-v.warn{background:rgba(240,176,74,.22);color:#ffd08a}.cx-hero .cx-v.bad{background:rgba(255,138,142,.22);color:#ffb0b3}
  .cx-hero .cx-pills{border-top:1px solid rgba(255,255,255,.16)}
  .cx-hero .cx-pill{background:rgba(255,255,255,.12);color:#b8c8ee}.cx-hero .cx-pill b{color:#fff}
  .cx-pic{margin-top:14px;border-radius:26px;overflow:hidden;background:var(--panel2);display:flex;align-items:center;justify-content:center;max-height:340px}
  .cx-pic img{width:100%;max-height:340px;object-fit:contain;display:block}
  .cx-acts{display:flex;justify-content:space-around;gap:8px;margin-top:16px}
  .cx-act{border:0;background:transparent;color:var(--text);padding:0;display:flex;flex-direction:column;align-items:center;gap:6px;min-height:44px;cursor:pointer;font-size:12px;font-weight:650;text-decoration:none}
  .cx-act i{width:52px;height:52px;border-radius:18px;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06);color:#1f6fff;display:flex;align-items:center;justify-content:center}
  .cx-act svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
  .cx-link{display:flex;align-items:center;gap:12px;width:100%;margin-top:16px;padding:14px 16px;border:0;border-radius:20px;background:rgba(31,111,255,.1);color:var(--text);text-align:left;cursor:pointer;font:inherit}
  .cx-link>i{width:40px;height:40px;border-radius:13px;background:#1f6fff;color:#fff;display:flex;align-items:center;justify-content:center;flex:none}
  .cx-link>i svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .cx-link span{flex:1;min-width:0}.cx-link b{display:block;font-weight:700}.cx-link small{display:block;font-size:12px;color:var(--muted)}
  .cx-sec{font-size:16px;font-weight:700;margin:22px 4px 10px}
  .cx-kid{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:20px;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06);margin-bottom:10px;cursor:pointer}
  .cx-kid .cx-nm small{margin-top:3px}
  .cx-kid .cx-kv{text-align:right;flex:none}.cx-kid .cx-kv b{display:block;font-size:16px;font-weight:750}.cx-kid .cx-kv small{font-size:11px;color:var(--muted)}
  .cx-info{background:var(--panel);border-radius:20px;padding:6px 16px;box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06)}
  .cx-info div{display:flex;justify-content:space-between;gap:14px;padding:12px 0;border-bottom:1px solid var(--border);font-size:14px}
  .cx-info div:last-child{border-bottom:0}.cx-info span{color:var(--muted)}.cx-info b{font-weight:650;text-align:right;overflow-wrap:anywhere}
  .cx-warn{display:flex;gap:10px;align-items:center;margin-top:14px;padding:12px 14px;border-radius:16px;background:rgba(229,72,77,.12);color:var(--text);font-size:13px}
  .cx-warn span{flex:1}.cx-warn button{height:40px;padding:0 14px;border:0;border-radius:12px;background:#e5484d;color:#fff;font-weight:700;cursor:pointer}
  /* numbers sheet */
  .cx-scrim{position:fixed;inset:0;background:rgba(8,14,30,.45);z-index:9998}
  .cx-sheet{position:fixed;left:0;right:0;bottom:0;max-height:88vh;overflow:auto;background:var(--panel);border-radius:28px 28px 0 0;padding:10px 18px calc(22px + env(safe-area-inset-bottom));z-index:9999;max-width:560px;margin:0 auto;color:var(--text)}
  .cx-grab{width:40px;height:5px;border-radius:3px;background:var(--panel2);margin:0 auto 14px}
  .cx-sheet h3{font-size:19px;font-weight:750;margin:0}
  .cx-sheet p{font-size:13px;color:var(--muted);margin:4px 0 0}
  .cx-gn{font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.05em;text-transform:uppercase;margin:16px 0 8px}
  .cx-chips{display:flex;flex-wrap:wrap;gap:8px}
  .cx-chip{height:40px;padding:0 14px;border-radius:20px;border:1.5px solid var(--border);background:transparent;color:var(--text);font-size:13px;font-weight:650;cursor:pointer}
  .cx-chip.on{background:#1f6fff;border-color:#1f6fff;color:#fff}
  .cx-foot{display:flex;gap:10px;margin-top:20px;position:sticky;bottom:0;background:var(--panel);padding-top:6px}
  .cx-foot button{height:50px;border:0;border-radius:16px;font-size:15px;font-weight:700;cursor:pointer}
  .cx-foot .g{padding:0 20px;background:var(--panel2);color:var(--text)}.cx-foot .p{flex:1;background:#1f6fff;color:#fff}
  @media (max-width:860px){.rv-ui:has(.cx-list) .awc.hero,.rv-ui:has(.cx-list) .rv-sum{display:none}}
  `;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  const ic = {
    back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
    tune: '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    chev: '<svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="m9 6 6 6-6 6"/></svg>',
    money: '<svg viewBox="0 0 24 24"><path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><path d="M9 9h11v11H9zM5 15H4V4h11v1"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    ext: '<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></svg>',
  };
  const esc = (s) => escH(String(s == null ? "" : s));
  const LEVEL = { campaigns: ["CAMPAIGN", "Campaign"], adsets: ["AD SET", "Ad set"], ads: ["AD", "Ad"] };

  // ---------- numbers ----------
  const KEY = "rv_cx_metrics_v1";
  const DEFAULTS = ["spend", "results", "lpv", "cplpv", "ctr", "cpp"];
  const CAT = () => [
    { g: "Money and results", k: "spend", label: "Spent", v: (r) => r.spend, f: (n) => fN(n) },
    { g: "Money and results", k: "results", label: "Results", v: (r) => r.results, f: (n) => ovNum(n) },
    ...CP_METRICS,
  ];
  const SHORT = { ctr: "CTR", lpv: "Page views", cplpv: "Per view", cpp: "Per purchase", cpmsg: "Per chat", msgs: "Chats", clicks: "Clicks", cpc: "Per click", impr: "Views", freq: "Seen", reach: "Reach", pval: "Sales value", purchases: "Purchases" };
  const mOn = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); if (Array.isArray(v)) return v; } catch (e) {} return DEFAULTS.slice(); };
  const heroCost = (r) => (r.cost_per_result != null ? Number(r.cost_per_result) : null);
  const heroLabel = (r) => (r.kind === "purchase" ? "Cost per purchase" : r.kind === "messaging" ? "Cost per chat" : "Cost per result");
  function pillsFor(r, limit) {
    const on = new Set(mOn()), out = [];
    for (const m of CAT()) {
      if (!on.has(m.k)) continue;
      if (m.web && r.kind === "messaging") continue;
      let key = m.k, label = SHORT[m.k] || m.label, val = m.v(r), fmt = m.f;
      if (key === "results") label = r.kind === "messaging" ? "Chats" : r.kind === "purchase" ? "Purchases" : (r.result_label || "Results");
      if (key === "cpp" && r.kind === "messaging") { const alt = CP_METRICS.find((x) => x.k === "cpmsg"); label = SHORT.cpmsg; val = alt.v(r); fmt = alt.f; }
      // The big number already is the cost per purchase (website ads) / per chat (WhatsApp ads); do not show the same number twice.
      if ((key === "cpp" || key === "cpmsg") && val != null && heroCost(r) != null && Math.abs(Number(val) - heroCost(r)) < 1) continue;
      const bad = val == null || Number.isNaN(Number(val));
      if (bad && key !== "results") continue;
      out.push(`<span class="cx-pill">${esc(label)}<b>${bad ? "—" : esc(fmt(val))}</b></span>`);
      if (limit && out.length >= limit) break;
    }
    return out.join("");
  }

  // ---------- verdict (from real rules and real numbers; no guessing) ----------
  function verdict(r) {
    const e = r.effective_status || r.status;
    if (typeof amScheduled === "function" && amScheduled(r)) return ["Scheduled", "", "off"];
    if (e !== "ACTIVE") return [amStatusWord(e)[0], "", "off"];
    if (r.suggestion && r.suggestion.kill) return ["Over your kill rule", "bad", "bad"];
    if (Number(r.results) > 0) return ["Getting results", "ok", "ok"];
    if (Number(r.spend) > 0) return ["Spending, no results yet", "warn", "warn"];
    return ["Just started", "", ""];
  }

  // ---------- list ----------
  function card(level, r) {
    const d = am.data, on = r.status === "ACTIVE", busy = am.busy.has(r.id), v = verdict(r);
    let sub = "";
    if (level === "adsets") sub = (d.campaigns.find((c) => c.id === r.campaign_id) || {}).name || "";
    if (level === "ads") sub = (d.adsets.find((x) => x.id === r.adset_id) || {}).name || "";
    if (level !== "ads" && r.daily_budget) sub += (sub ? " · " : "") + fN(r.daily_budget) + " a day";
    const thumb = level === "ads" ? `<img class="cx-th" src="${esc(r.thumbnail_url || "")}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="cx-dot ${v[2]}"></span>`;
    const hv = heroCost(r);
    return `<div class="cx-card${on ? "" : " off"}" onclick="cxOpen('${level}','${r.id}')">
      <div class="cx-hd">${thumb}<div class="cx-nm"><b>${esc(r.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>
        <label class="switch" onclick="event.stopPropagation()"><input type="checkbox" ${on ? "checked" : ""} ${busy ? "disabled" : ""} onchange="amSwitch('${AM_SINGULAR[level]}','${r.id}',this)" aria-label="${on ? "Pause" : "Turn on"}"><span class="sw-track"></span></label></div>
      <div class="cx-big"><small>${esc(heroLabel(r))}</small><b>${hv != null ? fN(hv) : "—"}</b></div>
      <div class="cx-pills">${pillsFor(r, 6)}</div>
      <span class="cx-v ${v[1]}">${esc(v[0])}</span></div>`;
  }
  function listHtml() {
    const lvl = CP.mlevel, counts = { campaigns: amRows("campaigns").length, adsets: amRows("adsets").length, ads: amRows("ads").length };
    const rows = amRows(lvl), tot = amTotals(rows), word = lvl === "campaigns" ? "campaign" : lvl === "adsets" ? "ad set" : "ad";
    return `<div class="cx cx-list"><div class="cx-bar">
      <div class="cx-seg">${[["campaigns", "Campaigns"], ["adsets", "Ad sets"], ["ads", "Ads"]].map(([k, l]) => `<button type="button" class="${lvl === k ? "on" : ""}" onclick="cpMLevel('${k}')">${l}<em>${counts[k]}</em></button>`).join("")}</div>
      <div class="cx-seg">${[["live", "Live"], ["paused", "Paused"], ["all", "All"]].map(([k, l]) => `<button type="button" class="${am.filter === k ? "on" : ""}" onclick="amSetFilter('${k}')">${l}</button>`).join("")}</div>
      <div class="cx-tools"><input class="cx-search" type="search" placeholder="Search ${word}s" value="${esc(am.q || "")}" oninput="cpQuery(this.value)" aria-label="Search">
        <button type="button" class="cx-num" onclick="cxPick()">${ic.tune.replace("<svg", "<svg")}Numbers</button></div></div>
      ${rows.length ? rows.map((r) => card(lvl, r)).join("") + `<div class="cx-tot">${rows.length} ${word}${rows.length === 1 ? "" : "s"} · ${fN(tot.spend)} spent${tot.label ? ` · ${tot.results.toLocaleString("en-NG")} ${tot.label.toLowerCase()}` : ""}</div>` : `<div class="cx-empty">${am.q ? "Nothing matches your search." : "Nothing here for this filter."}</div>`}</div>`;
  }
  // the old search handler redraws the list part only on the tree; on the phone list it must redraw the whole screen
  window.cpQuery = function (v) { am.q = v; const el = document.querySelector(".cx-search"); amDraw(); const n = document.querySelector(".cx-search"); if (n) { n.focus(); n.setSelectionRange(v.length, v.length); } };

  // ---------- detail ----------
  function detailHtml() {
    const f = cpFindSel(), d = am.data;
    if (!f) return `<div class="cx-empty">Pick a campaign, ad set or ad to see its numbers.</div>`;
    const { r } = f, l = CP.sel.l, lvl = cpL[l], real = !r.__none, on = r.status === "ACTIVE", busy = am.busy.has(r.id), v = verdict(r);
    const camp = l === "campaigns" ? null : d.campaigns.find((c) => c.id === r.campaign_id), set = l === "ads" ? d.adsets.find((s) => s.id === r.adset_id) : null;
    const crumb = [camp ? `<a onclick="cxJump('campaigns','${camp.id}')">Campaign: ${esc(camp.name)}</a>` : "", set ? `<a onclick="cxJump('adsets','${set.id}')">Ad set: ${esc(set.name)}</a>` : ""].filter(Boolean).join(" › ");
    const hv = heroCost(r), flag = l === "ads" && on && r.suggestion && r.suggestion.kill;
    const jy = l === "ads" && typeof JYC !== "undefined" && JYC.map[r.id] ? JYC.map[r.id] : null;
    const kids = f.kids || [], kidsLevel = l === "campaigns" ? "adsets" : l === "adsets" ? "ads" : null;
    const started = r.start_time ? new Date(r.start_time) : (r.created_time ? new Date(r.created_time) : null);
    const goal = r.kind === "purchase" ? "Website purchases" : r.kind === "messaging" ? "WhatsApp messages" : "Other";
    const act = (icon, label, js) => `<button type="button" class="cx-act" onclick="${js}"><i>${icon}</i>${label}</button>`;
    const acts = real ? [
      l === "ads" ? act(ic.edit, "Message", `amOpenMsgEdit('${r.id}')`) : act(ic.money, "Budget", `cpEditBudget('${l}','${r.id}')`),
      act(ic.copy, "Duplicate", `cpDuplicate('${l}','${r.id}')`),
      l === "ads" ? act(ic.eye, "Preview", `amPreviewAd('${r.id}')`) : "",
      `<a class="cx-act" href="${esc(cpMetaUrl(l, r.id))}" target="_blank" rel="noopener"><i>${ic.ext}</i>On Meta</a>`,
    ].join("") : "";
    const pic = l === "ads" && (r.picture_url || r.thumbnail_url) ? `<div class="cx-pic"><img src="${esc(r.picture_url || r.thumbnail_url)}" alt="" loading="lazy"></div>` : "";
    return `<div class="cx cx-detail">
      <div class="cx-top"><button type="button" class="cx-back" onclick="cxBackBtn()" aria-label="Back">${ic.back}</button>
        <div style="flex:1;min-width:0"><span class="cx-tag">${LEVEL[l][0]}</span><div class="cx-title">${esc(r.name)}</div></div>
        ${real ? `<label class="switch" title="${on ? "Pause on Meta" : "Turn on in Meta"}"><input type="checkbox" ${on ? "checked" : ""} ${busy ? "disabled" : ""} onchange="amSwitch('${lvl}','${r.id}',this)"><span class="sw-track"></span></label>` : ""}</div>
      ${crumb ? `<div class="cx-crumb">${crumb}</div>` : ""}
      ${pic}
      <div class="cx-hero"><small>${esc(heroLabel(r))}</small><span class="cx-hv">${hv != null ? fN(hv) : "—"}</span><span class="cx-v ${v[1]}">${esc(v[0])}</span>
        <div class="cx-pills">${pillsFor(r, 0)}</div></div>
      ${flag ? `<div class="cx-warn"><span>${esc(r.suggestion.reason)}</span><button type="button" onclick="amSetStatus('ad','${r.id}','PAUSED','kill rule suggestion')">Pause</button></div>` : ""}
      <button type="button" class="cx-num" style="margin-top:12px" onclick="cxPick()">${ic.tune}Change numbers</button>
      ${acts ? `<div class="cx-acts">${acts}</div>` : ""}
      ${jy ? `<button type="button" class="cx-link" onclick="jyAdPanel('${r.id}')"><i>${ic.eye}</i><span><b>${jy.n} ${jy.n === 1 ? "person" : "people"} visited from this ad</b><small>${jy.o ? jy.o + " ordered · " : ""}See what they did</small></span>${ic.chev}</button>` : ""}
      ${kidsLevel ? `<div class="cx-sec">${LEVEL[kidsLevel][1]}s in this ${LEVEL[l][1].toLowerCase()} (${kids.length})</div>${kids.length ? kids.map((k) => kidRow(kidsLevel, k)).join("") : `<div class="cx-empty">Nothing here yet.</div>`}` : ""}
      <div class="cx-sec">Details</div>
      <div class="cx-info"><div><span>Level</span><b>${LEVEL[l][1]}</b></div><div><span>Goal</span><b>${esc(goal)}</b></div>
        <div><span>Budget</span><b>${r.daily_budget ? fN(r.daily_budget) + " a day" : l === "campaigns" ? "Set on each ad set" : "Set on the ad set"}</b></div>
        <div><span>${r.start_time ? "Starts" : "Created"}</span><b>${started ? esc(started.toLocaleString("en-NG", { dateStyle: "medium" })) : "—"}</b></div>
        ${l === "ads" && r.wa_prefill != null ? `<div><span>People send you</span><b>${esc(r.wa_prefill || "—")}</b></div>` : ""}</div></div>`;
  }
  function kidRow(level, k) {
    const v = verdict(k), hv = heroCost(k);
    return `<div class="cx-kid" onclick="cxOpen('${level}','${k.id}')">${level === "ads" ? `<img class="cx-th" src="${esc(k.thumbnail_url || "")}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="cx-dot ${v[2]}"></span>`}
      <div class="cx-nm"><b>${esc(k.name)}</b><small>${fN(k.spend)} spent · ${esc(v[0])}</small></div>
      <div class="cx-kv"><b>${hv != null ? fN(hv) : "—"}</b><small>${esc(heroLabel(k).toLowerCase())}</small></div></div>`;
  }

  // ---------- navigation (the phone's Back button goes up one level, then to the list) ----------
  CP.cxTrail = [];
  const visible = () => { const el = typeof amEl === "function" ? amEl() : null; return !!(el && el.offsetParent !== null); };
  window.cxOpen = function (l, id) {
    CP.cxTrail.push(CP.mDetail ? CP.sel : null);
    try { history.pushState({ cx: 1 }, "", location.href); } catch (e) {}
    cpSelect(l, id);
  };
  window.cxJump = function (l, id) { window.cxOpen(l, id); };
  function backCore() {
    const prev = CP.cxTrail.pop();
    if (!prev) { CP.mDetail = false; } else { CP.sel = prev; CP.mDetail = true; }
    amDraw(); if (typeof mobileMq !== "undefined" && mobileMq.matches) window.scrollTo({ top: 0 });
  }
  window.cxBackBtn = function () { if (history.state && history.state.cx) history.back(); else backCore(); };
  window.cpBack = window.cxBackBtn;
  window.addEventListener("popstate", () => { if (CP.mDetail && visible()) backCore(); });

  // ---------- numbers sheet ----------
  window.cxPick = function () {
    const old = document.getElementById("cxSheet"); if (old) old.remove();
    const on = new Set(mOn()), cat = CAT(), groups = [...new Set(cat.map((m) => m.g))];
    const w = document.createElement("div"); w.id = "cxSheet";
    const draw = () => {
      w.innerHTML = `<div class="cx-scrim"></div><div class="cx-sheet" role="dialog" aria-label="Your numbers"><div class="cx-grab"></div>
        <h3>Your numbers</h3><p>Shown as small pills on every campaign, ad set and ad. The big number is always the cost per result (for website ads, that is the cost per purchase).</p>
        ${groups.map((g) => `<div class="cx-gn">${esc(g)}</div><div class="cx-chips">${cat.filter((m) => m.g === g).map((m) => `<button type="button" class="cx-chip${on.has(m.k) ? " on" : ""}" data-k="${m.k}">${esc(m.label)}</button>`).join("")}</div>`).join("")}
        <div class="cx-foot"><button type="button" class="g" id="cxDef">Use defaults</button><button type="button" class="p" id="cxDone">Done</button></div></div>`;
      w.querySelectorAll(".cx-chip").forEach((b) => { b.onclick = () => { const k = b.dataset.k; if (on.has(k)) on.delete(k); else on.add(k); b.classList.toggle("on"); save(); }; });
      w.querySelector(".cx-scrim").onclick = close; w.querySelector("#cxDone").onclick = close;
      w.querySelector("#cxDef").onclick = () => { on.clear(); DEFAULTS.forEach((k) => on.add(k)); save(); const y = w.querySelector(".cx-sheet").scrollTop; draw(); w.querySelector(".cx-sheet").scrollTop = y; };
    };
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...on])); } catch (e) {} };
    const close = () => { w.remove(); amDraw(); };
    document.body.appendChild(w); draw();
  };

  // ---------- take over the phone list and the details ----------
  // If anything here ever fails on odd data, fall back to the previous screens instead of showing a blank page.
  const oldList = window.cpMobileHtml, oldDetail = window.cpDetailHtml;
  window.cpMobileHtml = function () { try { return listHtml(); } catch (e) { console.error("campaigns list", e); return oldList(); } };
  window.cpDetailHtml = function () { try { return detailHtml(); } catch (e) { console.error("campaign detail", e); return oldDetail(); } };
})();
