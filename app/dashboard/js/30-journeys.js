// ── Journeys: every visit to your pages, which Meta ad it came from, what the visitor did, and the replay. ──
const JY = { filter: "all", ad: "", days: 7, rows: [], projects: [], names: {}, timer: null };
const JYC = { loaded: false, map: {} };            // per-ad visit counts for the campaign screen: { adId: {n, o} }
const jyFmt = (s) => { s = Math.round(Number(s) || 0); return s >= 60 ? Math.floor(s / 60) + "m " + (s % 60) + "s" : s + "s"; };
const jyClock = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const jyAgo = (t) => { const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000); return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + "m ago" : s < 86400 ? Math.floor(s / 3600) + "h ago" : Math.floor(s / 86400) + "d ago"; };
const jyLive = (r) => Date.now() - new Date(r.last_seen_at).getTime() < 60000;
const jyNice = (v) => String(v || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const jyDev = (d) => ({ mobile: "Mobile", desktop: "Desktop", tablet: "Tablet" }[d] || "—");
function jyCountry(cc) { try { return cc ? new Intl.DisplayNames(["en"], { type: "region" }).of(cc) : ""; } catch (e) { return cc || ""; } }
function jyWhere(r) { const c = jyCountry(r.country); return [r.city, c].filter(Boolean).join(", ") || "Location unknown"; }
function jySource(r) { return r.meta_ad_id ? (JY.names[r.meta_ad_id] || "Ad " + r.meta_ad_id) : (r.referrer_host || "Direct / unknown"); }
function jyCss() {
  if (document.getElementById("jyCss")) return;
  const st = document.createElement("style"); st.id = "jyCss";
  st.textContent = `
  .jy{--jb:#1262d6;--jbg:#f4f6f9;--jl:#e3e8ed;--jm:#5b6b78}
  .jy h2{margin:0;font-size:24px;font-weight:700}.jy .sub{color:var(--jm);font-size:13px;margin-top:2px}
  .jy-head{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-bottom:16px}.jy-head>div:first-child{flex:1;min-width:200px}
  .jy-sel,.jy-btn2{border:1px solid #d3dbe2;background:var(--panel,#fff);color:inherit;border-radius:10px;padding:10px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
  .jy-btn{border:0;background:var(--jb);color:#fff;padding:10px 14px;border-radius:10px;font-weight:600;font-size:13px;cursor:pointer;white-space:nowrap;font-family:inherit}
  .jy-btn.soft{background:#eaf1fd;color:var(--jb)}.jy-btn.ghost{background:var(--panel2,#eef2f4);color:inherit}
  .jy-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}
  .jy-tile{background:var(--panel,#fff);border:1px solid var(--jl);border-radius:14px;padding:14px}.jy-tile small{display:block;font-size:11px;font-weight:700;letter-spacing:.05em;color:var(--jm)}
  .jy-tile b{display:block;font-size:26px;margin-top:4px}.jy-tile b em{font-style:normal;font-size:13px;color:var(--jm);font-weight:500;margin-left:4px}
  .jy-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center}
  .jy-chip{border:1px solid #d3dbe2;background:var(--panel,#fff);color:inherit;padding:7px 14px;border-radius:99px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
  .jy-chip.on{background:var(--jb);color:#fff;border-color:transparent}
  .jy-tbl{background:var(--panel,#fff);border:1px solid var(--jl);border-radius:16px;overflow:hidden}
  .jy-tr{display:grid;grid-template-columns:2.2fr 1.1fr .8fr .7fr .6fr 96px;gap:10px;padding:13px 16px;align-items:center;border-bottom:1px solid #eef1f4;font-size:13px}
  .jy-tr:last-child{border-bottom:0}.jy-th{font-size:11px;font-weight:700;color:var(--jm);letter-spacing:.05em;border-bottom:1px solid var(--jl)}
  .jy-tr b{font-weight:600}.jy-tr small{display:block;color:var(--jm);font-size:12px;margin-top:2px}
  .jy-nm b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .jy-pill{font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px;margin-left:5px;vertical-align:middle;background:#eef2f4;color:#5b6b78}
  .jy-pill.live{background:#e1f8ea;color:#12843d}.jy-pill.ord{background:#fff0d6;color:#9a5b00}
  .jy-empty{padding:32px;text-align:center;color:var(--jm);font-size:14px}
  .jy-m{display:none}
  .jy-card{background:var(--panel,#fff);border:1px solid var(--jl);border-radius:16px;padding:14px;margin-bottom:10px}
  .jy-sheetbar{display:flex;align-items:center;gap:10px;padding:16px 18px 6px;flex-wrap:wrap}.jy-sheetbar b{font-size:19px}
  .jy-x{margin-left:auto;border:0;background:var(--panel2,#eef2f4);width:36px;height:36px;border-radius:99px;font-size:16px;cursor:pointer;color:inherit}
  .jy-grid{display:grid;grid-template-columns:1.25fr 1fr;gap:16px;padding:10px 18px 18px}
  .jy-box{background:var(--panel,#fff);border:1px solid var(--jl);border-radius:16px;padding:16px;font-size:13px}
  .jy-box h4{margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:.05em;color:var(--jm);display:flex;align-items:center}.jy-box h4 span{flex:1}
  .jy-dl{display:grid;grid-template-columns:96px 1fr;gap:8px;line-height:1.35}.jy-dl>:nth-child(odd){color:var(--jm)}.jy-dl>:nth-child(even){word-break:break-word}
  .jy-stage{background:#0f1a22;border-radius:16px;padding:12px;display:flex;justify-content:center;align-items:flex-start;min-height:260px;overflow:auto}
  .jy-tl{display:flex;flex-direction:column;gap:2px}
  .jy-ev{display:flex;gap:10px;padding:8px 6px;border-radius:10px;cursor:pointer;line-height:1.35;align-items:flex-start}.jy-ev:hover{background:var(--panel2,#f4f6f9)}
  .jy-ev b{color:var(--jb);min-width:38px;font-variant-numeric:tabular-nums}.jy-ev.good span{color:#12843d;font-weight:700}
  .jy-code{background:#0f1a22;color:#d7ecff;padding:14px;border-radius:12px;font:12px/1.5 ui-monospace,Menlo,monospace;overflow:auto;white-space:pre-wrap;word-break:break-all;margin:8px 0}
  .jy-in{width:100%;box-sizing:border-box;border:1px solid #d3dbe2;border-radius:10px;padding:11px 12px;font-size:14px;margin:6px 0 10px;background:var(--panel,#fff);color:inherit;font-family:inherit}
  .jy-chipbtn{border:1px solid var(--jb,#1262d6);background:#eaf1fd;color:#1262d6;border-radius:99px;padding:5px 11px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit}
  .jy-ov .bv-modal{padding:0}
  @media(max-width:700px){
    .jy h2{font-size:21px}.jy-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
    .jy-tbl{display:none}.jy-m{display:block}
    .jy-grid{grid-template-columns:1fr;padding:8px 12px 16px}
    .jy-head .jy-btn,.jy-head .jy-sel{flex:1}
    .jy-sheetbar{padding:14px 12px 4px}
  }`;
  document.head.appendChild(st);
  jyCss2(); // after the base styles, so its phone rules win
}

function jyCss2() {
  if (document.getElementById("jyCss2")) return;
  const st = document.createElement("style"); st.id = "jyCss2";
  st.textContent = `
  .jy-sum{display:none}
  .jy-r{display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--panel,#fff);border-bottom:1px solid #f0ede6;cursor:pointer;-webkit-tap-highlight-color:transparent}
  .jy-r:active{background:var(--panel2,#faf9f7)}
  .jy-av{width:42px;height:42px;border-radius:99px;display:flex;align-items:center;justify-content:center;flex:none;background:#efece5;color:#55524a;font-size:14px;font-weight:700}
  .jy-av.live{background:#e1f4e8;color:#1a8f4c}.jy-av.ord{background:#fff0d6;color:#9a5b00}
  .jy-rm{flex:1;min-width:0}.jy-rt{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.jy-rs{font-size:13px;color:#8c887c;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .jy-rr{text-align:right;flex:none}.jy-rr small{display:block;font-size:12px;color:#8c887c}.jy-rr b{display:block;font-size:12px}.jy-rr b.live{color:#1a8f4c}.jy-rr b.ord{color:#9a5b00}
  .jy-grp{font-size:12px;font-weight:600;color:#8c887c;padding:14px 16px 6px;letter-spacing:.02em}
  .jy-chipbtn.mute{background:transparent;border-color:#d6d1c4;color:#8c887c;font-weight:600}
  .jy-ad.bv-overlay{position:fixed!important;inset:0!important;z-index:100000!important;background:rgba(10,10,9,.45)!important;display:flex!important;align-items:flex-end;justify-content:center;padding:0!important}
  .jy-ad .ad-sheet{width:100%;max-width:560px;height:84%;background:#faf9f7;color:#14130f;border-radius:22px 22px 0 0;display:flex;flex-direction:column;box-shadow:0 -10px 40px rgba(0,0,0,.25);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .jy-ad .ad-grab{width:38px;height:5px;border-radius:3px;background:#d6d1c4;margin:8px auto 2px;flex:none}
  .jy-ad .ad-head{display:flex;align-items:center;padding:8px 18px 4px;flex:none}.jy-ad .ad-head b{display:block;font-size:18px;font-weight:700;letter-spacing:-.01em}.jy-ad .ad-head small{display:block;font-size:13px;color:#55524a;margin-top:2px}
  .jy-ad .ad-x{width:32px;height:32px;border-radius:99px;background:#efece5;display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer;flex:none;margin-left:10px}
  .jy-ad .ad-stats{display:flex;gap:8px;padding:10px 18px 4px;flex:none}.jy-ad .ad-st{flex:1;background:#fff;border:1px solid #e7e3da;border-radius:14px;padding:10px 12px}.jy-ad .ad-st small{display:block;font-size:12px;color:#8c887c}.jy-ad .ad-st b{display:block;font-size:22px;font-weight:700;margin-top:2px}.jy-ad .ad-st b em{font-style:normal;font-size:13px;color:#8c887c;font-weight:500}
  .jy-ad .ad-seg{display:flex;gap:2px;background:#efece5;border-radius:10px;padding:3px;margin:10px 18px 4px;flex:none}.jy-ad .ad-seg div{flex:1;text-align:center;font-size:13px;font-weight:600;padding:7px 0;border-radius:8px;color:#55524a;cursor:pointer}.jy-ad .ad-seg div.on{background:#fff;color:#14130f;box-shadow:0 1px 2px rgba(0,0,0,.12)}
  .jy-ad .ad-list{flex:1;overflow:auto;padding:2px 0 14px;-webkit-overflow-scrolling:touch}.jy-ad .ad-list .jy-r{background:transparent;padding-left:18px;padding-right:18px}
  .jy-ad .ad-empty{padding:34px 24px;text-align:center;color:#8c887c;font-size:14px;line-height:1.5}
  @media(min-width:701px){.jy-ad.bv-overlay{align-items:center!important}.jy-ad .ad-sheet{border-radius:20px;height:min(640px,86vh)}.jy-ad .ad-grab{display:none}}
  @media(max-width:700px){
    .jy-head{flex-wrap:nowrap;align-items:center;margin-bottom:6px;gap:8px}.jy-head>div:first-child{min-width:0}.jy-head h2{font-size:28px;letter-spacing:-.02em}.jy-head .sub{display:none}
    .jy-head .jy-sel{flex:none!important;padding:8px 10px;font-size:13px;border-radius:99px}
    .jy-head #jySetup{flex:none!important;width:38px;height:38px;padding:0;border-radius:99px;font-size:0;background:var(--panel,#fff);color:inherit;border:1px solid #e7e3da;position:relative}
    .jy-head #jySetup::before{content:"+";font-size:22px;line-height:1;position:absolute;left:0;right:0;top:50%;transform:translateY(-52%);text-align:center}
    .jy-tiles{display:none}.jy-sum{display:block;font-size:13px;color:#55524a;margin:0 0 10px}.jy-sum b{color:#1a8f4c}
    .jy-chips{flex-wrap:nowrap;overflow-x:auto;margin:0 -16px 6px;padding:2px 16px;scrollbar-width:none}.jy-chips::-webkit-scrollbar{display:none}.jy-chips>*{flex:none}
    .jy-chip.on{background:#14130f}
    .jy-m{margin:0 -16px;border-top:1px solid #f0ede6}
  }`;
  document.head.appendChild(st);
}
function jyRange() { return new Date(Date.now() - JY.days * 86400000).toISOString(); }
async function renderJourneys(c) {
  jyCss();
  c.innerHTML = `<div class="rv-ui jy"><div class="jy-head"><div><h2>Journeys</h2><div class="sub">Every visit to your pages, traced back to the Meta ad. Recordings are kept 60 days. Typed text is never recorded.</div></div>
    <select class="jy-sel" id="jyDays"><option value="1">24 hours</option><option value="7">7 days</option><option value="30">30 days</option><option value="60">60 days</option></select>
    <button class="jy-btn" id="jySetup">+ Connect a website</button></div>
    <div class="jy-tiles" id="jyTiles"></div><div class="jy-sum" id="jySum"></div><div class="jy-chips" id="jyTop"></div><div id="jyList"><div class="jy-empty"><span class="spin"></span> Loading…</div></div></div>`;
  const dd = document.getElementById("jyDays"); dd.value = String(JY.days); dd.onchange = () => { JY.days = Number(dd.value); jyLoad(); };
  document.getElementById("jySetup").onclick = () => jySetup();
  await jyLoad();
  clearInterval(JY.timer); JY.timer = setInterval(() => { if (document.getElementById("jyList")) jyLoad(); else clearInterval(JY.timer); }, 15000);
}
async function jyNames(ids) {
  const need = [...new Set(ids.filter((x) => x && !JY.names[x]))]; if (!need.length) return;
  const o = await sbRpc("rv_names", { p_ids: need }).catch(() => []);
  (o || []).forEach((x) => { JY.names[x.meta_id] = x.name; });
}
async function jyLoad() {
  const [rows, projects] = await Promise.all([
    sbQuery("site_sessions", `select=*&started_at=gte.${jyRange()}&order=started_at.desc&limit=500`).catch(() => []),
    sbQuery("rec_projects", "select=*&order=created_at.desc").catch(() => []),
  ]);
  JY.rows = rows || []; JY.projects = projects || [];
  await jyNames(JY.rows.flatMap((r) => [r.meta_ad_id, r.meta_campaign_id]));
  jyDraw();
}
function jyFiltered() {
  const f = JY.filter;
  return JY.rows.filter((r) => (!JY.ad || r.meta_ad_id === JY.ad) && (f === "all" || (f === "live" && jyLive(r)) || (f === "order" && r.ordered) || (f === "mobile" && r.device === "mobile") || (f === "ad" && r.meta_ad_id)));
}
function jyRowHtml(r) {
  const pills = (jyLive(r) ? '<span class="jy-pill live">LIVE</span>' : "") + (r.ordered ? '<span class="jy-pill ord">ORDERED</span>' : "");
  const pl = r.placement ? " · " + escH(jyNice(r.placement)) : "";
  const btn = r.has_recording ? `<button class="jy-btn soft" data-w="${r.id}">▶ Watch</button>` : `<button class="jy-btn soft" data-w="${r.id}" style="opacity:.8">Details</button>`;
  return { pills, pl, btn };
}
function jyDraw() {
  const top = document.getElementById("jyTop"), list = document.getElementById("jyList"), tiles = document.getElementById("jyTiles"); if (!top || !list) return;
  const all = JY.rows, live = all.filter(jyLive).length, ord = all.filter((r) => r.ordered).length, avg = all.length ? all.reduce((t, r) => t + (r.duration_s || 0), 0) / all.length : 0;
  tiles.innerHTML = `<div class="jy-tile"><small>LIVE NOW</small><b style="color:#12843d">${live}</b></div><div class="jy-tile"><small>VISITS</small><b>${all.length}</b></div>
    <div class="jy-tile"><small>AVG TIME ON PAGE</small><b>${jyFmt(avg)}</b></div><div class="jy-tile"><small>ORDERED</small><b>${ord}<em>${all.length ? (ord / all.length * 100).toFixed(1) + "%" : ""}</em></b></div>`;
  const sm = document.getElementById("jySum"); if (sm) sm.innerHTML = `${live ? `<b>● ${live} live now</b> · ` : ""}${all.length} visit${all.length === 1 ? "" : "s"}${ord ? ` · ${ord} order${ord === 1 ? "" : "s"} (${(ord / all.length * 100).toFixed(1)}%)` : ""}`;
  const adIds = [...new Set(all.map((r) => r.meta_ad_id).filter(Boolean))];
  const F = [["all", "All"], ["live", "Live now" + (live ? " (" + live + ")" : "")], ["order", "Ordered"], ["mobile", "Mobile"], ["ad", "From ads"]];
  top.innerHTML = F.map(([k, l]) => `<button class="jy-chip${JY.filter === k ? " on" : ""}" data-f="${k}">${l}</button>`).join("") +
    (adIds.length ? `<select class="jy-sel" id="jyAd" style="padding:7px 12px;border-radius:99px"><option value="">All ads</option>${adIds.map((a) => `<option value="${a}"${JY.ad === a ? " selected" : ""}>${escH(JY.names[a] || "Ad " + a)}</option>`).join("")}</select>` : "");
  top.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { JY.filter = b.dataset.f; jyDraw(); }));
  const sel = document.getElementById("jyAd"); if (sel) sel.onchange = () => { JY.ad = sel.value; jyDraw(); };
  const rows = jyFiltered();
  if (!rows.length) { list.innerHTML = `<div class="jy-empty">${all.length ? "No visits match this filter." : "No visits yet. Open one of your pages and it will show up here."}</div>`; return; }
  const desk = rows.slice(0, 200).map((r) => { const x = jyRowHtml(r);
    return `<div class="jy-tr"><div class="jy-nm"><b>${escH(jySource(r))}${x.pills}</b><small>Visit #${r.visit_no} · ${jyAgo(r.started_at)}${x.pl}</small></div>
      <div>${escH(jyWhere(r))}<small>${jyDev(r.device)}</small></div><div>${jyFmt(r.duration_s)}</div><div>${r.max_scroll}%</div><div>${r.clicks}</div><div>${x.btn}</div></div>`; }).join("");
  const dayKey = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }), todayK = dayKey(Date.now()), yestK = dayKey(Date.now() - 86400000);
  let lastG = "";
  const mob = rows.slice(0, 120).map((r) => {
    const k = dayKey(r.started_at), g = k === todayK ? "Today" : k === yestK ? "Yesterday" : new Date(r.started_at).toLocaleDateString("en-NG", { timeZone: "Africa/Lagos", weekday: "long", day: "numeric", month: "long" });
    const head = g !== lastG ? `<div class="jy-grp">${escH(g.toUpperCase())}</div>` : ""; lastG = g;
    const live = jyLive(r), cls = live ? "live" : r.ordered ? "ord" : "", ic = r.ordered ? "₦" : "▶", dev = r.device === "mobile" ? "Phone" : r.device === "tablet" ? "Tablet" : "Computer";
    const st = live ? '<b class="live">● Live</b>' : r.ordered ? '<b class="ord">Ordered</b>' : `<small>${jyAgo(r.started_at)}</small>`;
    return head + `<div class="jy-r" data-w="${r.id}"><div class="jy-av ${cls}">${ic}</div><div class="jy-rm"><div class="jy-rt">${escH(jySource(r))}</div><div class="jy-rs">${escH(jyWhere(r))} · ${dev}${r.placement ? " · " + escH(jyNice(r.placement)) : ""} · ${jyFmt(r.duration_s)}</div></div><div class="jy-rr">${st}<small>${r.max_scroll}%${r.clicks ? " · " + r.clicks + (r.clicks === 1 ? " tap" : " taps") : ""}</small></div></div>`;
  }).join("");
  list.innerHTML = `<div class="jy-tbl"><div class="jy-tr jy-th"><span>SOURCE AD</span><span>WHERE</span><span>TIME</span><span>SCROLL</span><span>TAPS</span><span></span></div>${desk}</div><div class="jy-m">${mob}</div>`;
  list.querySelectorAll("[data-w]").forEach((b) => (b.onclick = () => jyOpenVisit(b.dataset.w)));
}

