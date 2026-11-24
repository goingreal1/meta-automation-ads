// ── Phone header: Home shows the company name; every other screen shows its own name (Chats, Orders, Campaigns, Settings, ...).
// That frees the big title each screen used to draw under the header, so there is more room for the content.
// The company name element (#hdrBrand) is left alone because other screens read it; a second element shows the screen name instead.
(function () {
  if (window.__htInstalled) return; window.__htInstalled = true;
  const css = `
  #hdrTitle{display:none}
  @media (max-width:760px){
    body.ht-sub #hdrBrand{display:none}
    body.ht-sub #hdrTitle{display:block}
    /* the big title under the header repeats the header now */
    body.ht-sub #mainContent .rv-ui > .rv-head > div:first-child > h1{display:none}
    body.ht-sub #mainContent .rv-ui > .rv-head > div:first-child:not(:has(p:not(:empty))){display:none}
    body.ht-sub #mainContent .sh:has(> .sh-title:only-child){display:none}
  }`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  function title() {
    if (typeof activeTab === "undefined") return "";
    const m = document.getElementById("mTitle"), sub = document.body.classList.contains("m-sub");
    if (sub && m && m.textContent.trim()) return m.textContent.trim();
    const bar = (typeof BN_ITEMS !== "undefined" ? BN_ITEMS : []).find((i) => i.tab === activeTab);
    if (bar) return bar.label;
    if (activeTab === "more" || activeTab === "settings") return "Settings";
    const t = document.querySelector(`#tabsBar [data-tab="${activeTab}"] .tab-label`);
    return t ? t.textContent.trim() : "";
  }
  function sync() {
    try {
      const phone = window.matchMedia("(max-width: 760px)").matches, home = typeof activeTab === "undefined" || activeTab === "overview";
      const brand = document.getElementById("hdrBrand"); if (!brand) return;
      let t = document.getElementById("hdrTitle");
      if (!t) { t = document.createElement("div"); t.id = "hdrTitle"; t.className = brand.className; brand.insertAdjacentElement("afterend", t); }
      const txt = phone && !home ? title() : "";
      t.textContent = txt;
      document.body.classList.toggle("ht-sub", !!txt);
    } catch (e) {}
  }
  const wrap = (name) => { const f = window[name]; if (typeof f !== "function") return; window[name] = function () { const r = f.apply(this, arguments); sync(); return r; }; };
  ["render", "bvUpdateAppBar"].forEach(wrap);
  window.addEventListener("resize", sync); window.addEventListener("popstate", () => setTimeout(sync, 0));
  setInterval(sync, 1500); // cheap safety net for screens that change the tab without calling render()
  sync();
})();
