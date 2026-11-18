/* Revora notifications: the bell, the inbox sheet, live toasts, the end-of-day report card,
   and "your pages" numbers (Revora's own visit counting, independent of Meta / Clarity).

   Data comes from the `notifications` table (see supabase/migrations/20261118140000_notifications.sql):
   rows are written by the database when things happen (new order, delivered, lead, top-up, AI alerts,
   the 9pm digest) and arrive here live over Realtime. Phone pushes are sent by the same function.

   Needs from dashboard_new.html: supabaseClient, window.myProfile, escH, bvOpenTarget, toggleChat, askChat.
   Public API: rvnInit(), rvnOpen(), rvnClose(), window.rvn (state, read by the smart chat suggestions). */
(function () {
  "use strict";

  var FILTERS = [
    { k: "all", label: "All" },
    { k: "orders", label: "Orders", cats: ["orders", "leads"] },
    { k: "chats", label: "Chats", cats: ["messages"] },
    { k: "reports", label: "Reports", cats: ["reports"] },
    { k: "money", label: "Money", cats: ["money"] },
  ];
  var ICONS = {
    orders: '<path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>',
    leads: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>',
    reports: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    ads: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
    money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
    messages: '<path d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8z"/>',
    system: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    bell: '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>',
  };
  var S = (window.rvn = { items: [], unread: 0, loaded: false, error: null, isUnread: function (n) { return isUnread(n); } });
  var filter = "all", isOpen = false, range = "today", stats = null, statsErr = false, channel = null, poll = null, toastTimer = null;

  function esc(v) { return (window.escH ? window.escH(v) : String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; })); }
  function svg(name, size) { return '<svg width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.system) + "</svg>"; }
  function naira(n) { return "₦" + Math.round(Number(n) || 0).toLocaleString("en-NG"); }
  function short(n) { n = Number(n) || 0; return n >= 1e6 ? "₦" + (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e4 ? "₦" + Math.round(n / 1e3) + "k" : naira(n); }
  function plain(t) { return String(t || "").replace(/^[\p{Extended_Pictographic}\uFE0F\u200d\s]+/u, ""); }  // the round icon already says what it is
  function myId() { return (window.myProfile && window.myProfile.id) || S.uid || null; }
  function isUnread(n) { var id = myId(); return !id || (n.read_by || []).indexOf(id) < 0; }
  function ago(ts) {
    var s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return "now";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  }
  function dayLabel(ts) {
    var d = new Date(ts), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
    if (d.toDateString() === t.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" });
  }
  function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }

  // ── CSS ───────────────────────────────────────────────────────────────────
  var css = `
#rvBell{position:relative;width:34px;height:34px;border-radius:50%;background:var(--panel2);border:1.5px solid var(--border);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-left:auto;transition:all .15s}
#rvBell:hover{border-color:var(--accent);color:var(--accent)}
#rvBell .rvn-badge{position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:#ef4444;color:#fff;font-size:10.5px;font-weight:700;display:none;align-items:center;justify-content:center;border:2px solid var(--bg,#fff);box-sizing:content-box;line-height:1}
#rvBell.has .rvn-badge{display:flex}
#rvBell.ring svg{animation:rvnRing .7s ease}
@keyframes rvnRing{0%,100%{transform:rotate(0)}20%{transform:rotate(14deg)}40%{transform:rotate(-12deg)}60%{transform:rotate(8deg)}80%{transform:rotate(-4deg)}}
@media(max-width:760px){.hdr #rvBell{margin-left:auto}.hdr .hdr-menu-btn{margin-left:0}}
#rvnBack{position:fixed;inset:0;z-index:9100;background:rgba(10,12,16,.45);opacity:0;pointer-events:none;transition:opacity .2s}
#rvnBack.on{opacity:1;pointer-events:auto}
#rvnSheet{position:fixed;z-index:9101;top:0;right:0;bottom:0;width:min(440px,100vw);background:var(--bg,#fff);color:var(--text);display:flex;flex-direction:column;transform:translateX(100%);transition:transform .26s cubic-bezier(.2,.8,.2,1);box-shadow:-12px 0 40px rgba(0,0,0,.18);border-left:1px solid var(--border)}
#rvnSheet.on{transform:none}
@media(max-width:760px){#rvnSheet{width:100vw;border-left:0;transform:translateY(100%)}#rvnSheet.on{transform:none}}
.rvn-top{display:flex;align-items:center;gap:8px;padding:calc(14px + env(safe-area-inset-top)) 16px 8px}
.rvn-top h2{margin:0;font-size:21px;font-weight:700;letter-spacing:-.01em;flex:1}
.rvn-link{background:none;border:0;color:var(--accent);font:inherit;font-size:13px;font-weight:600;cursor:pointer;padding:6px 4px}
.rvn-link:disabled{color:var(--muted);cursor:default}
.rvn-x{width:34px;height:34px;border-radius:50%;border:0;background:var(--panel2);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center}
.rvn-chips{display:flex;gap:7px;padding:4px 16px 10px;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--border)}
.rvn-chips::-webkit-scrollbar{display:none}
.rvn-chip{flex:none;border:1px solid var(--border);background:var(--panel);color:var(--text2);border-radius:999px;padding:7px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.rvn-chip.on{background:var(--text);border-color:var(--text);color:var(--bg,#fff)}
.rvn-chip em{font-style:normal;opacity:.65;margin-left:5px;font-weight:700}
.rvn-body{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:12px 16px calc(24px + env(safe-area-inset-bottom))}
.rvn-day{font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:16px 2px 8px}
.rvn-day:first-child{margin-top:4px}
.rvn-card{display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;font:inherit;color:inherit;background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:13px 14px;margin-bottom:8px;cursor:pointer;position:relative}
.rvn-card:active{transform:scale(.99)}
.rvn-card.unread{border-color:color-mix(in srgb,var(--accent) 38%,var(--border));background:color-mix(in srgb,var(--accent) 5%,var(--panel))}
.rvn-ico{width:38px;height:38px;border-radius:12px;flex:none;display:flex;align-items:center;justify-content:center;background:rgba(24,119,242,.12);color:#1877F2}
.rvn-ico.success{background:rgba(26,154,74,.13);color:#1a9a4a}
.rvn-ico.warn{background:rgba(245,165,36,.17);color:#b7791f}
.rvn-main{flex:1;min-width:0}
.rvn-t{font-size:14.5px;font-weight:650;line-height:1.3;display:flex;gap:8px;align-items:baseline}
.rvn-t span{flex:1}
.rvn-t time{flex:none;font-size:11.5px;font-weight:500;color:var(--muted)}
.rvn-b{font-size:13px;color:var(--text2);margin-top:2px;line-height:1.4;word-break:break-word;padding-right:14px}
.rvn-dot{position:absolute;right:12px;bottom:12px;width:8px;height:8px;border-radius:50%;background:var(--accent)}
.rvn-digest{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:11px}
.rvn-stat{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:9px 10px;min-width:0}
.rvn-stat b{display:block;font-size:16px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rvn-stat span{display:block;font-size:11px;color:var(--muted);margin-top:1px;line-height:1.25}
.rvn-stat.bad b{color:#d93025}
.rvn-ask{margin-top:10px;border:1px solid var(--accent);background:transparent;color:var(--accent);border-radius:999px;padding:7px 13px;font:inherit;font-size:12.5px;font-weight:650;cursor:pointer}
.rvn-pages{border:1px solid var(--border);border-radius:16px;background:var(--panel);padding:13px 14px;margin-bottom:6px}
.rvn-ph{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.rvn-ph b{flex:1;font-size:13.5px}
.rvn-seg{display:inline-flex;background:var(--panel2);border:1px solid var(--border);border-radius:999px;padding:2px}
.rvn-seg button{border:0;background:transparent;color:var(--text2);font:inherit;font-size:12px;font-weight:600;padding:4px 11px;border-radius:999px;cursor:pointer}
.rvn-seg button.on{background:var(--text);color:var(--bg,#fff)}
.rvn-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
@media(max-width:380px){.rvn-grid4{grid-template-columns:1fr 1fr}}
.rvn-src{font-size:12px;color:var(--text2);margin-top:9px}
.rvn-empty{text-align:center;padding:48px 24px;color:var(--text2)}
.rvn-empty .big{width:64px;height:64px;border-radius:22px;background:var(--panel2);display:inline-flex;align-items:center;justify-content:center;color:var(--muted);margin-bottom:12px}
.rvn-empty h3{margin:0 0 4px;font-size:17px;color:var(--text)}
.rvn-empty p{margin:0;font-size:13.5px;line-height:1.5}
.rvn-sk{height:66px;border-radius:16px;background:linear-gradient(90deg,var(--panel2),var(--border),var(--panel2));background-size:200% 100%;animation:rvnSk 1.2s infinite;margin-bottom:8px}
@keyframes rvnSk{to{background-position:-200% 0}}
.rvn-foot{display:flex;justify-content:center;padding-top:6px}
#rvnToast{position:fixed;z-index:9200;top:calc(10px + env(safe-area-inset-top));left:50%;width:min(420px,calc(100vw - 20px));transform:translate(-50%,-140%);transition:transform .35s cubic-bezier(.2,1.1,.3,1);background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:18px;box-shadow:0 14px 40px rgba(0,0,0,.22);padding:12px 14px;display:flex;gap:12px;align-items:center;cursor:pointer}
#rvnToast.on{transform:translate(-50%,0)}
@media(prefers-reduced-motion:reduce){#rvnSheet,#rvnToast{transition:none}#rvBell.ring svg{animation:none}}
`;

  function injectUi() {
    if (document.getElementById("rvnStyle")) return;
    var st = document.createElement("style"); st.id = "rvnStyle"; st.textContent = css; document.head.appendChild(st);
    var bell = document.getElementById("rvBell");
    if (!bell) {
      bell = document.createElement("button");
      bell.id = "rvBell"; bell.type = "button"; bell.setAttribute("aria-label", "Notifications"); bell.title = "Notifications";
      bell.innerHTML = svg("bell", 17) + '<span class="rvn-badge" id="rvBellN"></span>';
      var hdr = document.querySelector(".hdr"), right = hdr && hdr.querySelector(".hdr-right");
      if (hdr) hdr.insertBefore(bell, right || hdr.lastElementChild); else document.body.appendChild(bell);
    }
    bell.addEventListener("click", function () { isOpen ? rvnClose() : rvnOpen(); });
    var back = document.createElement("div"); back.id = "rvnBack"; back.addEventListener("click", rvnClose);
    var sheet = document.createElement("div"); sheet.id = "rvnSheet"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-label", "Notifications"); sheet.setAttribute("aria-hidden", "true");
    sheet.innerHTML = '<div class="rvn-top"><h2>Notifications</h2><button class="rvn-link" id="rvnAll" type="button">Mark all read</button>' +
      '<button class="rvn-x" id="rvnX" type="button" aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>' +
      '<div class="rvn-chips" id="rvnChips"></div><div class="rvn-body" id="rvnBody"></div>';
    var toast = document.createElement("div"); toast.id = "rvnToast"; toast.setAttribute("role", "status");
    document.body.appendChild(back); document.body.appendChild(sheet); document.body.appendChild(toast);
    sheet.querySelector("#rvnX").addEventListener("click", rvnClose);
    sheet.querySelector("#rvnAll").addEventListener("click", markAllRead);
    sheet.querySelector("#rvnChips").addEventListener("click", function (e) { var b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; paint(); } });
    sheet.querySelector("#rvnBody").addEventListener("click", onBodyClick);
    toast.addEventListener("click", function () { var id = toast.dataset.id; hideToast(); var n = S.items.filter(function (x) { return x.id === id; })[0]; if (n) go(n); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen) rvnClose(); });
  }

  // ── data ──────────────────────────────────────────────────────────────────
  function load() {
    return supabaseClient.from("notifications").select("*").order("created_at", { ascending: false }).limit(80).then(function (r) {
      if (r.error) { S.error = r.error.message || "error"; S.loaded = true; }
      else { S.items = r.data || []; S.error = null; S.loaded = true; }
      recount(); if (isOpen) paint();
    }, function (e) { S.error = String(e && e.message || e); S.loaded = true; if (isOpen) paint(); });
  }
  function recount() {
    S.unread = S.items.filter(isUnread).length;
    var bell = document.getElementById("rvBell"), n = document.getElementById("rvBellN");
    if (bell && n) { n.textContent = S.unread > 99 ? "99+" : String(S.unread); bell.classList.toggle("has", S.unread > 0); }
    try { document.dispatchEvent(new CustomEvent("rvn:change")); } catch (e) {}
  }
  function loadStats() {
    var from = range === "today" ? startOfToday() : new Date(Date.now() - 7 * 864e5);
    return supabaseClient.rpc("rv_visit_stats", { p_from: from.toISOString(), p_to: new Date().toISOString() }).then(function (r) {
      if (r.error) { statsErr = true; stats = null; } else { statsErr = false; stats = r.data || {}; }
      if (isOpen) paint();
    }, function () { statsErr = true; if (isOpen) paint(); });
  }
  function markRead(ids) {
    var id = myId(); if (!id) return Promise.resolve();
    S.items.forEach(function (n) { if ((!ids || ids.indexOf(n.id) >= 0) && isUnread(n)) { n.read_by = (n.read_by || []).concat([id]); } });
    recount(); if (isOpen) paint();
    return supabaseClient.rpc("rv_mark_notifications_read", { p_ids: ids || null }).then(function () {}, function () {});
  }
  function markAllRead() { markRead(null); }

  // ── rendering ─────────────────────────────────────────────────────────────
  function visible() {
    var f = FILTERS.filter(function (x) { return x.k === filter; })[0];
    return !f || !f.cats ? S.items : S.items.filter(function (n) { return f.cats.indexOf(n.category) >= 0; });
  }
  function pagesBlock() {
    if (statsErr) return "";
    var d = stats || {};
    var tile = function (v, l, bad) { return '<div class="rvn-stat' + (bad ? " bad" : "") + '"><b>' + esc(v) + "</b><span>" + esc(l) + "</span></div>"; };
    var src = (d.sources || []).slice(0, 3).map(function (x) { return esc(x.source) + " " + x.visitors; }).join(" · ");
    return '<div class="rvn-pages"><div class="rvn-ph"><b>Your pages</b><span class="rvn-seg">' +
      '<button type="button" data-range="today" class="' + (range === "today" ? "on" : "") + '">Today</button>' +
      '<button type="button" data-range="7d" class="' + (range === "7d" ? "on" : "") + '">7 days</button></span></div>' +
      (stats ? '<div class="rvn-grid4">' + tile(d.visitors || 0, "Visitors") + tile(d.checkout_started || 0, "Started checkout") + tile(d.abandoned || 0, "Left without ordering", (d.abandoned || 0) > 0) + tile(d.ordered || 0, "Ordered") + "</div>" +
        (src ? '<div class="rvn-src">Where they came from: ' + src + "</div>" : "") :
        '<div class="rvn-grid4"><div class="rvn-sk" style="height:54px;margin:0"></div><div class="rvn-sk" style="height:54px;margin:0"></div><div class="rvn-sk" style="height:54px;margin:0"></div><div class="rvn-sk" style="height:54px;margin:0"></div></div>') + "</div>";
  }
  function card(n) {
    var d = n.data || {}, digest = n.kind === "daily_digest";
    var extra = "";
    if (digest) {
      var t = function (v, l, bad) { return '<div class="rvn-stat' + (bad ? " bad" : "") + '"><b>' + esc(v) + "</b><span>" + esc(l) + "</span></div>"; };
      extra = '<div class="rvn-digest">' + t(d.orders || 0, "Orders") + t(short(d.revenue), "Revenue") + t(d.visitors || 0, "Visitors") +
        t(d.abandoned || 0, "Left without ordering", (d.abandoned || 0) > 0) + t(short(d.ad_spend), "Ad spend") + t(d.delivered || 0, "Delivered") + "</div>" +
        '<button type="button" class="rvn-ask" data-ask="' + esc(n.id) + '">Ask AI how today went</button>';
    }
    return '<div class="rvn-card' + (isUnread(n) ? " unread" : "") + '" role="button" tabindex="0" data-id="' + esc(n.id) + '">' +
      '<div class="rvn-ico ' + esc(n.severity) + '">' + svg(n.category) + "</div>" +
      '<div class="rvn-main"><div class="rvn-t"><span>' + esc(plain(n.title)) + "</span><time>" + ago(n.created_at) + "</time></div>" +
      (n.body ? '<div class="rvn-b">' + esc(n.body) + "</div>" : "") + extra + "</div>" +
      (isUnread(n) ? '<i class="rvn-dot" aria-label="Unread"></i>' : "") + "</div>";
  }
  function paint() {
    var chips = document.getElementById("rvnChips"), body = document.getElementById("rvnBody"), all = document.getElementById("rvnAll");
    if (!chips || !body) return;
    chips.innerHTML = FILTERS.map(function (f) {
      var u = S.items.filter(function (n) { return isUnread(n) && (!f.cats || f.cats.indexOf(n.category) >= 0); }).length;
      return '<button type="button" class="rvn-chip' + (f.k === filter ? " on" : "") + '" data-f="' + f.k + '">' + f.label + (u ? "<em>" + u + "</em>" : "") + "</button>";
    }).join("");
    all.disabled = S.unread === 0;
    var html = filter === "all" || filter === "reports" ? pagesBlock() : "";
    if (!S.loaded) html += '<div class="rvn-sk"></div><div class="rvn-sk"></div><div class="rvn-sk"></div>';
    else if (S.error) html += '<div class="rvn-empty"><div class="big">' + svg("system", 28) + "</div><h3>Notifications aren't ready yet</h3><p>Please try again in a moment.</p></div>";
    else {
      var list = visible();
      if (!list.length) {
        html += '<div class="rvn-empty"><div class="big">' + svg("bell", 28) + "</div><h3>" + (filter === "all" ? "You're all caught up" : "Nothing here yet") + "</h3><p>New orders show up here the moment they land, and your end-of-day report arrives at 9pm.</p></div>";
      } else {
        var last = "";
        list.forEach(function (n) { var dl = dayLabel(n.created_at); if (dl !== last) { html += '<div class="rvn-day">' + esc(dl) + "</div>"; last = dl; } html += card(n); });
      }
    }
    html += '<div class="rvn-foot"><button class="rvn-link" type="button" data-settings="1">Notification settings</button></div>';
    var keep = body.scrollTop; body.innerHTML = html; body.scrollTop = keep;
  }
  function onBodyClick(e) {
    var seg = e.target.closest("[data-range]");
    if (seg) { range = seg.dataset.range; stats = null; paint(); loadStats(); return; }
    var ask = e.target.closest("[data-ask]");
    if (ask) { e.stopPropagation(); rvnClose(); markRead([ask.dataset.ask]); if (window.toggleChat) toggleChat(true); if (window.askChat) askChat("Summarize today for me: orders, ad spend, visitors, people who left without ordering, and what I should do tomorrow.", "How did today go?"); return; }
    if (e.target.closest("[data-settings]")) { rvnClose(); var t = document.querySelector('[data-tab="settings"]'); if (t) t.click(); return; }
    var c = e.target.closest(".rvn-card");
    if (c) { var n = S.items.filter(function (x) { return x.id === c.dataset.id; })[0]; if (n) go(n); }
  }
  function go(n) {
    markRead([n.id]);
    rvnClose();
    var target = null;
    try { target = new URL(n.url || "", location.origin).searchParams.get("open"); } catch (e) {}
    if (target && window.bvOpenTarget) bvOpenTarget(target);
  }

  // ── live toast ────────────────────────────────────────────────────────────
  function hideToast() { var t = document.getElementById("rvnToast"); if (t) t.classList.remove("on"); clearTimeout(toastTimer); }
  function showToast(n) {
    var t = document.getElementById("rvnToast"); if (!t || isOpen) return;
    t.dataset.id = n.id;
    t.innerHTML = '<div class="rvn-ico ' + esc(n.severity) + '">' + svg(n.category) + '</div><div class="rvn-main"><div class="rvn-t"><span>' + esc(plain(n.title)) + "</span></div>" + (n.body ? '<div class="rvn-b">' + esc(n.body) + "</div>" : "") + "</div>";
    t.classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, 6000);
    var bell = document.getElementById("rvBell"); if (bell) { bell.classList.remove("ring"); void bell.offsetWidth; bell.classList.add("ring"); }
  }
  function onInsert(payload) {
    var n = payload && payload.new; if (!n || S.items.some(function (x) { return x.id === n.id; })) return;
    S.items.unshift(n); S.items = S.items.slice(0, 80);
    recount(); if (isOpen) paint();
    if (n.kind !== "daily_digest" || document.visibilityState === "visible") showToast(n);
  }
  function subscribe() {
    if (channel) return;
    try {
      channel = supabaseClient.channel("rv-notifications").on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, onInsert).subscribe();
    } catch (e) {}
    // Safety net if the socket drops (flaky mobile data): refresh now and then while the app is in view.
    poll = setInterval(function () { if (document.visibilityState === "visible") load(); }, 90000);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") load(); });
  }

  // ── public ────────────────────────────────────────────────────────────────
  function rvnOpen() {
    injectUi(); isOpen = true; hideToast();
    document.getElementById("rvnBack").classList.add("on");
    var s = document.getElementById("rvnSheet"); s.classList.add("on"); s.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    paint(); load(); loadStats();
    var x = document.getElementById("rvnX"); if (x) x.focus({ preventScroll: true });
  }
  function rvnClose() {
    isOpen = false;
    var b = document.getElementById("rvnBack"), s = document.getElementById("rvnSheet");
    if (b) b.classList.remove("on");
    if (s) { s.classList.remove("on"); s.setAttribute("aria-hidden", "true"); }
    document.body.style.overflow = "";
  }
  function rvnInit() {
    if (S.inited) return; S.inited = true;
    S.uid = window.myProfile && window.myProfile.id;
    var go2 = function () {
      injectUi();
      var pr = S.uid ? Promise.resolve() : supabaseClient.auth.getSession().then(function (r) { S.uid = r.data && r.data.session && r.data.session.user.id; });
      pr.then(function () { return load(); }).then(function () {
        subscribe();
        if (window.bvPendingBell) { window.bvPendingBell = false; rvnOpen(); }
      });
    };
    go2();
  }
  window.rvnInit = rvnInit; window.rvnOpen = rvnOpen; window.rvnClose = rvnClose;
})();
