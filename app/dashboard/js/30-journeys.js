// ── Journeys: every visit to your pages, which Meta ad it came from, what it did, and the replay. ──
const JY = { filter: "all", rows: [], projects: [], ads: {}, timer: null };
const jyFmt = (s) => { s = Math.round(Number(s) || 0); return s >= 60 ? Math.floor(s / 60) + "m " + (s % 60) + "s" : s + "s"; };
const jyAgo = (t) => { const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000); return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + "m ago" : s < 86400 ? Math.floor(s / 3600) + "h ago" : Math.floor(s / 86400) + "d ago"; };
const jyLive = (r) => Date.now() - new Date(r.last_seen_at).getTime() < 60000;
function jyCss() {
  if (document.getElementById("jyCss")) return;
  const st = document.createElement("style"); st.id = "jyCss";
  st.textContent = `
  .jy h2{margin:0 0 4px;font-size:22px}.jy .sub{color:var(--muted,#7a8a92);font-size:13px;margin-bottom:14px}
  .jy-top{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
  .jy-chip{border:1px solid var(--border,#d8e0e4);background:var(--panel,#fff);color:inherit;padding:8px 14px;border-radius:99px;font-size:13px;font-weight:600;cursor:pointer}
  .jy-chip.on{background:var(--accent,#1877f2);color:#fff;border-color:transparent}
  .jy-row{display:flex;gap:12px;align-items:center;padding:12px;border:1px solid var(--border,#e3e9ec);border-radius:16px;background:var(--panel,#fff);margin-bottom:8px}
  .jy-mid{flex:1;min-width:0}.jy-mid b{display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .jy-mid small{color:var(--muted,#7a8a92);font-size:12px;display:block;margin-top:2px}
  .jy-pill{font-size:11px;font-weight:700;padding:3px 8px;border-radius:99px;background:var(--panel2,#eef2f4);margin-left:4px}
  .jy-pill.live{background:#e1f8ea;color:#12843d}.jy-pill.ord{background:#fff0d6;color:#9a5b00}
  .jy-btn{border:0;background:var(--accent,#1877f2);color:#fff;padding:9px 14px;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap}
  .jy-btn.ghost{background:var(--panel2,#eef2f4);color:inherit}
  .jy-empty{padding:28px;text-align:center;color:var(--muted,#7a8a92);font-size:14px}
  .jy-code{background:#0f1a22;color:#d7ecff;padding:12px;border-radius:12px;font:12px/1.5 ui-monospace,Menlo,monospace;overflow:auto;white-space:pre-wrap;word-break:break-all;margin:8px 0}
  .jy-player{display:flex;justify-content:center;min-height:200px;overflow:auto}`;
  document.head.appendChild(st);
}
async function renderJourneys(c) {
  jyCss();
  c.innerHTML = `<div class="rv-ui jy"><h2>Journeys</h2><div class="sub">Every visit to your pages and which Meta ad it came from. Recordings are kept 60 days. Typed text is never recorded.</div>
    <div class="jy-top" id="jyTop"></div><div id="jyList"><div class="jy-empty"><span class="spin"></span> Loading…</div></div></div>`;
  await jyLoad();
  clearInterval(JY.timer); JY.timer = setInterval(() => { if (document.getElementById("jyList")) jyLoad(true); else clearInterval(JY.timer); }, 15000);
}
async function jyLoad() {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const [rows, projects] = await Promise.all([
    sbQuery("site_sessions", `select=*&started_at=gte.${since}&order=started_at.desc&limit=150`).catch(() => []),
    sbQuery("rec_projects", "select=*&order=created_at.desc").catch(() => []),
  ]);
  JY.rows = rows || []; JY.projects = projects || [];
  const ids = [...new Set(JY.rows.map((r) => r.meta_ad_id).filter(Boolean))];
  if (ids.length) {
    const o = await sbQuery("learn_objects", `select=meta_id,name&level=eq.ad&meta_id=in.(${ids.join(",")})`).catch(() => []);
    (o || []).forEach((x) => { JY.ads[x.meta_id] = x.name; });
  }
  jyDraw();
}
function jyDraw() {
  const top = document.getElementById("jyTop"), list = document.getElementById("jyList"); if (!top || !list) return;
  const live = JY.rows.filter(jyLive).length;
  const F = [["all", "All"], ["live", `Live now${live ? " (" + live + ")" : ""}`], ["ad", "From ads"], ["order", "Ordered"], ["rec", "With recording"]];
  top.innerHTML = F.map(([k, l]) => `<button class="jy-chip${JY.filter === k ? " on" : ""}" data-f="${k}">${l}</button>`).join("") + `<span style="flex:1"></span><button class="jy-chip" id="jySetup">+ Add a website</button>`;
  top.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { JY.filter = b.dataset.f; jyDraw(); }));
  document.getElementById("jySetup").onclick = jySetup;
  const f = JY.filter, rows = JY.rows.filter((r) => f === "all" || (f === "live" && jyLive(r)) || (f === "ad" && r.meta_ad_id) || (f === "order" && r.ordered) || (f === "rec" && r.has_recording));
  if (!rows.length) { list.innerHTML = `<div class="jy-empty">${JY.rows.length ? "No visits match this filter." : "No visits yet. Open one of your Revora pages and it will show up here."}</div>`; return; }
  list.innerHTML = rows.map((r) => {
    const ad = r.meta_ad_id ? (JY.ads[r.meta_ad_id] || "Ad " + r.meta_ad_id) : (r.referrer_host || "Direct / unknown");
    return `<div class="jy-row"><div class="jy-mid"><b>${escH(ad)}${jyLive(r) ? '<span class="jy-pill live">LIVE</span>' : ""}${r.ordered ? '<span class="jy-pill ord">ORDERED</span>' : ""}</b>
      <small>${escH(r.host || r.landing_path || "")} · ${escH(r.device || "?")} · ${jyAgo(r.started_at)} · ${jyFmt(r.duration_s)} on page · scrolled ${r.max_scroll}% · ${r.clicks} taps${r.placement ? " · " + escH(r.placement) : ""}</small></div>
      ${r.has_recording ? `<button class="jy-btn" data-w="${r.id}">▶ Watch</button>` : '<span class="jy-pill">no recording</span>'}</div>`;
  }).join("");
  list.querySelectorAll("[data-w]").forEach((b) => (b.onclick = () => jyWatch(b.dataset.w)));
}
function jyLoadScript(src) { return new Promise((res, rej) => { if ([...document.scripts].some((s) => s.src.endsWith(src))) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
async function jyWatch(id) {
  const ov = bvOpenSheet("jyWatch", `<div style="padding:16px"><div style="display:flex;align-items:center;margin-bottom:10px"><b style="flex:1;font-size:16px">Visit replay</b><button class="jy-btn ghost" data-sheet-close onclick="bvCloseSheet('jyWatch')">Close</button></div><div id="jyBody"><div class="jy-empty"><span class="spin"></span> Loading the recording…</div></div></div>`, 900);
  try {
    if (!document.getElementById("jyPlayerCss")) { const l = document.createElement("link"); l.id = "jyPlayerCss"; l.rel = "stylesheet"; l.href = "/rv/rrweb-player.css"; document.head.appendChild(l); }
    await jyLoadScript("/rv/rrweb-player.min.js");
    const res = await sbFn("ads-manager", { action: "rec_get", session_id: id });
    const body = document.getElementById("jyBody"); if (!body) return;
    if (!res.events || res.events.length < 2) { body.innerHTML = `<div class="jy-empty">${escH(res.note || "This recording is empty or too short to play.")}</div>`; return; }
    body.innerHTML = '<div class="jy-player" id="jyPlayer"></div>';
    const w = Math.min(860, body.clientWidth || 600), vp = String(res.session?.viewport || "390x800").split("x"), ratio = (Number(vp[1]) || 800) / (Number(vp[0]) || 390);
    const width = Math.min(w, ratio > 1.2 ? 360 : w);
    new (typeof window.rrwebPlayer === "function" ? window.rrwebPlayer : (window.rrwebPlayer.default || window.rrwebPlayer.Player))({ target: document.getElementById("jyPlayer"), props: { events: res.events, width, height: Math.min(560, Math.round(width * ratio)), autoPlay: true, skipInactive: true } });
  } catch (e) { const b = document.getElementById("jyBody"); if (b) b.innerHTML = `<div class="jy-empty">Could not load the recording: ${escH(e.message || e)}</div>`; }
}
// Add a website that is not built in Revora: create a project and show the one-line script.
function jySetup() {
  const mk = (p) => `&lt;script async src="https://revoracrm.app/rv/rec.js" data-project="${escH(p.public_id)}"&gt;&lt;/script&gt;`;
  const old = JY.projects.map((p) => `<div style="margin:10px 0"><b>${escH(p.name)}</b> <small style="color:var(--muted)">${escH((p.domains || []).join(", ") || "any website")}</small><div class="jy-code">${mk(p)}</div></div>`).join("");
  bvOpenSheet("jySetupSheet", `<div style="padding:16px"><div style="display:flex;align-items:center;margin-bottom:8px"><b style="flex:1;font-size:16px">Websites outside Revora</b><button class="jy-btn ghost" data-sheet-close onclick="bvCloseSheet('jySetupSheet')">Close</button></div>
    <p style="font-size:13px;color:var(--muted)">Paste the line below inside the &lt;head&gt; of your website. Revora then records visits and links them to your Revora ads. Revora-built pages need nothing.</p>${old}
    <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px"><b style="font-size:14px">New website</b>
    <input id="jyName" class="bp-q" style="margin:8px 0;width:100%" placeholder="Name (e.g. My store)"><input id="jyDom" class="bp-q" style="margin:0 0 8px;width:100%" placeholder="Website address (e.g. www.me.com)">
    <button class="jy-btn" id="jyMk">Create script</button></div></div>`, 640);
  document.getElementById("jyMk").onclick = async () => {
    const name = document.getElementById("jyName").value.trim(), dom = document.getElementById("jyDom").value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (!name || !dom) return bvToast("Add a name and the website address.");
    try {
      const prof = window.myProfile;
      const res = await fetch(`${SUPA_URL}/rest/v1/rec_projects`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${sessionData?.access_token || ANON}`, "Content-Type": "application/json" }, body: JSON.stringify({ name, domains: [dom], company_id: prof.company_id, created_by: prof.id }) });
      if (!res.ok) throw new Error(await res.text());
      bvCloseSheet("jySetupSheet"); await jyLoad(); jySetup(); bvToast("Script created. Paste it in your website's header.");
    } catch (e) { bvToast("Could not create: " + (e.message || e)); }
  };
}
