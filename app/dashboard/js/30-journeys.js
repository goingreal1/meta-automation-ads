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
}
function jyRange() { return new Date(Date.now() - JY.days * 86400000).toISOString(); }
async function renderJourneys(c) {
  jyCss();
  c.innerHTML = `<div class="rv-ui jy"><div class="jy-head"><div><h2>Journeys</h2><div class="sub">Every visit to your pages, traced back to the Meta ad. Recordings are kept 60 days. Typed text is never recorded.</div></div>
    <select class="jy-sel" id="jyDays"><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="60">Last 60 days</option></select>
    <button class="jy-btn" id="jySetup">+ Connect a website</button></div>
    <div class="jy-tiles" id="jyTiles"></div><div class="jy-chips" id="jyTop"></div><div id="jyList"><div class="jy-empty"><span class="spin"></span> Loading…</div></div></div>`;
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
  const mob = rows.slice(0, 100).map((r) => { const x = jyRowHtml(r);
    return `<div class="jy-card"><div style="display:flex;gap:10px;align-items:flex-start"><div class="jy-nm" style="flex:1;min-width:0"><b style="font-size:14px;display:block">${escH(jySource(r))}${x.pills}</b>
      <small style="color:var(--jm);font-size:12px">Visit #${r.visit_no} · ${jyAgo(r.started_at)}${x.pl}</small></div>${x.btn}</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--jm)"><span>${escH(jyWhere(r))}</span><span>${jyDev(r.device)}</span><span>${jyFmt(r.duration_s)}</span><span>${r.max_scroll}% scroll</span><span>${r.clicks} taps</span></div></div>`; }).join("");
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
  let s = JY.rows.find((r) => r.id === id);
  if (!s) { const g = await sbQuery("site_sessions", `select=*&id=eq.${id}`).catch(() => []); s = g && g[0]; }
  if (!s) return bvToast("Visit not found.");
  await jyNames([s.meta_ad_id, s.meta_campaign_id]);
  const ov = bvOpenSheet("jyVisit", `<div class="jy"><div class="jy-sheetbar"><span style="color:var(--jb);font-weight:600;font-size:13px;cursor:pointer" onclick="bvCloseSheet('jyVisit')">‹ Back</span><b>Visit #${s.visit_no}</b>${s.ordered ? '<span class="jy-pill ord">ORDERED</span>' : ""}${jyLive(s) ? '<span class="jy-pill live">LIVE</span>' : ""}<button class="jy-x" data-sheet-close onclick="bvCloseSheet('jyVisit')" aria-label="Close">✕</button></div>
    <div class="jy-grid"><div><div class="jy-stage" id="jyStage"><div class="jy-empty" style="color:#9fb3c4">${s.has_recording ? '<span class="spin"></span> Loading the recording…' : "No recording for this visit."}</div></div></div>
    <div style="display:flex;flex-direction:column;gap:12px"><div class="jy-box"><h4><span>WHERE THEY CAME FROM</span></h4>${jyDetails(s)}</div>
    <div class="jy-box"><h4><span>WHAT HAPPENED</span><a style="color:var(--jb);cursor:pointer;font-weight:600" id="jyTlToggle">Hide ▴</a></h4><div class="jy-tl" id="jyTl"><span style="color:var(--jm)">${s.has_recording ? "Reading the recording…" : "No recording, so no step-by-step."}</span></div></div></div></div></div>`, 1040);
  if (ov) ov.classList.add("jy-ov");
  if (!s.has_recording) return;
  try {
    if (!document.getElementById("jyPlayerCss")) { const l = document.createElement("link"); l.id = "jyPlayerCss"; l.rel = "stylesheet"; l.href = "/rv/rrweb-player.css"; document.head.appendChild(l); }
    await jyLoadScript("/rv/rrweb-player.min.js");
    const res = await sbFn("ads-manager", { action: "rec_get", session_id: id });
    const stage = document.getElementById("jyStage"); if (!stage) return;
    if (!res.events || res.events.length < 2) { stage.innerHTML = `<div class="jy-empty" style="color:#9fb3c4">${escH(res.note || "This recording is empty or too short to play.")}</div>`; document.getElementById("jyTl").textContent = "Nothing was recorded."; return; }
    stage.innerHTML = '<div id="jyPlayer"></div>';
    const avail = Math.max(260, (stage.clientWidth || 480) - 24), vp = String(res.session?.viewport || "390x800").split("x"), vw = Number(vp[0]) || 390, vh = Number(vp[1]) || 800, ratio = vh / vw;
    const width = ratio > 1.1 ? Math.min(avail, 340) : avail, height = Math.min(520, Math.round(width * ratio));
    const P = typeof window.rrwebPlayer === "function" ? window.rrwebPlayer : (window.rrwebPlayer.default || window.rrwebPlayer.Player);
    const player = new P({ target: document.getElementById("jyPlayer"), props: { events: res.events, width, height, autoPlay: true, skipInactive: true } });
    const tl = jyTimeline(res.events, res.session || s), box = document.getElementById("jyTl");
    box.innerHTML = tl.map((e, i) => `<div class="jy-ev${e.good ? " good" : ""}" data-i="${i}"><b>${jyClock(e.t)}</b><span>${escH(e.text)}</span></div>`).join("");
    box.querySelectorAll(".jy-ev").forEach((el) => (el.onclick = () => { try { player.goto(Math.max(0, tl[Number(el.dataset.i)].t - 500), true); } catch (x) {} }));
    document.getElementById("jyTlToggle").onclick = () => { const h = box.style.display === "none"; box.style.display = h ? "" : "none"; document.getElementById("jyTlToggle").textContent = h ? "Hide ▴" : "Show ▾"; };
  } catch (e) { const b = document.getElementById("jyStage"); if (b) b.innerHTML = `<div class="jy-empty" style="color:#9fb3c4">Could not load the recording: ${escH(e.message || e)}</div>`; }
}

