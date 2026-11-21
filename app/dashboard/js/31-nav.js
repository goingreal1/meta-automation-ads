// ── Navigation memory + loading skeletons ──
// 1. A refresh stays on the same screen (the screen name lives in the address: #/campaigns).
// 2. The browser / phone Back button walks back through the screens you really visited, including the campaign → ad set → ad drill-down,
//    and closes a pop-up first when one is open.
// 3. bvSkel() paints grey placeholder blocks while a screen loads.
(function () {
  const st = document.createElement("style");
  st.textContent = `
  @keyframes bvSk{0%{background-position:200% 0}100%{background-position:-200% 0}}
  .bv-sk{background:linear-gradient(90deg,rgba(130,145,160,.14) 25%,rgba(130,145,160,.26) 37%,rgba(130,145,160,.14) 63%);background-size:400% 100%;animation:bvSk 1.3s ease infinite;border-radius:10px}
  .bv-skw{padding:6px 0}.bv-skw .r{display:flex;gap:12px;align-items:center;margin:0 0 14px}.bv-skw .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 16px}
  @media(max-width:700px){.bv-skw .grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(prefers-reduced-motion:reduce){.bv-sk{animation:none}}`;
  document.head.appendChild(st);
  const b = (w, h, extra) => `<div class="bv-sk" style="width:${w};height:${h}px;${extra || ""}"></div>`;
  window.bvSkel = function (kind) {
    const rows = (n) => Array.from({ length: n }, () => `<div class="r">${b("42px", 42, "border-radius:10px;flex:none")}<div style="flex:1;display:flex;flex-direction:column;gap:7px">${b("55%", 13)}${b("32%", 11)}</div>${b("70px", 22)}</div>`).join("");
    const tiles = `<div class="grid">${Array.from({ length: 4 }, () => `<div style="padding:14px;border:1px solid rgba(130,145,160,.2);border-radius:14px">${b("50%", 11)}${b("40%", 24, "margin-top:10px")}</div>`).join("")}</div>`;
    return `<div class="bv-skw" aria-busy="true" aria-label="Loading">${kind === "table" ? tiles + rows(7) : kind === "list" ? rows(8) : b("38%", 26, "margin-bottom:16px") + tiles + rows(5)}</div>`;
  };

  // ── history ──
  let restoring = false, silent = false, closingAll = false;
  const snap = () => {
    const s = { tab: activeTab };
    if (s.tab === "campaigns" && typeof am !== "undefined") {
      s.lv = am.level; s.sc = [...(am.sel?.campaigns || [])]; s.ss = [...(am.sel?.adsets || [])];
      s.det = typeof CP !== "undefined" && CP.mDetail && CP.sel ? { l: CP.sel.l, id: CP.sel.id } : null;
    }
    return s;
  };
  const same = (a, b2) => a && b2 && a.tab === b2.tab && a.lv === b2.lv && JSON.stringify(a.sc) === JSON.stringify(b2.sc) && JSON.stringify(a.ss) === JSON.stringify(b2.ss) && JSON.stringify(a.det) === JSON.stringify(b2.det);
  const hasOverlay = () => !!document.querySelector(".bv-overlay");
  window.bvNavPush = function () {
    if (restoring) return;
    const s = snap(), cur = history.state;
    if (same(cur, s) && !cur.ov) return;
    try {
      if (!cur || cur.ov) history.replaceState({ ...s, d: (cur && cur.d) || 0 }, "", "#/" + s.tab);
      else history.pushState({ ...s, d: (cur.d || 0) + 1 }, "", "#/" + s.tab);
    } catch (e) {}
  };
  // called at the start of every render(): keep the highlighted tab and the address in step with the screen
  window.bvNavBeforeRender = function () {
    document.querySelectorAll(".tab-btn").forEach((x) => x.classList.toggle("active", x.dataset.tab === activeTab));
    bvNavPush();
  };
  function restore(s) {
    restoring = true;
    try {
      activeTab = s.tab; window.bvLegacyOk = false;
      if (s.tab === "campaigns" && typeof am !== "undefined") {
        am.level = s.lv || "campaigns"; am.sel = { campaigns: new Set(s.sc || []), adsets: new Set(s.ss || []) };
        if (typeof CP !== "undefined") { CP.mDetail = !!s.det; if (s.det) CP.sel = s.det; }
      }
      render();
    } finally { restoring = false; }
  }
  window.addEventListener("popstate", (e) => {
    if (silent) { silent = false; return; }
    const s = e.state;
    if (hasOverlay() && !(s && s.ov)) { closingAll = true; document.querySelectorAll(".bv-overlay").forEach((o) => o.remove()); closingAll = false; if (s && s.tab === activeTab) return; }
    if (s && s.tab) restore(s);
    else if (!s) { const h = location.hash.replace(/^#\/?/, "").split("/")[0]; if (h && document.querySelector(`.tab-btn[data-tab="${h.replace(/[^\w-]/g, "")}"]`)) restore({ tab: h }); }
  });
  // pop-ups get their own history step so Back closes them instead of leaving the screen
  new MutationObserver(() => {
    const open = hasOverlay(), cur = history.state;
    if (open && cur && !cur.ov && !restoring) { try { history.pushState({ ...cur, ov: 1 }, "", location.hash || "#/" + cur.tab); } catch (e) {} }
    else if (!open && cur && cur.ov && !closingAll) { silent = true; history.back(); }
  }).observe(document.body, { childList: true });

  // in-app Back buttons use the browser's history when there is one, so both agree
  const wrapBack = (name) => { const f = window[name]; if (typeof f !== "function") return; window[name] = function () { if (history.state && history.state.d > 0 && !history.state.ov) { history.back(); return; } return f.apply(this, arguments); }; };
  const wrapPush = (name) => { const f = window[name]; if (typeof f !== "function") return; window[name] = function () { const r = f.apply(this, arguments); bvNavPush(); return r; }; };
  window.addEventListener("load", () => { ["amDrill", "amSetLevel", "cpSelect"].forEach(wrapPush); ["amBack", "cpBack"].forEach(wrapBack); try { history.replaceState({ ...snap(), d: 0 }, "", "#/" + activeTab); } catch (e) {} });
})();
