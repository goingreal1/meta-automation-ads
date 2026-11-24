// ── Visitor journey (summary): how many real people reached your page, how far they got, how long they stayed, what they tapped, who ordered.
// Built from the visits Revora already records (site_sessions). Visits that look like bots are left out and counted separately.
// Watching individual recordings stays on the Journeys screen ("Watch real recordings" opens it).
(function () {
  if (window.__jnInstalled) return; window.__jnInstalled = true;
  const css = `
  .jn{position:fixed;inset:0;z-index:9000;background:var(--bg);overflow:auto;color:var(--text);-webkit-overflow-scrolling:touch}
  .jn-in{max-width:640px;margin:0 auto;padding:12px 16px calc(32px + env(safe-area-inset-bottom))}
  .jn button{font-family:inherit}
  .jn-top{display:flex;align-items:center;gap:10px;padding:4px 0 10px}
  .jn-back{width:44px;height:44px;border:0;border-radius:50%;background:var(--panel);color:var(--text);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 1px 2px rgba(15,30,70,.08),0 4px 14px rgba(15,30,70,.06)}
  .jn-back svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .jn-top h2{flex:1;margin:0;font-size:18px;font-weight:750}
  .jn-seg{display:flex;background:var(--panel2);border-radius:12px;padding:3px}
  .jn-seg button{min-height:38px;padding:0 12px;border:0;border-radius:9px;background:transparent;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer}
  .jn-seg button.on{background:var(--panel);color:var(--text);font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.14)}
  .jn-hero{display:flex;align-items:center;gap:18px;padding:20px 18px;border-radius:26px;background:#0f2a66;color:#fff;margin-top:6px}
  .jn-hero b{display:block;font-size:40px;font-weight:750;letter-spacing:-.03em;line-height:1}.jn-hero span{font-size:13px;color:#b8c8ee}
  .jn-bots{display:inline-flex;align-items:center;gap:6px;margin-top:10px;height:26px;padding:0 10px;border-radius:13px;background:rgba(255,255,255,.12);font-size:12px;font-weight:650}
  .jn-bots svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
  .jn-card{margin-top:12px;padding:18px;border-radius:24px;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06)}
  .jn-card h3{margin:0 0 14px;font-size:16px;font-weight:700}
  .jn-st{display:flex;gap:12px}
  .jn-rail{display:flex;flex-direction:column;align-items:center;width:36px;flex:none}
  .jn-ic{width:36px;height:36px;border-radius:12px;display:flex;align-items:center;justify-content:center}
  .jn-ic svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .jn-ln{width:2px;flex:1;background:var(--panel2);margin:4px 0;min-height:14px}
  .jn-bd{flex:1;min-width:0;padding-bottom:18px}
  .jn-r1{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.jn-r1 b{font-weight:650}.jn-r1 em{font-style:normal;font-size:20px;font-weight:750}
  .jn-tr{height:8px;border-radius:4px;background:var(--panel2);margin-top:8px;overflow:hidden}.jn-tr i{display:block;height:100%;border-radius:4px}
  .jn-ch{display:flex;gap:8px;margin-top:8px}.jn-ch span{height:24px;padding:0 10px;border-radius:12px;background:var(--panel2);font-size:12px;font-weight:650;display:flex;align-items:center}
  .jn-tp{display:grid;gap:14px}.jn-tp>div>div:first-child{display:flex;justify-content:space-between;font-weight:650}
  .jn-bars{display:flex;align-items:flex-end;gap:10px;height:130px;border-bottom:1px solid var(--border)}
  .jn-bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:2px}.jn-bar i{display:block;width:100%}
  .jn-lb{display:flex;gap:10px;margin-top:6px}.jn-lb span{flex:1;text-align:center;font-size:11px;color:var(--muted)}
  .jn-lg{display:flex;gap:12px;font-size:12px;color:var(--muted)}.jn-lg i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px}
  .jn-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.jn-two div{padding:14px;border-radius:18px;background:var(--panel2)}.jn-two small{display:block;font-size:12px;color:var(--muted)}.jn-two b{display:block;font-size:22px;font-weight:750;margin-top:2px}
  .jn-rec{display:flex;align-items:center;gap:12px;width:100%;margin-top:12px;padding:14px 16px;border:0;border-radius:20px;background:var(--panel);color:var(--text);text-align:left;cursor:pointer;font:inherit;box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06)}
  .jn-rec>i{width:40px;height:40px;border-radius:13px;background:#e5484d;color:#fff;display:flex;align-items:center;justify-content:center;flex:none}
  .jn-rec>i svg{width:18px;height:18px;fill:currentColor}.jn-rec span{flex:1}.jn-rec b{display:block}.jn-rec small{display:block;font-size:12px;color:var(--muted)}
  .jn-empty{padding:40px 12px;text-align:center;color:var(--text2);font-size:15px;line-height:1.5}
  .jn-note{font-size:12px;color:var(--muted);margin:12px 4px 0;line-height:1.45}
  `;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const esc = (s) => escH(String(s == null ? "" : s));
  const J = { days: 7, rows: null };
  const dur = (s) => { s = Math.round(Number(s) || 0); return s >= 60 ? Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") : "0:" + String(s).padStart(2, "0"); };
  const avg = (a) => (a.length ? a.reduce((t, r) => t + (Number(r.duration_s) || 0), 0) / a.length : 0);
  const pct = (a, b) => (b > 0 ? a / b * 100 : 0);
  const pctS = (v) => (v > 0 && v < 1 ? v.toFixed(1) : Math.round(v)) + "%";
  const ICON = {
    in: "M5 12h14M13 6l6 6-6 6", scroll: "M12 5v14M6 13l6 6 6-6", tap: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
    form: "M4 4h16v16H4zM8 9h8M8 13h5", done: "M20 6 9 17l-5-5",
  };

  // A visit that never scrolled, tapped or stayed, with no later activity, and older than 10 minutes, is treated as a bot or an accidental open.
  const isBot = (r) => !(Number(r.duration_s) > 0) && !(Number(r.max_scroll) > 0) && !(Number(r.clicks) > 0) && Number(r.pings || 0) <= 1 && Date.now() - new Date(r.started_at).getTime() > 600000;

  async function load() {
    const since = new Date(Date.now() - J.days * 86400000).toISOString();
    const rows = await sbQuery("site_sessions", `select=duration_s,max_scroll,clicks,cta_clicks,form_started,ordered,device,pings,started_at&started_at=gte.${since}&order=started_at.desc&limit=5000`).catch(() => null);
    J.rows = rows || [];
  }

  function body() {
    const all = J.rows || [], real = all.filter((r) => !isBot(r)), bots = all.length - real.length;
    if (!real.length) return `<div class="jn-empty">No visitors yet in this period.<br>When people open your pages from your ads, they show up here.</div>`;
    const scrolled = real.filter((r) => Number(r.max_scroll) >= 50), tapped = real.filter((r) => Number(r.cta_clicks) > 0), form = real.filter((r) => r.form_started), ord = real.filter((r) => r.ordered);
    const steps = [
      ["Landed", real, "#1f6fff", ICON.in], ["Scrolled to the offer", scrolled, "#3d86ff", ICON.scroll], ["Tapped Order", tapped, "#d98200", ICON.tap],
      ["Started the form", form, "#c2410c", ICON.form], ["Ordered", ord, "#18a35a", ICON.done],
    ];
    const C = 2 * Math.PI * 42, ring = (C * real.length / Math.max(1, all.length)).toFixed(1) + " " + C.toFixed(1);
    const tapAny = real.filter((r) => Number(r.clicks) > 0), tapOther = tapAny.length, tapCta = tapped.length, mxTap = Math.max(1, tapOther, tapCta);
    const buckets = [["<10s", 0, 10], ["10–30s", 10, 30], ["30–60s", 30, 60], ["1–3m", 60, 180], ["3m+", 180, 1e9]].map(([l, a, b]) => { const v = real.filter((r) => r.duration_s >= a && r.duration_s < b); return { l, v: v.length, o: v.filter((r) => r.ordered).length }; });
    const mxB = Math.max(1, ...buckets.map((b) => b.v));
    const dev = (d) => { const x = real.filter((r) => (d === "mobile" ? r.device === "mobile" : r.device !== "mobile")); return x.length ? pctS(pct(x.filter((r) => r.ordered).length, x.length)) : "—"; };
    return `<div class="jn-hero"><svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true" style="flex:none"><circle cx="52" cy="52" r="42" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="12"/><circle cx="52" cy="52" r="42" fill="none" stroke="#7fb0ff" stroke-width="12" stroke-linecap="round" stroke-dasharray="${ring}" transform="rotate(-90 52 52)"/></svg>
      <div><b>${real.length.toLocaleString("en-NG")}</b><span>real visitors</span><div><span class="jn-bots"><svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/></svg>${bots.toLocaleString("en-NG")} bots removed</span></div></div></div>
      <div class="jn-card"><h3>Their journey</h3>${steps.map((s, i) => `<div class="jn-st"><div class="jn-rail"><div class="jn-ic" style="background:${s[2]}22;color:${s[2]}"><svg viewBox="0 0 24 24"><path d="${s[3]}"/></svg></div>${i < steps.length - 1 ? '<div class="jn-ln"></div>' : ""}</div>
        <div class="jn-bd"><div class="jn-r1"><b>${s[0]}</b><em>${s[1].length.toLocaleString("en-NG")}</em></div><div class="jn-tr"><i style="width:${Math.max(s[1].length ? 2 : 0, pct(s[1].length, real.length))}%;background:${s[2]}"></i></div>
        <div class="jn-ch"><span>${pctS(pct(s[1].length, real.length))}</span><span>${s[1].length ? dur(avg(s[1])) + " on page" : "—"}</span></div></div></div>`).join("")}</div>
      <div class="jn-card"><h3>What they tapped</h3><div class="jn-tp">
        <div><div><span>Order button</span><span>${tapCta}</span></div><div class="jn-tr" style="height:10px"><i style="width:${pct(tapCta, mxTap)}%;background:#1f6fff"></i></div></div>
        <div><div><span>Tapped anything</span><span>${tapOther}</span></div><div class="jn-tr" style="height:10px"><i style="width:${pct(tapOther, mxTap)}%;background:#5c9bff"></i></div></div></div></div>
      <div class="jn-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><h3 style="margin:0">Time on page</h3><div class="jn-lg"><span><i style="background:#8aa9e6"></i>Visited</span><span><i style="background:#18a35a"></i>Ordered</span></div></div>
        <div class="jn-bars">${buckets.map((b) => `<div class="jn-bar"><i style="height:${b.o ? Math.max(8, b.o / mxB * 100) : 0}px;border-radius:5px;background:#18a35a"></i><i style="height:${Math.max(3, b.v / mxB * 100)}px;border-radius:5px 5px 0 0;background:#8aa9e6"></i></div>`).join("")}</div>
        <div class="jn-lb">${buckets.map((b) => `<span>${b.l}</span>`).join("")}</div></div>
      <div class="jn-card"><h3>Who ordered</h3><div class="jn-two"><div><small>Phone</small><b>${dev("mobile")}</b></div><div><small>Computer</small><b>${dev("desktop")}</b></div></div></div>
      <button type="button" class="jn-rec" onclick="jnClose();bvGoToTab('journeys')"><i><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></i><span><b>Watch real recordings</b><small>See visitors use your page</small></span></button>
      <div class="jn-note">Visits that never scrolled, tapped or stayed are counted as bots. Time on page is the average for the people who reached that step.</div>`;
  }

  function draw() {
    const el = document.getElementById("jnOv"); if (!el) return;
    el.innerHTML = `<div class="jn-in"><div class="jn-top"><button type="button" class="jn-back" onclick="jnBack()" aria-label="Back"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button><h2>Visitor journey</h2>
      <div class="jn-seg">${[[1, "Today"], [7, "7d"], [30, "30d"]].map(([d, l]) => `<button type="button" class="${J.days === d ? "on" : ""}" onclick="jnRange(${d})">${l}</button>`).join("")}</div></div>
      ${J.rows == null ? `<div class="jn-empty"><span class="spin"></span></div>` : body()}</div>`;
  }
  window.jnRange = async function (d) { J.days = d; J.rows = null; draw(); await load(); draw(); };
  window.jnOpen = async function () {
    if (document.getElementById("jnOv")) return;
    const el = document.createElement("div"); el.id = "jnOv"; el.className = "jn rv-ui"; document.body.appendChild(el);
    try { history.pushState({ jn: 1 }, "", location.href); } catch (e) {}
    J.rows = null; draw(); await load(); draw();
  };
  window.jnClose = function () { const el = document.getElementById("jnOv"); if (el) el.remove(); };
  window.jnBack = function () { if (history.state && history.state.jn) history.back(); else window.jnClose(); };
  window.addEventListener("popstate", () => { if (document.getElementById("jnOv")) window.jnClose(); });
})();
