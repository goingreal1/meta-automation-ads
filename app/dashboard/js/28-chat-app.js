// Revora dashboard, part 28: CHAT APP LOOK (Claude-mobile style chat screen)
// Restyles the Assistant tab: greeting + four suggestion cards, a pill composer (plus, hold-to-talk mic, send), a header with a
// hamburger that goes back to Overview, and a pill bar Chat / Plans / Code / Projects. The chat logic itself (22-ai-chat.js,
// 27-chat-cards.js) is unchanged, and every confirm card still works the same: nothing runs without a tap.
// Add ?classic=1 to the address to get the old look back.
(function () {
  if (/[?&]classic=1/.test(location.search)) return;
  const panel = document.getElementById("chatPanel");
  if (!panel) return;
  panel.classList.add("cm");

  // ── look (uses the dashboard's own colour tokens, so light and dark both work) ──────────────────────────────
  const css = `
  .cm-head,.cm-star,.cm-nav,#cmView{display:none}
  #chatPanel.cm.page .cm-head{display:flex;align-items:center;justify-content:space-between;gap:8px;width:min(780px,100%);margin:0 auto;padding:calc(10px + env(safe-area-inset-top)) 16px 4px;box-sizing:border-box}
  #chatPanel.cm.page .ch-head{display:none}
  .cm-rb{width:44px;height:44px;border-radius:99px;background:var(--panel);border:1px solid var(--border);box-shadow:0 2px 10px rgba(0,0,0,.06);display:flex;align-items:center;justify-content:center;flex:none;cursor:pointer;color:var(--text);padding:0}
  .cm-rb svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  #cmTitle{flex:1;text-align:center;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  #chatPanel.cm.page.empty #cmTitle,#chatPanel.cm.page.empty #cmNew{visibility:hidden}
  #chatPanel.cm.page{background:var(--bg)}
  #chatPanel.cm.page.empty .ch-head{display:none}
  #chatPanel.cm.page.empty .cm-star{display:block;margin:0 auto 14px}
  #chatPanel.cm.page.empty .ch-hello{font-size:34px;line-height:1.15;letter-spacing:-.01em;margin-bottom:6px}
  #chatPanel.cm.page.empty #chWelcomeMsg,#chatPanel.cm.page #chWelcomeMsg{display:none}
  #chatPanel.cm.page.empty{justify-content:flex-start}
  #chatPanel.cm.page.empty .ch-msgs{flex:1;order:0;display:flex;flex-direction:column;justify-content:center;align-items:center;overflow:hidden}
  #chatPanel.cm.page.empty .ch-suggs{order:1;display:grid !important;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:0 16px 12px}
  #chatPanel.cm.page.empty .ch-inp{order:2}
  .cm-card{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;border:1px solid var(--borderStrong,var(--border));background:var(--panel);border-radius:16px;padding:12px 14px;font:inherit;font-size:14px;line-height:1.35;color:var(--text);text-align:left;min-height:44px;cursor:pointer}
  .cm-card small{display:block;color:var(--muted);font-size:12px;margin-top:2px}
  #chatPanel.cm.page .ch-msgs{padding:8px 16px 8px}
  #chatPanel.cm.page .ch-msg.bot{font-family:'Fraunces',Georgia,serif;font-size:16.5px;line-height:1.5}
  #chatPanel.cm.page .ch-msg.user{background:var(--hover,var(--panel2));color:var(--text);border-radius:20px 20px 6px 20px;font-size:15px;padding:11px 14px;box-shadow:none}
  #chatPanel.cm.page .ch-inp{display:flex;align-items:center;gap:6px;width:auto;margin:0 16px;padding:7px;border:1px solid var(--border);border-radius:30px;background:var(--panel);box-shadow:0 4px 18px rgba(0,0,0,.07);position:relative}
  #chatPanel.cm.page .ch-inp textarea{flex:1;min-width:0;min-height:40px;max-height:140px;padding:10px 4px;border:0;background:transparent;box-shadow:none;border-radius:0;font-size:16px}
  #chatPanel.cm.page .ch-inp textarea:focus{box-shadow:none;border:0}
  #chatPanel.cm.page .ch-inp button{position:static;width:44px;height:44px;border-radius:99px;flex:none;background:var(--text);color:var(--bg);font-size:20px;bottom:auto;right:auto}
  #chatPanel.cm.page .ch-inp button:disabled{background:var(--border)}
  #chatPanel.cm.page .ch-inp .cm-sm{width:40px;height:40px;background:var(--panel2);color:var(--text);display:flex;align-items:center;justify-content:center}
  .cm-sm svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  #chatPanel.cm.page .ch-inp .cm-sm.rec{background:#d93025;color:#fff}
  #cmPlus{position:absolute;left:12px;bottom:64px;background:var(--panel);border:1px solid var(--border);border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.14);padding:6px;display:none;z-index:5}
  #cmPlus button{display:block;width:100%;text-align:left;background:none;border:0;padding:12px 14px;border-radius:10px;font:inherit;font-size:14px;color:var(--text);cursor:pointer;min-height:44px}
  #cmPlus button:hover{background:var(--hover)}
  #chatPanel.cm.page .cm-nav.on{display:flex;gap:4px;margin:10px 16px calc(14px + env(safe-area-inset-bottom));padding:6px;background:var(--panel);border:1px solid var(--border);border-radius:34px;box-shadow:0 4px 18px rgba(0,0,0,.07);width:auto;box-sizing:border-box;align-self:center;max-width:520px;width:calc(100% - 32px)}
  #chatPanel.cm.page .cm-nav{order:9}
  #chatPanel.cm.page .ch-inp textarea::placeholder{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:15px}
  .cm-nav button{flex:1;min-height:44px;border:0;background:none;border-radius:28px;font:inherit;font-size:12px;font-weight:600;color:var(--text2);padding:6px 0 5px;cursor:pointer}
  .cm-nav button svg{display:block;margin:0 auto 2px;width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
  .cm-nav button[aria-current=page]{background:var(--panel2);color:var(--text)}
  #chatPanel.cm.page.cm-tab .ch-msgs,#chatPanel.cm.page.cm-tab .ch-inp,#chatPanel.cm.page.cm-tab .ch-suggs{display:none !important}
  #chatPanel.cm.page.cm-tab #cmView{display:block;flex:1;overflow-y:auto;width:min(780px,100%);margin:0 auto;padding:0 0 8px;-webkit-overflow-scrolling:touch}
  #chatPanel.cm.page.cm-tab #cmTitle,#chatPanel.cm.page.cm-tab #cmNew{visibility:visible}
  @media (max-width:760px){
    #chatPanel.cm.page{top:0;left:0;z-index:1200;height:100vh;height:100dvh}
    body.assist-on .bottom-nav{display:none !important}
  }`;
  const st = document.createElement("style"); st.id = "cmCss"; st.textContent = css; document.head.appendChild(st);

  const I = {
    menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h10M4 17h16"/></svg>',
    pen: '<svg viewBox="0 0 24 24"><path d="M12 20h8M16 4l4 4L8 20H4v-4z"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    plans: '<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM9 9h6M9 13h6"/></svg>',
    code: '<svg viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>',
    proj: '<svg viewBox="0 0 24 24"><path d="M3 7h6l2 2h10v10H3z"/></svg>',
  };

  // ── header ───────────────────────────────────────────────────────────────────────────────────────────────────
  const head = document.createElement("div"); head.className = "cm-head";
  head.innerHTML = `<button type="button" class="cm-rb" id="cmHome" aria-label="Back to Overview">${I.menu}</button><div id="cmTitle">New chat</div><button type="button" class="cm-rb" id="cmNew" aria-label="New chat">${I.pen}</button>`;
  panel.insertBefore(head, panel.firstChild);
  document.getElementById("cmHome").onclick = () => { cmTab("chat"); document.querySelector('.tab-btn[data-tab="overview"]')?.click(); };
  document.getElementById("cmNew").onclick = () => { cmTab("chat"); chNew(); };

  // star mark above the greeting
  const msgs = document.getElementById("chMsgs");
  const star = document.createElement("div"); star.className = "cm-star";
  star.innerHTML = '<svg width="54" height="54" viewBox="0 0 54 54" aria-hidden="true"><g stroke="#1877F2" stroke-width="4" stroke-linecap="round"><path d="M27 4v14M27 36v14M4 27h14M36 27h14M11 11l10 10M33 33l10 10M43 11L33 21M21 33L11 43"/></g></svg>';
  msgs.insertBefore(star, msgs.firstChild);

  // ── suggestion cards ──────────────────────────────────────────────────────────────────────────────────────────
  const CARDS = {
    admin: [
      ["Run autopilot for a product", "Research to a launch you approve", "Run autopilot for one of my products. Ask me which product and the budgets."],
      ["Change a campaign plan", "Start time, budget, ad sets", "I want to change a campaign plan. Show me my drafts first."],
      ["Make ad images", "From your product photo", "Make ad images for one of my products. Ask me which product and what look I want."],
      ["Build a sales page", "Real HTML files", "Build a sales page for one of my products. Ask me which product."],
    ],
    buyer: [
      ["Which ads should I kill?", "Against your own rules", "Which ads break my kill thresholds?"],
      ["Change a campaign plan", "Start time, budget, ad sets", "I want to change a campaign plan. Show me my drafts first."],
      ["Make ad images", "From your product photo", "Make ad images for one of my products. Ask me which product and what look I want."],
      ["Build a sales page", "Real HTML files", "Build a sales page for one of my products. Ask me which product."],
    ],
  };
  function cmCards(role) {
    const box = document.getElementById("chSuggs");
    const list = CARDS[role === "owner" ? "admin" : role] || null;
    if (!box) return;
    if (!list) return; // care / delivery keep their own suggestions
    box.innerHTML = list.map((c, i) => `<button type="button" class="cm-card" data-i="${i}">${escH(c[0])}<small>${escH(c[1])}</small></button>`).join("");
    box.querySelectorAll(".cm-card").forEach(b => b.onclick = () => { const c = list[+b.dataset.i]; askChat(c[2], c[0]); });
  }
  if (typeof renderChatForRole === "function") {
    const orig = renderChatForRole;
    window.renderChatForRole = function (role) { orig(role); cmCards(role); };
  }
  cmCards(window.myProfile?.role);

  // ── composer: plus, hold-to-talk, send ────────────────────────────────────────────────────────────────────────
  const inp = panel.querySelector(".ch-inp"), ta = document.getElementById("chInput"), send = document.getElementById("chSend");
  const plus = document.createElement("button"); plus.type = "button"; plus.className = "cm-sm"; plus.setAttribute("aria-label", "Add"); plus.innerHTML = I.plus;
  inp.insertBefore(plus, ta);
  const menu = document.createElement("div"); menu.id = "cmPlus"; menu.innerHTML = '<button type="button" data-a="pics">Add pictures or video</button>';
  inp.appendChild(menu);
  plus.onclick = (e) => { e.stopPropagation(); menu.style.display = menu.style.display === "block" ? "none" : "block"; };
  document.addEventListener("click", () => { menu.style.display = "none"; });
  menu.querySelector('[data-a="pics"]').onclick = () => { cmTab("chat"); appendCards([{ type: "upload", purpose: "Add pictures or video", product: null, video: true }]); };
  send.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    const mic = document.createElement("button"); mic.type = "button"; mic.className = "cm-sm"; mic.setAttribute("aria-label", "Hold to talk"); mic.innerHTML = I.mic;
    inp.insertBefore(mic, send);
    let rec = null, base = "";
    const stop = () => { try { rec && rec.stop(); } catch {} mic.classList.remove("rec"); };
    mic.addEventListener("pointerdown", (e) => {
      e.preventDefault(); base = ta.value ? ta.value.trimEnd() + " " : "";
      try {
        rec = new SR(); rec.lang = "en-NG"; rec.interimResults = true; rec.continuous = true;
        rec.onresult = (ev) => { let t = ""; for (const r of ev.results) t += r[0].transcript; ta.value = base + t; ta.dispatchEvent(new Event("input")); };
        rec.onend = () => mic.classList.remove("rec"); rec.onerror = stop;
        rec.start(); mic.classList.add("rec");
      } catch { stop(); }
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(ev => mic.addEventListener(ev, stop));
  }

  // ── pill bar and tabs ─────────────────────────────────────────────────────────────────────────────────────────
  // Plans, Code and Projects are added by 29-chat-tabs.js through window.cmTabs.
  window.cmTabs = window.cmTabs || {};
  const nav = document.createElement("div"); nav.className = "cm-nav"; nav.setAttribute("aria-label", "Sections");
  panel.appendChild(nav);
  const view = document.createElement("div"); view.id = "cmView"; panel.insertBefore(view, document.getElementById("chMsgs"));
  let current = "chat";
  function cmNavPaint() {
    const staff = ["owner", "admin", "buyer"].includes(window.myProfile?.role);
    const defs = [["chat", "Chat", I.chat], ...(staff ? [["plans", "Plans", I.plans], ["code", "Code", I.code], ["projects", "Projects", I.proj]].filter(t => window.cmTabs[t[0]]) : [])];
    nav.classList.toggle("on", defs.length > 1);
    nav.innerHTML = defs.map(d => `<button type="button" data-t="${d[0]}" ${d[0] === current ? 'aria-current="page"' : ""}>${d[2]}${d[1]}</button>`).join("");
    nav.querySelectorAll("button").forEach(b => b.onclick = () => cmTab(b.dataset.t));
  }
  function cmTab(t) {
    current = t;
    panel.classList.toggle("cm-tab", t !== "chat");
    document.getElementById("cmTitle").textContent = t === "chat" ? cmTitleText() : { plans: "Plans", code: "Code", projects: "Projects" }[t] || "";
    if (t !== "chat") { view.innerHTML = ""; try { window.cmTabs[t]?.(view); } catch (e) { view.textContent = "Could not open this: " + e.message; } }
    cmNavPaint();
  }
  window.cmTab = cmTab;

  // ── keep the header in step with the chat ─────────────────────────────────────────────────────────────────────
  function cmTitleText() {
    const first = msgs.querySelector(".ch-msg.user");
    const t = (first?.textContent || "").trim().replace(/\s+/g, " ");
    return t ? (t.length > 34 ? t.slice(0, 33) + "…" : t) : "New chat";
  }
  function cmSync() {
    const empty = panel.classList.contains("empty");
    ta.placeholder = empty ? "Type or hold to talk" : "Reply or hold to talk";
    if (current === "chat") document.getElementById("cmTitle").textContent = cmTitleText();
    cmNavPaint();
  }
  if (typeof chSyncEmpty === "function") {
    const orig = chSyncEmpty;
    window.chSyncEmpty = function () { orig(); cmSync(); };
  }
  window.addEventListener("hashchange", () => { if (current !== "chat") cmTab("chat"); });
  cmSync();
  window.cmRepaint = cmSync;
})();