// ── What happened: a plain-words timeline built from the recording itself (no AI needed). ──
function jyTimeline(events, s) {
  const out = []; if (!events || events.length < 2) return out;
  const t0 = events[0].timestamp, tEnd = events[events.length - 1].timestamp - t0, at = (e) => Math.max(0, e.timestamp - t0);
  const nodes = new Map();
  const walk = (n, parent) => { if (!n) return; nodes.set(n.id, { n, parent }); (n.childNodes || []).forEach((c) => walk(c, n.id)); };
  events.forEach((e) => { if (e.type === 2 && e.data && e.data.node) walk(e.data.node, null); if (e.type === 3 && e.data && e.data.source === 0) (e.data.adds || []).forEach((a) => walk(a.node, a.parentId)); });
  const textOf = (n, d = 0) => !n || d > 6 ? "" : n.type === 3 ? (n.textContent || "") : (n.childNodes || []).map((c) => textOf(c, d + 1)).join(" ");
  const labelOf = (id) => {
    let cur = nodes.get(id), hops = 0;
    while (cur && hops++ < 7) {
      const n = cur.n, tag = String(n.tagName || "").toLowerCase(), role = n.attributes && n.attributes.role;
      if (tag === "a" || tag === "button" || role === "button" || (tag === "input" && /submit|button/.test(n.attributes && n.attributes.type || ""))) {
        const t = (textOf(n).replace(/\s+/g, " ").trim() || (n.attributes && (n.attributes.value || n.attributes["aria-label"])) || "").slice(0, 32);
        return { text: t, link: tag === "a" };
      }
      cur = cur.parent != null ? nodes.get(cur.parent) : null;
    }
    return null;
  };
  let maxY = 0; events.forEach((e) => { if (e.type === 3 && e.data && e.data.source === 3 && e.data.y > maxY) maxY = e.data.y; });
  const stops = [25, 50, 75, 100], reached = new Set(); let formDone = false, lastTap = -9999, path = null, taps = 0;
  out.push({ t: 0, text: "Opened the page" + (s && s.meta_ad_id ? " from the ad" : "") });
  for (const e of events) {
    if (e.type === 4 && e.data && e.data.href) { try { const p = new URL(e.data.href).pathname; if (path !== null && p !== path) out.push({ t: at(e), text: "Went to " + p }); path = p; } catch (x) {} }
    if (e.type !== 3 || !e.data) continue;
    const d = e.data;
    if (d.source === 3 && maxY > 0 && s) { const pct = Math.min(100, d.y / maxY * (s.max_scroll || 100)); stops.forEach((st) => { if (pct >= st - 0.5 && !reached.has(st) && st <= (s.max_scroll || 100) + 0.5) { reached.add(st); out.push({ t: at(e), text: st === 100 ? "Reached the bottom of the page" : "Scrolled to " + st + "%" }); } }); }
    if (d.source === 2 && (d.type === 2 || d.type === 9) && at(e) - lastTap > 500) {
      lastTap = at(e); taps++; const l = labelOf(d.id);
      if (l && l.text) out.push({ t: at(e), text: "Tapped “" + l.text + "”" + (l.link ? " (link)" : ""), key: true }); else if (taps <= 6) out.push({ t: at(e), text: "Tapped on the page" });
    }
    if (d.source === 5 && !formDone) { formDone = true; out.push({ t: at(e), text: "Started typing in the form (what they typed is never recorded)", key: true }); }
  }
  if (s && s.ordered) out.push({ t: tEnd, text: "Order placed", good: true });
  out.push({ t: tEnd, text: "Left the page after " + jyFmt(tEnd / 1000) });
  out.sort((a, b) => a.t - b.t);
  // scroll steps that happen within two seconds of each other are one scroll: keep only the furthest
  for (let i = out.length - 2; i >= 0; i--) if (/^Scrolled to|^Reached the bottom/.test(out[i].text) && /^Scrolled to|^Reached the bottom/.test(out[i + 1].text) && out[i + 1].t - out[i].t < 2000) out.splice(i, 1);
  return out.filter((x, i) => !(i && out[i - 1].text === x.text && x.t - out[i - 1].t < 1500));
}
function jyLoadScript(src) { return new Promise((res, rej) => { if ([...document.scripts].some((s) => s.src.endsWith(src))) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
function jyDetails(s) {
  const ad = s.meta_ad_id ? escH(JY.names[s.meta_ad_id] || "Ad " + s.meta_ad_id) : "Not from a tracked ad";
  const row = (k, v) => v ? `<span>${k}</span><span>${v}</span>` : "";
  return `<div class="jy-dl">${row("Ad", "<b>" + ad + "</b>")}${row("Meta ad ID", s.meta_ad_id ? escH(s.meta_ad_id) : "")}${row("Campaign", s.meta_campaign_id ? escH(JY.names[s.meta_campaign_id] || s.meta_campaign_id) : "")}
    ${row("Ad set ID", escH(s.meta_adset_id || ""))}${row("Placement", s.placement ? escH(jyNice(s.placement)) : "")}${row("Came from", escH(s.referrer_host || (s.utm_source ? s.utm_source : "Direct")))}
    ${row("Device", jyDev(s.device) + (s.viewport ? " · " + escH(s.viewport) : ""))}${row("Location", escH(jyWhere(s)))}${row("Page", escH((s.host || "") + (s.landing_path || "")))}
    ${row("Visited", new Date(s.started_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }))}${row("Time on page", jyFmt(s.duration_s))}${row("Scrolled", s.max_scroll + "%")}${row("Taps", String(s.clicks))}
    ${row("Order", s.ordered ? '<b style="color:#12843d">Ordered</b>' : "No order")}</div>`;
}
async function jyOpenVisit(id) {
  // Always read the visit fresh: the list on screen can be older than the visit (a recording may have started since).
  const fresh = await sbQuery("site_sessions", `select=*&id=eq.${id}`).catch(() => []);
  const s = (fresh && fresh[0]) || JY.rows.find((r) => r.id === id);
  if (!s) return bvToast("Visit not found.");
  await jyNames([s.meta_ad_id, s.meta_campaign_id]);
  return jyOpenViewer(s);
}


// ── Phone: the replay fills the screen. Tap it for the controls; the (i) button opens the details in a sheet. ──
function jyFsCss() {
  if (document.getElementById("jyFsCss")) return;
  const st = document.createElement("style"); st.id = "jyFsCss";
  st.textContent = `
  .jy-fs{position:fixed!important;inset:0!important;z-index:100001!important;background:#000!important;display:block!important;padding:0!important;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#fff;-webkit-user-select:none;user-select:none;touch-action:manipulation}
  .jy-fs *{box-sizing:border-box}
  .jy-fs .fs-stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#0b0b0a}
  .jy-fs .fs-stage .rr-player{box-shadow:none!important;background:transparent!important;float:none!important}
  .jy-fs .fs-stage .rr-player__frame{background:#fff}
  .jy-fs .fs-ui{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .22s}
  .jy-fs.show .fs-ui{opacity:1}.jy-fs.show .fs-ui>*{pointer-events:auto}
  .jy-fs .glass{background:rgba(48,54,58,.52);-webkit-backdrop-filter:blur(18px) saturate(1.4);backdrop-filter:blur(18px) saturate(1.4);border:1px solid rgba(255,255,255,.16);color:#fff}
  .jy-fs .fs-top{position:absolute;left:0;right:0;top:0;padding:calc(env(safe-area-inset-top,0px) + 12px) 14px 0;display:flex;align-items:center;gap:10px}
  .jy-fs .fs-circle{width:44px;height:44px;border-radius:99px;display:flex;align-items:center;justify-content:center;font-size:20px;cursor:pointer;flex:none}
  .jy-fs .fs-title{flex:1;min-width:0;border-radius:99px;padding:7px 16px;text-align:center;line-height:1.25}
  .jy-fs .fs-title b{display:block;font-size:15px;font-weight:650}.jy-fs .fs-title small{display:block;font-size:12px;opacity:.78}
  .jy-fs .fs-live{display:inline-block;width:7px;height:7px;border-radius:99px;background:#4ade80;margin-right:6px;vertical-align:middle}
  .jy-fs .fs-bot{position:absolute;left:0;right:0;bottom:0;padding:0 14px calc(env(safe-area-inset-bottom,0px) + 14px);display:flex;flex-direction:column;gap:12px}
  .jy-fs .fs-bar{border-radius:99px;display:flex;align-items:center;gap:12px;padding:8px 16px 8px 10px}
  .jy-fs .fs-play{width:38px;height:38px;border-radius:99px;display:flex;align-items:center;justify-content:center;font-size:17px;cursor:pointer;flex:none}
  .jy-fs .fs-track{flex:1;height:30px;position:relative;cursor:pointer;touch-action:none}
  .jy-fs .fs-line{position:absolute;left:0;right:0;top:13px;height:4px;border-radius:3px;background:rgba(255,255,255,.28)}
  .jy-fs .fs-fill{position:absolute;left:0;top:13px;height:4px;border-radius:3px;background:#fff}
  .jy-fs .fs-knob{position:absolute;top:8px;width:14px;height:14px;margin-left:-7px;border-radius:99px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}
  .jy-fs .fs-mk{position:absolute;top:9px;width:6px;height:12px;margin-left:-3px;border-radius:3px;background:#f0a830}.jy-fs .fs-mk.g{background:#4ade80}
  .jy-fs .fs-time{font-size:12px;font-variant-numeric:tabular-nums;opacity:.9;flex:none;min-width:70px;text-align:right}
  .jy-fs .fs-acts{align-self:center;border-radius:99px;display:flex;align-items:center;padding:4px 8px;gap:4px}
  .jy-fs .fs-act{height:44px;min-width:52px;padding:0 14px;border-radius:99px;display:flex;align-items:center;justify-content:center;gap:6px;font-size:14px;font-weight:600;cursor:pointer;color:#fff}
  .jy-fs .fs-act.on{background:rgba(255,255,255,.2)}
  .jy-fs .fs-note{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;padding:18px 22px;max-width:80%;font-size:15px;line-height:1.45;color:#cfd3d6;pointer-events:none}
  .jy-fs .fs-menu{position:absolute;right:14px;top:calc(env(safe-area-inset-top,0px) + 64px);border-radius:16px;padding:6px;min-width:210px;display:none}
  .jy-fs .fs-menu.open{display:block}.jy-fs .fs-menu div{padding:12px 14px;font-size:15px;border-radius:10px;display:flex;justify-content:space-between;cursor:pointer}.jy-fs .fs-menu div:active{background:rgba(255,255,255,.14)}
  .jy-fs .fs-scrim{position:absolute;inset:0;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .22s}.jy-fs.sheet .fs-scrim{opacity:1;pointer-events:auto}
  .jy-fs .fs-sheet{position:absolute;left:0;right:0;bottom:0;height:72%;background:#faf9f7;color:#14130f;border-radius:22px 22px 0 0;transform:translateY(102%);transition:transform .28s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column;padding-bottom:env(safe-area-inset-bottom,0px)}
  .jy-fs.sheet .fs-sheet{transform:none}
  .jy-fs .sh-grab{width:38px;height:5px;border-radius:3px;background:#d6d1c4;margin:8px auto 4px;flex:none}
  .jy-fs .sh-head{display:flex;align-items:center;padding:4px 18px 8px;flex:none}.jy-fs .sh-head b{flex:1;font-size:18px;font-weight:700;letter-spacing:-.01em}
  .jy-fs .sh-x{width:32px;height:32px;border-radius:99px;background:#efece5;display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer}
  .jy-fs .sh-seg{display:flex;gap:2px;background:#efece5;border-radius:10px;padding:3px;margin:0 18px 10px;flex:none}
  .jy-fs .sh-seg div{flex:1;text-align:center;font-size:14px;font-weight:600;padding:8px 0;border-radius:8px;color:#55524a;cursor:pointer}.jy-fs .sh-seg div.on{background:#fff;color:#14130f;box-shadow:0 1px 2px rgba(0,0,0,.12)}
  .jy-fs .sh-body{flex:1;overflow:auto;padding:2px 18px 18px;-webkit-overflow-scrolling:touch}
  .jy-fs .sh-story{font-size:15px;line-height:1.45;margin:2px 0 14px}
  .jy-fs .sh-grp{background:#fff;border:1px solid #e7e3da;border-radius:14px;margin-bottom:12px;overflow:hidden}
  .jy-fs .sh-row{display:flex;gap:12px;padding:12px 14px;border-bottom:1px solid #f0ede6;font-size:14.5px}.jy-fs .sh-row:last-child{border-bottom:0}
  .jy-fs .sh-row span:first-child{color:#8c887c;width:96px;flex:none}.jy-fs .sh-row span:last-child{flex:1;text-align:right;word-break:break-word;font-weight:500}
  .jy-fs .sh-ev{display:flex;gap:12px;padding:13px 4px;border-bottom:1px solid #f0ede6;font-size:15px;align-items:flex-start}.jy-fs .sh-ev b{width:40px;flex:none;color:#0c5dc7;font-variant-numeric:tabular-nums}
  .jy-fs.desk .fs-stage{right:380px}.jy-fs.desk .fs-top,.jy-fs.desk .fs-bot{right:380px}.jy-fs.desk .fs-top{justify-content:flex-start}.jy-fs.desk .fs-title{flex:none;padding:7px 18px}.jy-fs.desk #fsMore{margin-left:auto}
  .jy-fs.desk .fs-bot{align-items:center}.jy-fs.desk .fs-bar{width:540px;max-width:100%}.jy-fs.desk .fs-acts,.jy-fs.desk .fs-scrim,.jy-fs.desk .sh-grab{display:none!important}
  .jy-fs.desk .fs-sheet{top:0;left:auto;width:380px;height:100%;border-radius:0;transform:none;border-left:1px solid #e7e3da}.jy-fs.desk .fs-menu{right:394px}
  .jy-fs.desk .fs-circle,.jy-fs.desk .fs-act,.jy-fs.desk .fs-play,.jy-fs.desk .sh-x,.jy-fs.desk .sh-seg div,.jy-fs.desk .sh-ev{cursor:pointer}
  .jy-fs .sh-ev.key span{font-weight:650}.jy-fs .sh-ev.good span{color:#1a8f4c;font-weight:700}`;
  document.head.appendChild(st);
}
function jyStory(s, tl) {
  const src = s.meta_ad_id ? "the ad “" + (JY.names[s.meta_ad_id] || s.meta_ad_id) + "”" : (s.referrer_host ? s.referrer_host : "a direct link");
  const dev = ({ mobile: "a phone", tablet: "a tablet", desktop: "a computer" })[s.device] || "a device", where = jyWhere(s) !== "Location unknown" ? " in " + jyWhere(s) : "";
  const tap = (tl || []).find((e) => e.key && /^Tapped “/.test(e.text)), t = tap ? tap.text.replace(/^Tapped /, "tapped ").replace(/ \(link\)$/, "") : s.clicks ? "tapped " + s.clicks + (s.clicks === 1 ? " time" : " times") : "did not tap anything";
  return `Came from ${src} on ${dev}${where}. Stayed ${jyFmt(s.duration_s)}, scrolled ${s.max_scroll}%, ${t}, ${s.ordered ? "and placed an order." : "and left without ordering."}`;
}
async function jyOpenViewer(s0) {
  jyFsCss();
  let s = s0, events = [], tl = [], player = null, playing = true, follow = true, skip = true, speed = 1, total = 1, timers = [], sheetTab = "details", hideT = null, userSeek = false;
  const ov = document.createElement("div"); const desk = !window.matchMedia("(max-width:700px)").matches;
  ov.id = "jyFs"; ov.className = "bv-overlay jy-fs show" + (desk ? " desk sheet" : "");
  const marker = (e) => `<i class="fs-mk${e.good || /form/i.test(e.text) ? " g" : ""}" style="left:${Math.min(100, e.t / Math.max(1, total) * 100)}%"></i>`;
  ov.innerHTML = `<div class="fs-stage" id="fsStage"><div class="fs-note" id="fsNote">${s.has_recording ? "Loading the recording…" : "No recording for this visit."}</div></div>
    <div class="fs-ui"><div class="fs-top"><div class="fs-circle glass" id="fsBack" aria-label="Back">‹</div><div class="fs-title glass"><b>Visit #${s.visit_no}</b><small id="fsSub"></small></div><div class="fs-circle glass" id="fsMore" aria-label="More">•••</div></div>
      <div class="fs-menu glass" id="fsMenu"><div id="mSpeed"><span>Speed</span><span id="mSpeedV">1x</span></div><div id="mSkip"><span>Skip quiet parts</span><span id="mSkipV">On</span></div><div id="mFollow" style="display:none"><span>Follow live</span><span id="mFollowV">On</span></div></div>
      <div class="fs-bot"><div class="fs-bar glass"><div class="fs-play" id="fsPlay">❚❚</div><div class="fs-track" id="fsTrack"><div class="fs-line"></div><div class="fs-fill" id="fsFill"></div><div id="fsMarks"></div><div class="fs-knob" id="fsKnob"></div></div><div class="fs-time" id="fsTime">0:00 / 0:00</div></div>
        <div class="fs-acts glass"><div class="fs-act" id="aTl">☰ <span>Timeline</span></div><div class="fs-act" id="aInfo">ⓘ <span>Details</span></div></div></div></div>
    <div class="fs-scrim" id="fsScrim"></div>
    <div class="fs-sheet" id="fsSheet"><div class="sh-grab"></div><div class="sh-head"><b>Visit #${s.visit_no}</b><div class="sh-x" id="shX">✕</div></div><div class="sh-seg"><div id="tabD" class="on">Details</div><div id="tabT">Timeline</div></div><div class="sh-body" id="shBody"></div></div>`;
  document.body.appendChild(ov);
  const $ = (id) => ov.querySelector("#" + id);
  const close = () => { timers.forEach(clearInterval); try { player && player.pause(); } catch (e) {} ov.remove(); };
  const clock = (ms) => jyClock(ms);
  // controls show on tap and hide by themselves while playing
  const showUi = (stay) => { ov.classList.add("show"); clearTimeout(hideT); if (!stay && playing && !ov.classList.contains("sheet")) hideT = setTimeout(() => { ov.classList.remove("show"); $("fsMenu").classList.remove("open"); }, 3200); };
  $("fsStage").addEventListener("click", () => { if (ov.classList.contains("sheet")) return; if (ov.classList.contains("show")) { ov.classList.remove("show"); $("fsMenu").classList.remove("open"); } else showUi(); });
  $("fsBack").onclick = (e) => { e.stopPropagation(); close(); };
  $("fsMore").onclick = (e) => { e.stopPropagation(); $("fsMenu").classList.toggle("open"); };
  // sheet
  const details = () => {
    const ad = s.meta_ad_id ? escH(JY.names[s.meta_ad_id] || "Ad " + s.meta_ad_id) : "Not from a tracked ad", row = (k, v) => v ? `<div class="sh-row"><span>${k}</span><span>${v}</span></div>` : "";
    return `<div class="sh-story">${escH(jyStory(s, tl))}</div>
      <div class="sh-grp">${row("Ad", ad)}${row("Meta ad ID", s.meta_ad_id ? escH(s.meta_ad_id) : "")}${row("Campaign", s.meta_campaign_id ? escH(JY.names[s.meta_campaign_id] || s.meta_campaign_id) : "")}${row("Placement", s.placement ? escH(jyNice(s.placement)) : "")}${row("Came from", escH(s.referrer_host || (s.utm_source || "Direct")))}</div>
      <div class="sh-grp">${row("Device", jyDev(s.device) + (s.viewport ? " · " + escH(s.viewport) : ""))}${row("Location", escH(jyWhere(s)))}${row("Page", escH((s.host || "") + (s.landing_path || "")))}${row("Visited", new Date(s.started_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }))}</div>
      <div class="sh-grp">${row("Time on page", jyFmt(s.duration_s))}${row("Scrolled", s.max_scroll + "%")}${row("Taps", String(s.clicks))}${row("Order", s.ordered ? "Ordered" : "No order")}</div>`;
  };
  const timeline = () => tl.length ? tl.map((e, i) => `<div class="sh-ev${e.key ? " key" : ""}${e.good ? " good" : ""}" data-i="${i}"><b>${clock(e.t)}</b><span>${escH(e.text)}</span></div>`).join("") : '<div style="color:#8c887c;padding:14px 4px">Nothing was recorded.</div>';
  const drawSheet = () => {
    $("tabD").classList.toggle("on", sheetTab === "details"); $("tabT").classList.toggle("on", sheetTab === "timeline");
    $("shBody").innerHTML = sheetTab === "details" ? details() : timeline();
    $("shBody").querySelectorAll("[data-i]").forEach((el) => (el.onclick = () => { try { player.goto(Math.max(0, tl[Number(el.dataset.i)].t - 500), true); } catch (x) {} closeSheet(); }));
  };
  const openSheet = (tab) => { sheetTab = tab; drawSheet(); ov.classList.add("sheet", "show"); clearTimeout(hideT); };
  const closeSheet = () => { if (desk) { showUi(true); return; } ov.classList.remove("sheet"); showUi(); };
  $("aInfo").onclick = (e) => { e.stopPropagation(); openSheet("details"); }; $("aTl").onclick = (e) => { e.stopPropagation(); openSheet("timeline"); };
  $("shX").onclick = desk ? close : closeSheet; $("fsScrim").onclick = closeSheet; $("tabD").onclick = () => { sheetTab = "details"; drawSheet(); }; $("tabT").onclick = () => { sheetTab = "timeline"; drawSheet(); };
  // menu
  $("mSpeed").onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; $("mSpeedV").textContent = speed + "x"; try { player.setSpeed(speed); } catch (e) {} };
  $("mSkip").onclick = () => { skip = !skip; $("mSkipV").textContent = skip ? "On" : "Off"; try { player.toggleSkipInactive(); } catch (e) {} };
  $("mFollow").onclick = () => { follow = !follow; $("mFollowV").textContent = follow ? "On" : "Off"; };
  const subline = () => { $("fsSub").innerHTML = (jyLive(s) ? '<i class="fs-live"></i>Live · ' : "") + new Date(s.started_at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" }) + " · " + escH(jyWhere(s)); };
  subline();
  if (desk) drawSheet();
  if (!s.has_recording) { ov.classList.add("show"); $("fsPlay").style.display = "none"; $("fsTrack").style.display = "none"; $("fsTime").style.display = "none"; return; }
  try {
    if (!document.getElementById("jyPlayerCss")) { const l = document.createElement("link"); l.id = "jyPlayerCss"; l.rel = "stylesheet"; l.href = "/rv/rrweb-player.css"; document.head.appendChild(l); }
    await jyLoadScript("/rv/rrweb-player.min.js");
    const res = await sbFn("ads-manager", { action: "rec_get", session_id: s.id });
    if (!document.getElementById("jyFs")) return;
    if (res.session) s = { ...s, ...res.session };
    events = res.events || [];
    if (events.length < 2) { $("fsNote").textContent = res.note || "This recording is empty or too short to play."; ov.classList.add("show"); return; }
    if (!events.some((e) => e.type === 2)) { tl = jyTimeline(events, s); $("fsNote").textContent = "The picture of the page was not saved for this visit, so there is nothing to draw. The details and the timeline are in the sheet."; ov.classList.add("show"); $("fsPlay").style.display = "none"; $("fsTrack").style.display = "none"; $("fsTime").style.display = "none"; return; }
    $("fsNote").remove(); tl = jyTimeline(events, s);
    const vp = String(s.viewport || "375x667").split("x"), vw = Number(vp[0]) || 375, vh = Number(vp[1]) || 667;
    const P = typeof window.rrwebPlayer === "function" ? window.rrwebPlayer : (window.rrwebPlayer.default || window.rrwebPlayer.Player);
    const mount = (evs, at) => {
      const stage = $("fsStage"); stage.innerHTML = '<div id="fsHost"></div>';
      const W = window.innerWidth - (desk ? 380 : 0), H = window.innerHeight, k = Math.min(W / vw, H / vh), width = Math.round(vw * k), height = Math.round(vh * k);
      player = new P({ target: $("fsHost"), props: { events: evs, width, height, autoPlay: true, skipInactive: skip, showController: false, speed } });
      try { player.addEventListener("ui-update-player-state", (ev) => { playing = ev.payload === "playing"; $("fsPlay").textContent = playing ? "❚❚" : "▶"; if (!playing) showUi(true); }); } catch (e) {}
      total = Math.max(1, evs[evs.length - 1].timestamp - evs[0].timestamp);
      if (at != null) try { player.goto(at, true); } catch (e) {}
      $("fsMarks").innerHTML = tl.filter((e) => e.key || e.good).map(marker).join("");
    };
    mount(events);
    const fmtTime = () => { let cur = 0; try { cur = player.getReplayer().getCurrentTime(); } catch (e) {} const c = Math.min(total, cur), pct = c / total * 100; $("fsFill").style.width = pct + "%"; $("fsKnob").style.left = pct + "%"; $("fsTime").textContent = clock(c) + " / " + clock(total); };
    timers.push(setInterval(fmtTime, 200));
    $("fsPlay").onclick = (e) => { e.stopPropagation(); try { player.toggle(); } catch (x) {} showUi(); };
    // scrub with a finger or the mouse
    const seekTo = (clientX) => { const r = $("fsTrack").getBoundingClientRect(), f = Math.max(0, Math.min(1, (clientX - r.left) / r.width)); try { player.goto(f * total, playing); } catch (e) {} fmtTime(); };
    $("fsTrack").addEventListener("pointerdown", (e) => { e.stopPropagation(); userSeek = true; clearTimeout(hideT); try { $("fsTrack").setPointerCapture(e.pointerId); } catch (x) {} seekTo(e.clientX); });
    $("fsTrack").addEventListener("pointermove", (e) => { if (userSeek) seekTo(e.clientX); });
    $("fsTrack").addEventListener("pointerup", () => { userSeek = false; showUi(); });
    $("fsTrack").addEventListener("pointercancel", () => { userSeek = false; });
    showUi();
    if (jyLive(s)) {
      $("mFollow").style.display = "";
      let last = events.length, busy = false;
      timers.push(setInterval(async () => {
        if (!document.getElementById("jyFs")) return; if (busy || userSeek) return; busy = true;
        try {
          const more = await sbFn("ads-manager", { action: "rec_get", session_id: s.id });
          if (more && more.events && more.events.length > last) {
            last = more.events.length; events = more.events; if (more.session) s = { ...s, ...more.session };
            tl = jyTimeline(events, s); subline();
            if (follow) mount(events, Math.max(0, events[events.length - 1].timestamp - events[0].timestamp - 3000));
            if (ov.classList.contains("sheet")) drawSheet();
          } else if (more && more.session && !jyLive(more.session)) { s = { ...s, ...more.session }; subline(); $("mFollow").style.display = "none"; }
        } catch (x) {} finally { busy = false; }
      }, 5000));
    }
  } catch (e) { const n = ov.querySelector("#fsNote"); if (n) n.textContent = "Could not load the recording: " + (e.message || e); ov.classList.add("show"); }
}

// ── Per ad: a small chip on each ad in the campaign screen, opening that ad's own visits. ──
async function jyCountsLoad() {
  if (JYC.loading) return; JYC.loading = true;
  try {
    const rows = await sbQuery("site_sessions", `select=meta_ad_id,meta_adset_id,meta_campaign_id,ordered&meta_ad_id=not.is.null&started_at=gte.${new Date(Date.now() - 60 * 86400000).toISOString()}&limit=5000`).catch(() => []);
    const m = {}; (rows || []).forEach((r) => { [r.meta_ad_id, r.meta_adset_id, r.meta_campaign_id].filter(Boolean).forEach((k) => { const x = m[k] || (m[k] = { n: 0, o: 0 }); x.n++; if (r.ordered) x.o++; }); });
    JYC.map = m; JYC.loaded = true;
  } finally { JYC.loading = false; }
}
function jyChip(adId, always) {
  jyCss();
  const c = JYC.map[adId];
  if (!c) return always && JYC.loaded ? `<button type="button" class="jy-chipbtn mute" onclick="event.stopPropagation();jyAdPanel('${adId}')">▶ No visits yet</button>` : "";
  return `<button type="button" class="jy-chipbtn" onclick="event.stopPropagation();jyAdPanel('${adId}')">▶ ${c.n} visit${c.n === 1 ? "" : "s"}${c.o ? " · " + c.o + " ordered" : ""}</button>`;
}
async function jyAdPanel(adId, nameHint) {
  jyCss();
  document.getElementById("jyAdOv")?.remove();
  const ov = document.createElement("div"); ov.id = "jyAdOv"; ov.className = "bv-overlay jy-ad";
  ov.innerHTML = `<div class="ad-sheet"><div class="ad-grab"></div><div class="ad-head"><div style="flex:1;min-width:0"><b id="adT">${escH(nameHint || "Visitors")}</b><small>Visitors from this ad</small></div><div class="ad-x" id="adX">✕</div></div>
    <div class="ad-stats" id="adStats"></div><div class="ad-seg" id="adSeg"></div><div class="ad-list" id="adList"><div class="ad-empty"><span class="spin"></span></div></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove(); ov.querySelector("#adX").onclick = close; ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  const rows = (await sbQuery("site_sessions", `select=*&or=(meta_ad_id.eq.${encodeURIComponent(adId)},meta_adset_id.eq.${encodeURIComponent(adId)},meta_campaign_id.eq.${encodeURIComponent(adId)})&order=started_at.desc&limit=200`).catch(() => [])) || [];
  await jyNames([adId]); rows.forEach((r) => { if (!JY.rows.some((x) => x.id === r.id)) JY.rows.push(r); });
  if (!document.getElementById("jyAdOv")) return;
  ov.querySelector("#adT").textContent = JY.names[adId] || nameHint || "Ad " + adId;
  const ord = rows.filter((r) => r.ordered).length, avg = rows.length ? rows.reduce((a, r) => a + (r.duration_s || 0), 0) / rows.length : 0, left = rows.filter((r) => (r.duration_s || 0) < 10);
  ov.querySelector("#adStats").innerHTML = `<div class="ad-st"><small>Visits</small><b>${rows.length}</b></div><div class="ad-st"><small>Avg time</small><b>${jyFmt(avg)}</b></div><div class="ad-st"><small>Ordered</small><b>${ord}${rows.length ? ` <em>${(ord / rows.length * 100).toFixed(0)}%</em>` : ""}</b></div>`;
  if (!rows.length) { ov.querySelector("#adSeg").style.display = "none"; ov.querySelector("#adList").innerHTML = '<div class="ad-empty"><b style="display:block;color:#14130f;margin-bottom:6px">No tracked visits yet</b>Only ads launched by Revora carry the tracking. Visits from this ad appear here a minute after someone clicks it.</div>'; return; }
  let f = "all";
  const draw = () => {
    ov.querySelector("#adSeg").innerHTML = [["all", "All " + rows.length], ["ord", "Ordered " + ord], ["left", "Left fast " + left.length]].map(([k, l]) => `<div class="${f === k ? "on" : ""}" data-k="${k}">${l}</div>`).join("");
    ov.querySelectorAll("#adSeg [data-k]").forEach((b) => (b.onclick = () => { f = b.dataset.k; draw(); }));
    const show = rows.filter((r) => f === "all" || (f === "ord" && r.ordered) || (f === "left" && (r.duration_s || 0) < 10));
    ov.querySelector("#adList").innerHTML = show.length ? show.map((r) => { const live = jyLive(r), cls = live ? "live" : r.ordered ? "ord" : "", st = live ? '<b class="live">● Live</b>' : r.ordered ? '<b class="ord">Ordered</b>' : `<small>${jyAgo(r.started_at)}</small>`;
      return `<div class="jy-r" data-w="${r.id}"><div class="jy-av ${cls}">${r.ordered ? "₦" : "▶"}</div><div class="jy-rm"><div class="jy-rt">Visit #${r.visit_no}</div><div class="jy-rs">${escH(jyWhere(r))} · ${r.device === "mobile" ? "Phone" : "Computer"}${r.placement ? " · " + escH(jyNice(r.placement)) : ""} · ${jyFmt(r.duration_s)}</div></div><div class="jy-rr">${st}<small>${r.max_scroll}%</small></div></div>`; }).join("") : '<div class="ad-empty">Nothing in this group.</div>';
    ov.querySelectorAll("#adList [data-w]").forEach((b) => (b.onclick = () => jyOpenVisit(b.dataset.w)));
  };
  draw();
}

// ── Websites outside Revora (and product websites): a project id and the one-line script. ──
const jyScriptLine = (p) => `<script async src="${/^https:\/\/(localhost|127\.)/.test(location.origin) ? "https://metaautomationads.vercel.app" : location.origin}/rv/rec.js" data-project="${p.public_id}"></script>`;
const jyDomain = (u) => String(u || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[\/?#].*$/, "");
async function jyEnsureProject(name, url) {
  const dom = jyDomain(url); if (!dom) throw new Error("Add the website address first.");
  const have = (await sbQuery("rec_projects", "select=*&order=created_at.desc").catch(() => [])) || [];
  let p = have.find((x) => (x.domains || []).map(jyDomain).includes(dom));
  if (p) return p;
  const prof = window.myProfile;
  const res = await fetch(`${SUPA_URL}/rest/v1/rec_projects`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${sessionData?.access_token || ANON}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ name: name || dom, domains: [dom], company_id: prof.company_id, created_by: prof.id }) });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json())[0];
}
async function jyScriptSheet(p) {
  jyCss();
  bvOpenSheet("jyScript", `<div class="jy"><div class="jy-sheetbar"><b>Tracking script</b><button class="jy-x" data-sheet-close onclick="bvCloseSheet('jyScript')" aria-label="Close">✕</button></div><div style="padding:6px 18px 18px">
    <div class="jy-box"><h4><span>${escH(p.name)} · ${escH((p.domains || []).join(", ") || "any website")}</span></h4>
    <div style="font-size:13px;color:var(--jm);line-height:1.45">Paste this inside the &lt;head&gt; of your website, once. Revora then records visits and links them to your Revora ads. Typed text is never recorded.</div>
    <div class="jy-code" id="jyLine">${escH(jyScriptLine(p))}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="jy-btn" id="jyCopy">Copy script</button><a class="jy-btn2" style="text-decoration:none" href="mailto:?subject=${encodeURIComponent("Please add this line to our website")}&body=${encodeURIComponent("Please paste this inside the <head> of our website:\n\n" + jyScriptLine(p))}">Send to my developer</a></div></div>
    <div class="jy-box" style="margin-top:12px;display:flex;align-items:center;gap:12px"><span id="jyDot" style="width:12px;height:12px;border-radius:99px;background:#c4cdd5"></span><div style="flex:1" id="jyDet">Checking…</div><button class="jy-btn2" id="jyChk">Check again</button></div></div></div>`, 640);
  document.getElementById("jyCopy").onclick = () => { navigator.clipboard?.writeText(jyScriptLine(p)).then(() => bvToast("Script copied.")).catch(() => bvToast("Select the text and copy it.")); };
  const check = async () => {
    const r = await sbQuery("site_sessions", `select=started_at,host&project_id=eq.${p.id}&order=started_at.desc&limit=1`).catch(() => []);
    const d = document.getElementById("jyDet"), dot = document.getElementById("jyDot"); if (!d) return;
    if (r && r[0]) { dot.style.background = "#12843d"; d.innerHTML = `<b>Script detected</b><div style="color:var(--jm);font-size:12px;margin-top:2px">Last visit ${jyAgo(r[0].started_at)} from ${escH(r[0].host || "your website")}</div>`; }
    else { dot.style.background = "#c4cdd5"; d.innerHTML = `<b>Waiting for the first visit</b><div style="color:var(--jm);font-size:12px;margin-top:2px">Add the script, then open your website once.</div>`; }
  };
  document.getElementById("jyChk").onclick = check; check();
}
function jySetup() {
  jyCss();
  const old = JY.projects.map((p, i) => `<div class="jy-box" style="margin-bottom:10px;display:flex;gap:10px;align-items:center"><div style="flex:1;min-width:0"><b>${escH(p.name)}</b><div style="color:var(--jm);font-size:12px">${escH((p.domains || []).join(", ") || "any website")}</div></div><button class="jy-btn soft" data-p="${i}">Get script</button></div>`).join("");
  bvOpenSheet("jySetupSheet", `<div class="jy"><div class="jy-sheetbar"><b>Connect a website</b><button class="jy-x" data-sheet-close onclick="bvCloseSheet('jySetupSheet')" aria-label="Close">✕</button></div><div style="padding:6px 18px 18px">
    <div style="font-size:13px;color:var(--jm);margin-bottom:12px;line-height:1.45">For websites not built in Revora. Pages built in Revora are tracked automatically.</div>${old}
    <div class="jy-box"><h4><span>NEW WEBSITE</span></h4><input id="jyName" class="jy-in" placeholder="Name (for example My store)"><input id="jyDom" class="jy-in" placeholder="Website address (for example www.me.com)"><button class="jy-btn" id="jyMk">Create script</button></div></div></div>`, 600);
  document.querySelectorAll("#jySetupSheet [data-p]").forEach((b) => (b.onclick = () => { bvCloseSheet("jySetupSheet"); jyScriptSheet(JY.projects[Number(b.dataset.p)]); }));
  document.getElementById("jyMk").onclick = async () => {
    try { const p = await jyEnsureProject(document.getElementById("jyName").value.trim(), document.getElementById("jyDom").value); bvCloseSheet("jySetupSheet"); jyScriptSheet(p); if (document.getElementById("jyList")) jyLoad(); }
    catch (e) { bvToast("Could not create: " + (e.message || e)); }
  };
}
// Used by the product screen: make the script for the product's website address.
async function jyProductScript(name, url) { try { jyScriptSheet(await jyEnsureProject(name, url)); } catch (e) { bvToast(e.message || "Could not create the script."); } }
