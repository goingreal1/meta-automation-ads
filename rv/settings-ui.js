/* Glass hint pills (hover or tap any [data-hint]), a nudge pill that suggests the next step on any screen, and a tidy-up of the Settings panels
   (long explanation paragraphs become a small "i" pill; instruction lists fold away). Plain script, no dependencies. */
(function () {
  "use strict";
  var tipEl = null, showT = null, hideT = null;

  function ensureTip() {
    if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "rv-tip"; tipEl.setAttribute("role", "tooltip"); document.body.appendChild(tipEl); }
    return tipEl;
  }
  function showTip(target, text) {
    if (!text) return;
    var t = ensureTip(); t.classList.remove("on"); t.textContent = text; t.style.left = "0px"; t.style.top = "0px";
    var r = target.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight;
    var side = target.classList && target.classList.contains("set-nav-btn") && window.innerWidth > 760; // settings menu: pill appears beside the item
    var left = side ? r.right + 10 : Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    var top = side ? r.top + r.height / 2 - h / 2 : r.bottom + 10;
    if (!side && top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 10);
    t.style.left = left + "px"; t.style.top = top + "px";
    requestAnimationFrame(function () { t.classList.add("on"); });
  }
  function hideTip() { clearTimeout(showT); clearTimeout(hideT); if (tipEl) tipEl.classList.remove("on"); }
  var hintOf = function (e) { return e.target && e.target.closest ? e.target.closest("[data-hint]") : null; };
  document.addEventListener("mouseover", function (e) { var el = hintOf(e); if (!el) return; clearTimeout(showT); showT = setTimeout(function () { showTip(el, el.getAttribute("data-hint")); }, 160); }, true);
  document.addEventListener("mouseout", function (e) { if (hintOf(e)) hideTip(); }, true);
  document.addEventListener("focusin", function (e) { var el = hintOf(e); if (el) showTip(el, el.getAttribute("data-hint")); }, true);
  document.addEventListener("focusout", function (e) { if (hintOf(e)) hideTip(); }, true);
  document.addEventListener("click", function (e) {
    var i = e.target && e.target.closest ? e.target.closest(".rv-i") : null;
    if (i) { e.preventDefault(); showTip(i, i.getAttribute("data-hint")); clearTimeout(hideT); hideT = setTimeout(hideTip, 4500); } else hideTip();
  }, true);
  window.addEventListener("scroll", hideTip, true);

  /* ---------- Settings tidy-up ---------- */
  var NAV_HINTS = {
    accounts: "Connect ad accounts through a Business Manager.", pages: "Choose the Page and pixel your ads use.", domains: "Put your sales pages on your own domain.",
    aiapps: "Let ChatGPT or Claude run your ads for you.", whatsapp: "Your WhatsApp number and message templates.", business: "Company details, team and media buyers.",
    billing: "Your plan, payments and invoices.", automation: "Kill rules and the alerts you get.", aiteam: "Your daily AI meeting, images and launches.",
    security: "Password and sign-in.", help: "Guides and support."
  };
  var shorten = function (t) { t = String(t).replace(/\s+/g, " ").trim(); return t.length > 240 ? t.slice(0, 237).replace(/\s+\S*$/, "") + "…" : t; };

  window.rvSettingsPolish = function () {
    var body = document.getElementById("setBody"); if (!body) return;
    document.querySelectorAll("#setNav .set-nav-btn").forEach(function (b) { var h = NAV_HINTS[b.dataset.sec]; if (h) b.setAttribute("data-hint", h); });
    body.querySelectorAll(".panel").forEach(function (p) {
      if (p.dataset.rvPolished) return; p.dataset.rvPolished = "1";
      var title = p.querySelector(".ph-title"); if (!title) return;
      var texts = [];
      Array.prototype.forEach.call(p.children, function (d) {
        if (d.tagName !== "DIV" || d.id || d.querySelector("input,button,a,select,textarea,table,form,ol,ul")) return;
        var st = d.getAttribute("style") || "";
        if (!/color:\s*var\(--muted\)/.test(st) || !/font-size:\s*1[12](\.5)?px/.test(st)) return;
        var t = (d.textContent || "").trim(); if (t.length < 50) return;
        texts.push(t); d.parentNode.removeChild(d);
      });
      if (texts.length) {
        var i = document.createElement("button"); i.type = "button"; i.className = "rv-i"; i.textContent = "i"; i.setAttribute("aria-label", "About this");
        i.setAttribute("data-hint", shorten(texts.join(" "))); title.appendChild(i);
      }
    });
    body.querySelectorAll(".set-steps").forEach(function (s) {
      if (s.parentNode && s.parentNode.classList && s.parentNode.classList.contains("rv-how")) return;
      var d = document.createElement("details"); d.className = "rv-how"; d.innerHTML = "<summary>How it works</summary>";
      s.parentNode.insertBefore(d, s); d.appendChild(s);
    });
  };


  /* ---------- Campaign setup: long helper lines become hint pills ---------- */
  function addPill(label, text) {
    var pill = label.querySelector(".rv-i");
    if (pill) { pill.setAttribute("data-hint", shorten(pill.getAttribute("data-hint") + " " + text)); return; }
    var b = document.createElement("button"); b.type = "button"; b.className = "rv-i"; b.textContent = "i"; b.setAttribute("aria-label", "About this");
    b.setAttribute("data-hint", shorten(text)); label.appendChild(b);
  }
  function polishBuilder(ov) {
    if (!ov) return;
    ov.querySelectorAll(".field").forEach(function (f) {
      var lab = f.querySelector(":scope > label"); if (!lab) return;
      lab.querySelectorAll("span").forEach(function (sp) { // "(shown in Meta Ads Manager)" and similar asides
        var t = (sp.textContent || "").trim().replace(/^[(\s]+|[)\s]+$/g, "");
        if (t.length >= 14 && /var\(--muted\)/.test(sp.getAttribute("style") || "") && !sp.querySelector("*")) { addPill(lab, t); sp.parentNode.removeChild(sp); }
      });
      Array.prototype.forEach.call(f.children, function (d) { // the grey explanation lines under a field
        if (d.tagName !== "DIV" || d.id || d.querySelector("input,select,button,textarea,a")) return;
        if (!/color:\s*var\(--muted\)/.test(d.getAttribute("style") || "")) return;
        var t = (d.textContent || "").trim(); if (t.length < 30) return;
        addPill(lab, t); d.parentNode.removeChild(d);
      });
    });
  }
  (function watchBuilder() {
    var timer = null, seen = null;
    var run = function () { clearTimeout(timer); timer = setTimeout(function () { polishBuilder(document.getElementById("bvBuilderOverlay")); }, 120); };
    var obs = new MutationObserver(function () {
      var ov = document.getElementById("bvBuilderOverlay");
      if (ov && ov !== seen) { seen = ov; new MutationObserver(run).observe(ov, { childList: true, subtree: true }); }
      if (ov) run(); else seen = null;
    });
    var start = function () { obs.observe(document.body, { childList: true }); };
    if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  })();

  /* ---------- Nudge pill: one short suggestion per screen ---------- */
  var TIPS = {
    campaigns: { t: "Tip: set a landing page view limit to stop wasteful spend." },
    performance: { t: "Tip: compare buyers side by side to see who earns the most." },
    vault: { t: "Tip: your AI Team can make fresh images every night.", href: "/ai-team.html", b: "Open" },
    websites: { t: "Tip: open the IDE to edit your page code and add plugins." },
    settings: { t: "Tip: hover any setting for a quick explanation." }
  };
  var nudgeEl = null, nudgeT = null, cacheState = null, cacheAt = 0, lastKey = "";
  var seen = function (k) { try { var v = +localStorage.getItem("rvn:" + k); return v && Date.now() - v < 6 * 3600e3; } catch (e) { return false; } };
  var mark = function (k) { try { localStorage.setItem("rvn:" + k, String(Date.now())); } catch (e) { /* private mode */ } };

  function hideNudge() { if (nudgeEl) nudgeEl.classList.remove("on"); clearTimeout(nudgeT); }
  function showNudge(key, text, btn, action) {
    if (seen(key) || document.querySelector(".modal-back.show,#bvModal.show,#bvBuilderOverlay")) return;
    if (!nudgeEl) { nudgeEl = document.createElement("div"); nudgeEl.className = "rv-nudge"; document.body.appendChild(nudgeEl); }
    nudgeEl.innerHTML = '<span class="dot"></span><span class="tx"></span>' + (btn ? '<button type="button" class="go"></button>' : "") + '<button type="button" class="x" aria-label="Dismiss">×</button>';
    nudgeEl.querySelector(".tx").textContent = text;
    if (btn) { var g = nudgeEl.querySelector(".go"); g.textContent = btn; g.onclick = function () { mark(key); hideNudge(); action(); }; }
    nudgeEl.querySelector(".x").onclick = function () { mark(key); hideNudge(); };
    requestAnimationFrame(function () { nudgeEl.classList.add("on"); });
    clearTimeout(nudgeT); nudgeT = setTimeout(function () { mark(key); hideNudge(); }, 9000);
  }
  async function pickNudge() {
    if (typeof activeTab === "undefined" || !window.myProfile) return;
    var role = window.myProfile.role; if (["owner", "admin", "buyer"].indexOf(role) < 0) return;
    var tab = activeTab; if (tab === "more") return;
    var key = "tab:" + tab; if (key === lastKey) return; lastKey = key;
    try {
      if (typeof bvSetupState === "function") {
        if (!cacheState || Date.now() - cacheAt > 5 * 60e3) { cacheState = await bvSetupState(); cacheAt = Date.now(); }
        var next = cacheState && !cacheState.done ? cacheState.items.filter(function (i) { return !i.done; })[0] : null;
        if (next) { showNudge("setup:" + next.label, "Next: " + next.label, "Do it", function () { bvSetupGo(next.go[0], next.go[1] || ""); }); return; }
      }
    } catch (e) { /* fall through to the tab tip */ }
    var tip = TIPS[tab];
    if (tip) showNudge("tip:" + tab, tip.t, tip.b || null, function () { location.href = tip.href; });
  }
  function watch() {
    var bar = document.getElementById("tabsBar"); if (!bar) return;
    var d; var go = function () { clearTimeout(d); d = setTimeout(pickNudge, 1200); };
    new MutationObserver(go).observe(bar, { attributes: true, subtree: true, attributeFilter: ["class"] });
    go();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
})();
