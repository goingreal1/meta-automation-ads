/* Smart suggestions for the AI chat.
   Before: ten blue pills stacked over the chat, hiding the conversation on a phone.
   Now: one slim scrolling row of up to four suggestions picked from what is happening
   right now (new orders waiting, people who left checkout, time of day), plus a "More"
   button that opens a tidy sheet where every question is grouped and explained.
   The row disappears as soon as the conversation starts.

   Replaces the old rendering inside renderChatForRole() in dashboard_new.html.
   Needs: askChat(q, display), bvImportAds(), escH, window.rvn (notifications state). */
(function () {
  "use strict";
  var css = `
#chSuggs.ch-smart{display:flex;flex-wrap:nowrap;overflow-x:auto;gap:8px;padding:8px 12px 10px;scrollbar-width:none;-webkit-overflow-scrolling:touch;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 26px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 26px),transparent)}
#chSuggs.ch-smart::-webkit-scrollbar{display:none}
#chSuggs.ch-smart .ch-sugg{flex:none;white-space:nowrap;display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:999px;font-size:13px;line-height:1.2;border:1px solid var(--border);background:var(--panel);color:var(--text);transition:transform .12s,border-color .12s}
#chSuggs.ch-smart .ch-sugg:hover{background:var(--panel2);color:var(--text);border-color:var(--borderStrong,var(--border))}
#chSuggs.ch-smart .ch-sugg:active{transform:scale(.97)}
#chSuggs.ch-smart .ch-sugg.hot{border-color:var(--accent);background:var(--accentBg);color:var(--accent);font-weight:650}
#chSuggs.ch-smart .ch-sugg .n{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--accent);color:#fff;font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}
#chSuggs.ch-smart .ch-sugg.more{border-style:dashed;color:var(--text2)}
.chat-panel.page.empty #chSuggs.ch-smart{display:flex !important;width:min(780px,100%);padding:8px 20px 0}
@media(min-width:761px){.chat-panel.page.empty #chSuggs.ch-smart{flex-wrap:wrap;overflow:visible;-webkit-mask-image:none;mask-image:none;justify-content:center}}
.chat-panel.page.empty #chSuggs.ch-smart .ch-sugg{border-radius:999px;padding:9px 16px;font-size:13.5px}
@media(max-width:760px){.chat-panel.page.empty #chSuggs.ch-smart{width:100%;padding:8px 12px 0}.chat-panel.page.empty .ch-sugg:nth-child(n+5){display:inline-flex}}
#chMore{position:absolute;inset:0;z-index:5;display:none;flex-direction:column;justify-content:flex-end;background:rgba(10,12,16,.42)}
#chMore.on{display:flex}
#chMore .sheet{background:var(--bg,#fff);color:var(--text);border-radius:22px 22px 0 0;max-height:82%;display:flex;flex-direction:column;animation:chMoreUp .24s cubic-bezier(.2,.9,.3,1)}
@keyframes chMoreUp{from{transform:translateY(40px);opacity:.6}}
#chMore .grab{width:38px;height:4px;border-radius:2px;background:var(--border);margin:8px auto 2px;flex:none}
#chMore .hd{display:flex;align-items:center;padding:6px 18px 8px}
#chMore .hd b{flex:1;font-size:17px}
#chMore .hd button{border:0;background:var(--panel2);color:var(--text2);width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:14px}
#chMore .bd{overflow-y:auto;padding:0 14px calc(16px + env(safe-area-inset-bottom))}
#chMore h5{margin:14px 4px 6px;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700}
#chMore .it{display:flex;flex-direction:column;align-items:flex-start;gap:1px;width:100%;text-align:left;border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:14px;padding:11px 14px;margin-bottom:7px;font:inherit;cursor:pointer}
#chMore .it:active{background:var(--panel2)}
#chMore .it b{font-size:14px;font-weight:650}
#chMore .it span{font-size:12.5px;color:var(--text2)}
@media(prefers-reduced-motion:reduce){#chMore .sheet{animation:none}}
`;
  var META = {
    "What should I scale?": ["Grow", "Ad sets earning enough to put more budget behind"],
    "What should I test next?": ["Grow", "New angles worth a test, and why"],
    "Write ad copy for my best product": ["Grow", "Three fresh Facebook ads, within Meta's rules"],
    "Best CTR this week?": ["Grow", "Which creative gets the most clicks"],
    "Top ad set for orders?": ["Grow", "Where your orders are really coming from"],
    "Top ad sets/creatives?": ["Grow", "What is bringing the most orders"],
    "Best buyer this week?": ["Grow", "Highest ROAS across your team"],
    "What should I kill?": ["Fix", "Ads that broke your kill rules"],
    "Ad sets & ads breakdown": ["Fix", "Spend, reach, frequency and CTR for each"],
    "What needs attention?": ["Fix", "Calls, approvals and deliveries flagged for you"],
    "Called my new orders?": ["Orders & delivery", "Whether the AI agent has called them yet"],
    "Delivery rate?": ["Orders & delivery", "How many orders you actually delivered this week"],
    "AI call agent performance?": ["Orders & delivery", "How the agent is doing on new orders"],
  };
  var GROUP_ORDER = ["Grow", "Fix", "Orders & delivery", "Ask", "Teach"];
  var state = { role: "", all: [], teach: false };

  function esc(v) { return window.escH ? window.escH(v) : String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function unreadOf(kind) { return ((window.rvn && window.rvn.items) || []).filter(function (n) { return n.kind === kind && (!window.rvn.isUnread || window.rvn.isUnread(n)); }).length; }
  function todayDigest() {
    var items = (window.rvn && window.rvn.items) || [], t = new Date().toDateString();
    return items.filter(function (n) { return n.kind === "daily_digest" && new Date(n.created_at).toDateString() === t; })[0];
  }

  function picks() {
    var all = state.all, by = {}; all.forEach(function (a) { by[a.label] = a; });
    var out = [], h = new Date().getHours(), seller = ["owner", "admin", "buyer"].indexOf(state.role) >= 0;
    function add(p) { if (p && !out.some(function (x) { return x.label === p.label; })) out.push(p); }
    if (seller) {
      var orders = unreadOf("order_new");
      if (orders > 0) add({ label: "New orders", badge: orders, hot: true, q: (by["Called my new orders?"] || {}).q || "Has the AI agent called my new orders yet?", display: "Called my new orders?" });
      var dg = todayDigest(), ab = dg && dg.data && dg.data.abandoned;
      if (ab >= 3) add({ label: ab + " left without ordering", hot: true, q: ab + " people started my checkout today but didn't order. Why might that be, and what should I change?" });
      if (h >= 18) add({ label: "How did today go?", q: "Summarize today for me: orders, ad spend, visitors, people who left without ordering, and what I should do tomorrow." });
      add(by[h < 12 ? "What should I scale?" : "What should I kill?"]);
    }
    all.forEach(function (a) { if (out.length < 4 && !a.teach) add(a); });
    return out.slice(0, 4);
  }

  function chip(p) {
    return '<button type="button" class="ch-sugg' + (p.hot ? " hot" : "") + '" data-q="' + esc(p.q) + '" data-d="' + esc(p.display || p.label) + '">' +
      (p.badge ? '<span class="n">' + p.badge + "</span>" : "") + esc(p.label) + "</button>";
  }
  function render() {
    var el = document.getElementById("chSuggs"); if (!el) return;
    el.classList.add("ch-smart");
    el.innerHTML = picks().map(chip).join("") + '<button type="button" class="ch-sugg more" data-more="1">More ✦</button>';
  }

  function sheet() {
    var m = document.getElementById("chMore");
    if (!m) {
      m = document.createElement("div"); m.id = "chMore";
      m.innerHTML = '<div class="sheet" role="dialog" aria-label="Ask your AI"><div class="grab"></div><div class="hd"><b>What do you want to do?</b><button type="button" data-close="1" aria-label="Close">✕</button></div><div class="bd"></div></div>';
      var panel = document.getElementById("chatPanel"); (panel || document.body).appendChild(m);
      m.addEventListener("click", function (e) {
        if (e.target === m || e.target.closest("[data-close]")) { m.classList.remove("on"); return; }
        var it = e.target.closest(".it"); if (!it) return;
        m.classList.remove("on");
        if (it.dataset.teach) { if (window.bvImportAds) bvImportAds(); return; }
        if (window.askChat) askChat(it.dataset.q, it.dataset.d);
      });
    }
    var groups = {};
    state.all.forEach(function (a) { var g = a.teach ? "Teach" : a.group; (groups[g] = groups[g] || []).push(a); });
    m.querySelector(".bd").innerHTML = GROUP_ORDER.filter(function (g) { return groups[g]; }).map(function (g) {
      return "<h5>" + esc(g) + "</h5>" + groups[g].map(function (a) {
        return '<button type="button" class="it" data-q="' + esc(a.q) + '" data-d="' + esc(a.label) + '"' + (a.teach ? ' data-teach="1"' : "") + "><b>" + esc(a.label) + "</b><span>" + esc(a.sub) + "</span></button>";
      }).join("");
    }).join("");
    m.classList.add("on");
  }

  // role: current role; extra/base: [[question, label], ...] exactly as renderChatForRole() builds them.
  window.rvSmartSuggest = function (role, extra, base) {
    if (!document.getElementById("rvSmartCss")) { var st = document.createElement("style"); st.id = "rvSmartCss"; st.textContent = css; document.head.appendChild(st); }
    state.role = role;
    state.all = (extra || []).concat(base || []).map(function (p) {
      var m = META[p[1]] || ["Ask", "Ask your AI"];
      return { q: p[0], label: p[1], group: m[0], sub: m[1] };
    });
    if (["owner", "admin", "buyer"].indexOf(role) >= 0) state.all.push({ q: "", label: "Teach the AI from my past ads", group: "Teach", sub: "It reads your old ads and learns what worked for you", teach: true });
    var el = document.getElementById("chSuggs");
    if (el && !el.dataset.wired) {
      el.dataset.wired = "1";
      el.addEventListener("click", function (e) {
        var b = e.target.closest(".ch-sugg"); if (!b) return;
        if (b.dataset.more) { sheet(); return; }
        if (window.askChat) askChat(b.dataset.q, b.dataset.d);
      });
    }
    render();
  };
  // Re-pick when a new order or the daily report arrives (only matters while the row is showing).
  document.addEventListener("rvn:change", function () { var el = document.getElementById("chSuggs"); if (el && state.all.length && el.style.display !== "none") render(); });
})();
