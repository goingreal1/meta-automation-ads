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
  .cx-tag{display:inline-flex;align-items:center;height:24px;padding:0 11px;border-radius:12px;background:rgba(31,111,255,.14);color:#1f6fff;font-size:12px;font-weight:750}
  .cx-title{font-size:20px;font-weight:750;line-height:1.2;overflow-wrap:anywhere;margin:2px 0 0}
  .cx-crumb{display:flex;flex-direction:column;align-items:flex-start;gap:6px;font-size:12px;color:var(--muted);margin:10px 4px 0;min-width:0}
  .cx-crumb a{color:#1f6fff;font-weight:650;cursor:pointer;text-decoration:none;min-height:24px;display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cx-hero{margin-top:14px;padding:20px 18px;border-radius:26px;background:#0f2a66;color:#fff}
  .cx-hero small{display:block;font-size:13px;color:#b8c8ee;font-weight:600}
  .cx-hero .cx-hv{display:block;font-size:40px;font-weight:750;letter-spacing:-.03em;margin-top:2px}
  .cx-hero .cx-v{background:rgba(255,255,255,.14);color:#fff;margin-top:10px}
  .cx-hero .cx-v.ok{background:rgba(90,208,142,.2);color:#8be8b3}.cx-hero .cx-v.warn{background:rgba(240,176,74,.22);color:#ffd08a}.cx-hero .cx-v.bad{background:rgba(255,138,142,.22);color:#ffb0b3}
  .cx-hero .cx-pills{border-top:1px solid rgba(255,255,255,.16)}
  .cx-hero .cx-pill{background:rgba(255,255,255,.12);color:#b8c8ee}.cx-hero .cx-pill b{color:#fff}
  .cx-pic{margin-top:14px;border-radius:26px;overflow:hidden;background:rgba(130,145,160,.16);position:relative;height:300px}
  .cx-pic img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block}
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
  .cx-sk{background:rgba(130,145,160,.2);border-radius:14px;animation:cxsh 1.25s ease-in-out infinite}
  .cx-skc{padding:16px;border-radius:24px;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06);margin:0 0 12px}
  @keyframes cxsh{0%,100%{opacity:.55}50%{opacity:1}}
  @media (prefers-reduced-motion:reduce){.cx-sk{animation:none}}
  /* page grey behind white cards, and no card-inside-a-card */
  [data-theme="light"] body:has(.cx), body[data-theme="light"]:has(.cx){background:#f1f3f8}
  .rv-ui .cp-old:has(.cx){background:transparent}
  .rv-ui .cp-old:has(.cx) > .rv-mlist, .rv-ui .cp-old:has(.cx) > .rv-dt{background:transparent;border:0;box-shadow:none;padding:0;border-radius:0}
  .cx-head{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:2px 2px 12px}
  .cx-head h1{flex:1;margin:0;font-size:28px;font-weight:750;letter-spacing:-.02em}
  .cx-ib{width:44px;height:44px;border:0;border-radius:50%;background:var(--panel);color:var(--text);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 1px 2px rgba(15,30,70,.08),0 4px 14px rgba(15,30,70,.06);flex:none}
  .cx-ib svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
  .cx-new{height:44px;padding:0 18px;border:0;border-radius:22px;background:#1f6fff;color:#fff;font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px;cursor:pointer;flex:none}
  .cx-new svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2.6;stroke-linecap:round}
  .cx-rowseg{display:flex;align-items:center;gap:10px}.cx-rowseg .cx-seg{flex:1}
  .cx-rng{height:44px;padding:0 14px;border:0;border-radius:22px;background:var(--panel);color:var(--text);font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 1px 2px rgba(15,30,70,.08),0 4px 14px rgba(15,30,70,.06)}
  .cx-seg{background:var(--cxseg,rgba(120,130,150,.16))}
  .cx-tl{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}
  .cx-spk{display:flex;align-items:flex-end;gap:4px;height:36px}.cx-spk i{width:8px;border-radius:3px;background:#1f6fff;display:block}.cx-spk.bad i{background:#e5484d}
  .cx-kbar{height:8px;border-radius:4px;background:var(--panel2);margin-top:10px;overflow:hidden}.cx-kbar i{display:block;height:100%;border-radius:4px}
  .cx-kd{flex:1;min-width:0}
  .cx-kd .top{display:flex;align-items:center;gap:10px}
  .cx-kd .top b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}.cx-kd .top span{font-weight:750}
  .cx-kd small{display:block;font-size:12px;color:var(--muted);margin-top:8px}
  .cx-st{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px;margin-top:2px}.cx-st i{width:8px;height:8px;border-radius:50%;background:var(--muted)}
  .cx-st i.ok{background:#18a35a}.cx-st i.warn{background:#d98200}.cx-st i.bad{background:#e5484d}
  .cx-pillrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
  .cx-search2{width:100%;height:44px;border:1px solid var(--border);border-radius:22px;background:var(--panel);color:var(--text);padding:0 16px;font:inherit;font-size:14px;margin-top:10px}
  @media (max-width:860px){.rv-ui:has(.cx-list) .awc.hero,.rv-ui:has(.cx-list) .rv-sum,.rv-ui:has(.cx-list) .rv-head,.rv-ui:has(.cx-list) .cp-tools{display:none}}
  `;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  const ic = {
    back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
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
    const on = new Set(mOn()), out = [], seen = new Set();
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
      const sig = label + "|" + (bad ? "-" : fmt(val)); if (seen.has(sig)) continue; seen.add(sig);
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

  // ---------- little 7-day spend bars (from the live daily numbers Home already loads) ----------
  const last7 = () => Array.from({ length: 7 }, (_, i) => watDate(-(6 - i)));
  let askedDaily = false;
  function dailyRows() {
    let d = typeof liveDaily !== "undefined" && liveDaily.data && liveDaily.data.ok ? liveDaily.data.rows : null;
    if (d && d.length && d.reduce((m, x) => (x.date < m ? x.date : m), "9999") > watDate(-6)) d = null; // only part of the week is loaded; ask for the whole week
    if (!d && !askedDaily && typeof fetchLiveDaily === "function") { askedDaily = true; fetchLiveDaily(watDate(-6), watDate(0)).then(() => { askedDaily = false; if (document.querySelector(".cx-list")) amDraw(); }).catch(() => { askedDaily = false; }); }
    return d;
  }
  function bars(level, r) {
    const rows = dailyRows(); if (!rows || level === "ads") return "";
    const days = last7(), by = new Map();
    rows.forEach((x) => { const hit = level === "adsets" ? x.adset_id === r.id : (x.campaign_id ? x.campaign_id === r.id : x.campaign_name === r.name); if (hit) by.set(x.date, (by.get(x.date) || 0) + (Number(x.spend) || 0)); });
    const vals = days.map((dd) => by.get(dd) || 0), mx = Math.max(...vals); if (mx <= 0) return "";
    return `<div class="cx-spk${verdict(r)[1] === "bad" || (Number(r.spend) > 0 && !Number(r.results)) ? " bad" : ""}" aria-hidden="true">${vals.map((v) => `<i style="height:${Math.max(3, Math.round(v / mx * 36))}px"></i>`).join("")}</div>`;
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
      <div class="cx-tl"><div class="cx-big"><small>${esc(heroLabel(r))}</small><b>${hv != null ? fN(hv) : "—"}</b></div>${bars(level, r)}</div>
      <div class="cx-pills">${pillsFor(r, 6)}</div>
      <span class="cx-v ${v[1]}">${esc(v[0])}</span></div>`;
  }
  function listHtml() {
    const lvl = CP.mlevel, counts = { campaigns: amRows("campaigns").length, adsets: amRows("adsets").length, ads: amRows("ads").length };
    const rows = amRows(lvl), tot = amTotals(rows), word = lvl === "campaigns" ? "campaign" : lvl === "adsets" ? "ad set" : "ad";
    const rngShort = ({ today: "Today", yesterday: "Yesterday", last3: "3d", last7: "7d", last30: "30d", lifetime: "Lifetime" })[am.range] || "Today";
    return `<div class="cx cx-list"><div class="cx-head">
        <button type="button" class="cx-ib" onclick="cxSearch()" aria-label="Search">${ic.search}</button>
        <button type="button" class="cx-ib" onclick="amFetch()" aria-label="Refresh">${ic.refresh}</button>
        <button type="button" class="cx-new" onclick="bvOpenObjectiveGateModal()">${ic.plus}New</button></div>
      <div class="cx-bar">
      <div class="cx-seg">${[["campaigns", "Campaigns"], ["adsets", "Ad sets"], ["ads", "Ads"]].map(([k, l]) => `<button type="button" class="${lvl === k ? "on" : ""}" onclick="cpMLevel('${k}')">${l}<em>${counts[k]}</em></button>`).join("")}</div>
      <div class="cx-rowseg"><div class="cx-seg">${[["live", "Live"], ["paused", "Paused"], ["all", "All"]].map(([k, l]) => `<button type="button" class="${am.filter === k ? "on" : ""}" onclick="amSetFilter('${k}')">${l}</button>`).join("")}</div>
        <button type="button" class="cx-rng" onclick="cxRange()">${esc(rngShort)}</button></div>
      ${CP.cxSearch || am.q ? `<input class="cx-search2" type="search" placeholder="Search ${word}s" value="${esc(am.q || "")}" oninput="cpQuery(this.value)" aria-label="Search">` : ""}
      <div class="cx-pillrow"><button type="button" class="cx-num" onclick="cxPick()">${ic.tune}Numbers on cards \u00b7 Change</button>
        <button type="button" class="cx-num" onclick="bvOpenDraftsModal()">Drafts</button>
</div></div>
      ${!rows.length && (am.loading || CP.cxPending) ? skCard() + skCard() : rows.length ? rows.map((r) => card(lvl, r)).join("") + `<div class="cx-tot">${rows.length} ${word}${rows.length === 1 ? "" : "s"} · ${fN(tot.spend)} spent${tot.label ? ` · ${tot.results.toLocaleString("en-NG")} ${tot.label.toLowerCase()}` : ""}</div>` : `<div class="cx-empty">${am.q ? "Nothing matches your search." : "Nothing here for this filter."}</div>`}</div>`;
  }
  // the old search handler redraws the list part only on the tree; on the phone list it must redraw the whole screen
  window.cxSearch = function () { CP.cxSearch = !CP.cxSearch; amDraw(); const n = document.querySelector('.cx-search2'); if (n) n.focus(); };
  window.cxRange = function () {
    const old = document.getElementById('cxRng'); if (old) old.remove();
    const w = document.createElement('div'); w.id = 'cxRng';
    w.innerHTML = `<div class="cx-scrim"></div><div class="cx-sheet" role="dialog" aria-label="Date range"><div class="cx-grab"></div><h3>Date range</h3><div class="cx-chips" style="margin-top:14px">${[["today", "Today"], ["last7", "7 days"], ["last30", "30 days"], ["lifetime", "Lifetime"], ["yesterday", "Yesterday"], ["last3", "Last 3 days"]].map(([k, l]) => `<button type="button" class="cx-chip${am.range === k ? ' on' : ''}" data-k="${k}">${esc(l)}</button>`).join('')}</div></div>`;
    w.querySelector('.cx-scrim').onclick = () => w.remove();
    w.querySelectorAll('.cx-chip').forEach((b) => { b.onclick = () => { w.remove(); amSetRange(b.dataset.k); }; });
    document.body.appendChild(w);
  };
  window.cpQuery = function (v) { am.q = v; amDraw(); const n = document.querySelector(".cx-search2"); if (n) { n.focus(); n.setSelectionRange(v.length, v.length); } };

  // ---------- detail ----------
  function detailHtml() {
    const f = cpFindSel(), d = am.data;
    if (!f) return `<div class="cx-empty">Pick a campaign, ad set or ad to see its numbers.</div>`;
    const { r } = f, l = CP.sel.l, lvl = cpL[l], real = !r.__none, on = r.status === "ACTIVE", busy = am.busy.has(r.id), v = verdict(r);
    const camp = l === "campaigns" ? null : d.campaigns.find((c) => c.id === r.campaign_id), set = l === "ads" ? d.adsets.find((s) => s.id === r.adset_id) : null;
    const crumb = [camp ? `<a onclick="cxJump('campaigns','${camp.id}')">Campaign: ${esc(camp.name)}</a>` : "", set ? `<a onclick="cxJump('adsets','${set.id}')">Ad set: ${esc(set.name)}</a>` : ""].filter(Boolean).join("");
    const hv = heroCost(r), flag = l === "ads" && on && r.suggestion && r.suggestion.kill;
    const jy = (() => { if (typeof JYC === "undefined" || !JYC.map) return null; if (l === "ads") return JYC.map[r.id] || null;
      const ids = (f.ads || []).map((x) => x.id), t = ids.reduce((a, id) => { const c = JYC.map[id]; return c ? { n: a.n + c.n, o: a.o + (c.o || 0) } : a; }, { n: 0, o: 0 }); return t.n ? t : null; })();
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
    const pic = l === "ads" && (r.picture_url || r.thumbnail_url) ? `<div class="cx-pic"><img src="${esc(r.picture_url || r.thumbnail_url)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></div>` : "";
    return `<div class="cx cx-detail">
      <div class="cx-top"><button type="button" class="cx-back" onclick="cxBackBtn()" aria-label="Back">${ic.back}</button>
        <div style="flex:1;min-width:0"><span class="cx-tag">${LEVEL[l][1]}</span><div class="cx-title">${esc(r.name)}</div><div class="cx-st"><i class="${on ? "ok" : ""}"></i>${esc(v[0] === "Scheduled" ? "Scheduled" : on ? "Live" : amStatusWord(r.effective_status || r.status)[0])}</div></div>
        ${real ? `<label class="switch" title="${on ? "Pause on Meta" : "Turn on in Meta"}"><input type="checkbox" ${on ? "checked" : ""} ${busy ? "disabled" : ""} onchange="amSwitch('${lvl}','${r.id}',this)"><span class="sw-track"></span></label>` : ""}</div>
      ${crumb ? `<div class="cx-crumb">${crumb}</div>` : ""}
      ${pic}
      <div class="cx-hero"><small>${esc(heroLabel(r))}</small><span class="cx-hv">${hv != null ? fN(hv) : "—"}</span><span class="cx-v ${v[1]}">${esc(v[0])}</span>
        <div class="cx-pills">${pillsFor(r, 0)}</div></div>
      ${flag ? `<div class="cx-warn"><span>${esc(r.suggestion.reason)}</span><button type="button" onclick="amSetStatus('ad','${r.id}','PAUSED','kill rule suggestion')">Pause</button></div>` : ""}
      <button type="button" class="cx-num" style="margin-top:12px" onclick="cxPick()">${ic.tune}Change numbers</button>
      ${acts ? `<div class="cx-acts">${acts}</div>` : ""}
      ${jy ? `<button type="button" class="cx-link" onclick="${l === 'ads' ? `jyAdPanel('${r.id}')` : 'jnOpen()'}"><i>${ic.eye}</i><span><b>${jy.n} ${jy.n === 1 ? "person" : "people"} visited${l === "ads" ? " from this ad" : ""}</b><small>${jy.o ? jy.o + " ordered · " : ""}See what they did</small></span>${ic.chev}</button>` : ""}
      ${kidsLevel ? `<div class="cx-sec">${LEVEL[kidsLevel][1]}s</div>${kids.length ? kids.map((k) => kidRow(kidsLevel, k, Math.max(...kids.map((x) => Number(x.spend) || 0)))).join("") : `<div class="cx-empty">Nothing here yet.</div>`}` : ""}</div>`;
  }
  function kidRow(level, k, top) {
    const v = verdict(k), hv = heroCost(k), col = v[1] === "ok" ? "#18a35a" : v[1] === "bad" ? "#e5484d" : v[1] === "warn" ? "#d98200" : "#8aa9e6", res = Number(k.results) || 0;
    return `<div class="cx-kid" onclick="cxOpen('${level}','${k.id}')">${level === "ads" ? `<img class="cx-th" src="${esc(k.thumbnail_url || "")}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="cx-dot ${v[2]}"></span>`}
      <div class="cx-kd"><div class="top"><b>${esc(k.name)}</b><span>${hv != null ? fN(hv) : "—"}</span></div>
        <div class="cx-kbar"><i style="width:${Math.max(4, Math.min(100, (Number(k.spend) || 0) / (top || 1) * 100))}%;background:${col}"></i></div>
        <small>${fN(k.spend)} spent \u00b7 ${res} ${res === 1 ? "result" : "results"}</small></div></div>`;
  }

  // ---------- loading placeholder shaped like the new cards ----------
  const skCard = () => `<div class="cx-skc"><div style="display:flex;gap:10px;align-items:center"><div class="cx-sk" style="width:10px;height:10px;border-radius:5px"></div><div style="flex:1"><div class="cx-sk" style="width:55%;height:15px"></div><div class="cx-sk" style="width:30%;height:11px;margin-top:6px"></div></div><div class="cx-sk" style="width:46px;height:28px;border-radius:14px"></div></div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:16px"><div><div class="cx-sk" style="width:90px;height:11px"></div><div class="cx-sk" style="width:130px;height:28px;margin-top:8px"></div></div><div class="cx-sk" style="width:80px;height:34px"></div></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:16px;padding-top:12px">${[96, 88, 110, 92, 78].map((w) => `<div class="cx-sk" style="width:${w}px;height:30px;border-radius:15px"></div>`).join("")}</div></div>`;
  const skScreen = () => `<div class="cx cx-list" aria-busy="true" aria-label="Loading"><div class="cx-head"><div class="cx-sk" style="width:44px;height:44px;border-radius:22px"></div><div class="cx-sk" style="width:44px;height:44px;border-radius:22px"></div><div class="cx-sk" style="width:84px;height:44px;border-radius:22px"></div></div><div class="cx-bar"><div class="cx-sk" style="height:46px;border-radius:14px"></div><div class="cx-sk" style="height:46px;border-radius:14px"></div></div>${skCard()}${skCard()}${skCard()}</div>`;
  window.cxSkeleton = skScreen;
  const prevSkel = window.bvSkel;
  window.bvSkel = function (kind) {
    const onCamp = typeof activeTab !== "undefined" && activeTab === "campaigns";
    if (onCamp && (kind === undefined || kind === "table")) return `<div class="rv-ui">${skScreen()}</div>`;
    return prevSkel ? prevSkel.apply(this, arguments) : "";
  };

  // ---------- opening a campaign from Home (waits until the live list has arrived) ----------
  function resolvePending() {
    const p = CP.cxPending; if (!p || !am.data) return;
    const c = (am.data.campaigns || []).find((x) => (p.id && x.id === p.id) || (!p.id && p.name && x.name === p.name) || (p.id && p.name && x.name === p.name));
    if (c) {
      CP.cxPending = null; CP.cxTrail = [null]; CP.sel = { l: "campaigns", id: c.id }; CP.open.add(c.id); CP.tab = "overview"; CP.mDetail = true;
      try { if (typeof bvNavPush === "function") bvNavPush(); } catch (e) {}
    } else if (!am.loading) CP.cxPending = null;
  }
  const prevDraw = window.amDraw;
  window.amDraw = function () {
    try { resolvePending(); } catch (e) { console.error("campaign open", e); }
    const root = typeof amEl === "function" ? amEl() : null, phone = window.matchMedia("(max-width: 860px)").matches;
    if (root && phone && !am.data && !am.error) { root.classList.add("rv-ui"); root.innerHTML = skScreen(); return; }
    if (root && phone && !am.data && am.error) {
      const busy = /limit|too many|rate|busy/i.test(String(am.error));
      root.classList.add("rv-ui");
      root.innerHTML = `<div class="cx cx-list"><div class="cx-head"><button type="button" class="cx-new" onclick="bvOpenObjectiveGateModal()">${ic.plus}New</button></div>
        <div class="cx-card" style="cursor:default"><b style="font-size:16px">${busy ? "Meta is busy right now" : "Could not load your campaigns"}</b>
        <p style="margin:8px 0 14px;color:var(--muted);font-size:14px">${busy ? "Meta is limiting how fast we can ask. Wait a minute, then try again." : esc(am.error)}</p>
        <button type="button" class="cx-new" onclick="amFetch()">Try again</button></div></div>`;
      return;
    }
    // Keep the same place on the page when the screen redraws itself (picking numbers, a switch, live numbers arriving).
    const was = { d: !!document.querySelector(".cx-detail"), id: CP.sel && CP.sel.id }, y = window.scrollY;
    const r = prevDraw.apply(this, arguments);
    if (was.d && was.d === !!CP.mDetail && was.id === (CP.sel && CP.sel.id)) { window.scrollTo(0, y); requestAnimationFrame(() => window.scrollTo(0, y)); }
    return r;
  };
  // Coming to Campaigns from the tab bar returns to the range and filter the person had chosen, not the ones Home borrowed.
  const tb = document.getElementById("tabsBar");
  if (tb) tb.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest(".tab-btn"); if (b && b.dataset.tab === "campaigns" && CP.cxPrev) { am.range = CP.cxPrev.range; am.filter = CP.cxPrev.filter; CP.cxPrev = null; } }, true);
  ["amSetRange", "amSetFilter"].forEach((n) => { const f = window[n]; if (typeof f === "function") window[n] = function () { CP.cxPrev = null; return f.apply(this, arguments); }; });

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