// ── Per ad: a small chip on each ad in the campaign screen, opening that ad's own visits. ──
async function jyCountsLoad() {
  if (JYC.loading) return; JYC.loading = true;
  try {
    const rows = await sbQuery("site_sessions", `select=meta_ad_id,ordered&meta_ad_id=not.is.null&started_at=gte.${new Date(Date.now() - 60 * 86400000).toISOString()}&limit=5000`).catch(() => []);
    const m = {}; (rows || []).forEach((r) => { const x = m[r.meta_ad_id] || (m[r.meta_ad_id] = { n: 0, o: 0 }); x.n++; if (r.ordered) x.o++; });
    JYC.map = m; JYC.loaded = true;
  } finally { JYC.loading = false; }
}
function jyChip(adId) {
  const c = JYC.map[adId]; if (!c) return "";
  return `<button type="button" class="jy-chipbtn" onclick="event.stopPropagation();jyAdPanel('${adId}')">▶ ${c.n} visit${c.n === 1 ? "" : "s"}${c.o ? " · " + c.o + " ordered" : ""}</button>`;
}
async function jyAdPanel(adId, nameHint) {
  jyCss();
  bvOpenSheet("jyAd", `<div class="jy"><div class="jy-sheetbar"><div style="flex:1;min-width:0"><b id="jyAdT">${escH(nameHint || "Ad visits")}</b><div class="sub" id="jyAdS">Loading…</div></div><button class="jy-x" data-sheet-close onclick="bvCloseSheet('jyAd')" aria-label="Close">✕</button></div>
    <div style="padding:6px 18px 18px"><div class="jy-chips" id="jyAdF"></div><div id="jyAdL"><div class="jy-empty"><span class="spin"></span></div></div></div></div>`, 720);
  const rows = await sbQuery("site_sessions", `select=*&meta_ad_id=eq.${encodeURIComponent(adId)}&order=started_at.desc&limit=200`).catch(() => []);
  await jyNames([adId]); rows.forEach((r) => { if (!JY.rows.some((x) => x.id === r.id)) JY.rows.push(r); });
  const t = document.getElementById("jyAdT"); if (!t) return; t.textContent = JY.names[adId] || nameHint || "Ad " + adId;
  const ord = rows.filter((r) => r.ordered).length, avg = rows.length ? rows.reduce((a, r) => a + (r.duration_s || 0), 0) / rows.length : 0;
  document.getElementById("jyAdS").textContent = rows.length ? `${rows.length} visits from this ad · avg ${jyFmt(avg)} · ${(ord / rows.length * 100).toFixed(0)}% ordered` : "No tracked visits yet. Only ads launched by Revora carry tracking.";
  let f = "all";
  const draw = () => {
    const fl = document.getElementById("jyAdF"), li = document.getElementById("jyAdL"); if (!fl) return;
    const left = rows.filter((r) => (r.duration_s || 0) < 10);
    fl.innerHTML = [["all", "All " + rows.length], ["ord", "Ordered " + ord], ["left", "Left fast " + left.length]].map(([k, l]) => `<button class="jy-chip${f === k ? " on" : ""}" data-k="${k}">${l}</button>`).join("");
    fl.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { f = b.dataset.k; draw(); }));
    const show = rows.filter((r) => f === "all" || (f === "ord" && r.ordered) || (f === "left" && (r.duration_s || 0) < 10));
    li.innerHTML = show.length ? show.map((r) => `<div style="display:flex;gap:12px;align-items:center;padding:12px 0;border-top:1px solid #eef1f4;font-size:13px"><div style="flex:1;min-width:0"><b>Visit #${r.visit_no}${jyLive(r) ? '<span class="jy-pill live">LIVE</span>' : ""}${r.ordered ? '<span class="jy-pill ord">ORDERED</span>' : ""}</b>
      <div style="font-size:12px;color:var(--jm);margin-top:2px">${escH(jyWhere(r))} · ${jyDev(r.device)}${r.placement ? " · " + escH(jyNice(r.placement)) : ""} · ${jyFmt(r.duration_s)} · ${r.max_scroll}% scroll</div></div>
      <button class="jy-btn soft" onclick="jyOpenVisit('${r.id}')">${r.has_recording ? "▶ Watch" : "Details"}</button></div>`).join("") : '<div class="jy-empty">Nothing in this group.</div>';
  };
  draw();
}

// ── Websites outside Revora (and product websites): a project id and the one-line script. ──
const jyScriptLine = (p) => `<script async src="https://revoracrm.app/rv/rec.js" data-project="${p.public_id}"></script>`;
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
