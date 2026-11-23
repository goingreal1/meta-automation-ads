// Revora dashboard, part 28: CHAT APP LOOK (Claude-mobile style chat screen)
// Restyles the Assistant tab: a calm greeting, a pill composer (plus, hold-to-talk mic, send), a header with a hamburger that goes
// back to Overview, and a pill bar Chat / Plans / Code / Projects. On phones it fills the whole screen edge to edge.
// The chat logic (22-ai-chat.js, 27-chat-cards.js) is unchanged and every confirm card still works the same: nothing runs without a tap.
// Add ?classic=1 to the address to get the old look back.
(function () {
  if (/[?&]classic=1/.test(location.search)) return;
  const panel = document.getElementById("chatPanel");
  if (!panel) return;
  panel.classList.add("cm");

  // fonts: Newsreader for the greeting and the assistant's words, Inter for the rest
  try {
    const l = document.createElement("link"); l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap";
    document.head.appendChild(l);
  } catch {}

  const css = `
  /* warm colours, only inside this screen (dark mode gets matching dark ones) */
  #chatPanel.cm{--bg:#faf9f5;--panel:#ffffff;--panel2:#f1efe7;--hover:#eceae1;--border:#ebe8df;--borderStrong:#e3dfd3;--text:#14130f;--text2:#3f3c34;--muted:#6a665b;--accent:#1877F2;--cm-serif:Newsreader,'Iowan Old Style',Georgia,serif;--cm-sans:Inter,system-ui,-apple-system,'Segoe UI',sans-serif}
  [data-theme="dark"] #chatPanel.cm{--bg:#151412;--panel:#1f1e1b;--panel2:#272622;--hover:#2d2b27;--border:#34322c;--borderStrong:#3d3b34;--text:#f4f2ea;--text2:#cfcabd;--muted:#a09b8e}
  .cm-head,.cm-star,.cm-nav,#cmView{display:none}
  /* full screen on phones and tablets, edge to edge */
  #chatPanel.cm.page{font-family:var(--cm-sans);background:var(--bg);color:var(--text);overflow-x:hidden;max-width:100vw}
  @media (max-width:1000px){
    #chatPanel.cm.page{position:fixed;inset:0;left:0 !important;top:0 !important;right:0;bottom:0;width:100%;height:100vh;height:100dvh;max-width:none;z-index:1200}
    body.assist-on .bottom-nav{display:none !important}
    body.assist-on{overflow:hidden;max-width:100vw}
  }
  #chatPanel.cm.page,#chatPanel.cm.page.empty{padding:0 !important;overflow:hidden}
  #chatPanel.cm.page .cm-head{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;margin:0;padding:calc(10px + env(safe-area-inset-top)) 16px 6px;box-sizing:border-box}
  #chatPanel.cm.page .ch-head,#chatPanel.cm.page .ch-suggs{display:none !important}
  #chatPanel.cm.page .ch-acct{width:100%;margin:0;padding:0 16px 4px;box-sizing:border-box;font-size:12px;color:var(--muted);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:transparent;border:0}
  #chatPanel.cm.page.empty .ch-acct{display:none}
  .cm-rb{width:44px;height:44px;border-radius:99px;background:var(--panel);border:1px solid var(--border);box-shadow:0 2px 10px rgba(20,19,15,.06);display:flex;align-items:center;justify-content:center;flex:none;cursor:pointer;color:var(--text);padding:0}
  .cm-rb svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  #cmTitle{flex:1;text-align:center;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  #chatPanel.cm.page.cm-tab #cmTitle{font-size:17px;font-weight:700}
  #chatPanel.cm.page.empty:not(.cm-tab) #cmTitle,#chatPanel.cm.page.empty:not(.cm-tab) #cmNew{visibility:hidden}
  /* new chat: lots of air, greeting in the middle, composer and bar at the bottom */
  #chatPanel.cm.page.empty{justify-content:flex-start}
  #chatPanel.cm.page.empty .ch-msgs{flex:1;order:0;width:100%;margin:0;display:flex;flex-direction:column;justify-content:center;align-items:center;overflow:hidden;padding:0 24px 40px;box-sizing:border-box}
  #chatPanel.cm.page.empty .cm-star{display:block;margin:0 auto 20px}
  #chatPanel.cm.page.empty .ch-hello{display:block;font-family:var(--cm-serif);font-weight:400;font-size:clamp(26px,8vw,36px);line-height:1.2;letter-spacing:-.01em;text-align:center;margin:0;color:var(--text)}
  #chatPanel.cm.page.empty #chWelcomeMsg,#chatPanel.cm.page #chWelcomeMsg{display:none}
  #chatPanel.cm.page.empty .ch-inp{order:2}
  /* ongoing chat */
  #chatPanel.cm.page .ch-msgs{width:100%;margin:0;padding:8px 16px;box-sizing:border-box;gap:0}
  #chatPanel.cm.page .ch-msg{max-width:100%;box-sizing:border-box}
  #chatPanel.cm.page .ch-msg.bot{font-family:var(--cm-serif);font-size:17px;line-height:1.5;color:var(--text);font-weight:400;text-align:left;align-self:stretch;margin:0 0 16px;padding:0;background:transparent;box-shadow:none}
  #chatPanel.cm.page .ch-msg.bot b{font-weight:600}
  #chatPanel.cm.page .ch-msg.user{background:var(--hover);color:var(--text);border-radius:20px 20px 6px 20px;font-family:var(--cm-sans);font-size:15px;line-height:1.4;padding:11px 14px;box-shadow:none;max-width:84%;margin:0 0 16px}
  #chatPanel.cm.page .cc,#chatPanel.cm.page .ch-pay-card,#chatPanel.cm.page .ch-act-card{max-width:100%;box-sizing:border-box;font-family:var(--cm-sans)}
  /* composer pill */
  #chatPanel.cm.page .ch-inp{display:flex;align-items:center;gap:6px;width:auto;margin:0 16px;padding:7px;border:1px solid var(--border);border-radius:30px;background:var(--panel);box-shadow:0 4px 18px rgba(20,19,15,.07);position:relative;box-sizing:border-box}
  #chatPanel.cm.page .ch-inp textarea{flex:1;min-width:0;min-height:40px;max-height:140px;padding:10px 4px;border:0;background:transparent;box-shadow:none;border-radius:0;font-family:var(--cm-sans);font-size:16px;color:var(--text)}
  #chatPanel.cm.page .ch-inp textarea:focus{box-shadow:none;border:0}
  #chatPanel.cm.page .ch-inp textarea::placeholder{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}
  #chatPanel.cm.page .ch-inp button{position:static;width:44px;height:44px;border-radius:99px;flex:none;background:var(--text);color:var(--bg);font-size:20px;bottom:auto;right:auto}
  #chatPanel.cm.page .ch-inp button:disabled{background:var(--border)}
  #chatPanel.cm.page .ch-inp .cm-sm{width:40px;height:40px;background:var(--panel2);color:var(--text);display:flex;align-items:center;justify-content:center}
  .cm-sm svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  #chatPanel.cm.page .ch-inp .cm-sm.rec{background:#d93025;color:#fff}
  #cmPlus{position:absolute;left:12px;bottom:64px;background:var(--panel);border:1px solid var(--border);border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.14);padding:6px;display:none;z-index:5}
  #cmPlus button{display:block;width:100%;text-align:left;background:none;border:0;padding:12px 14px;border-radius:10px;font:inherit;font-size:14px;color:var(--text);cursor:pointer;min-height:44px}
  #cmPlus button:hover{background:var(--hover)}
  /* pill bar */
  #chatPanel.cm.page .cm-nav.on{display:flex;gap:4px;order:9;margin:10px 16px calc(14px + env(safe-area-inset-bottom));padding:6px;background:var(--panel);border:1px solid var(--border);border-radius:34px;box-shadow:0 4px 18px rgba(20,19,15,.07);box-sizing:border-box;align-self:stretch}
  .cm-nav button{flex:1;min-height:44px;border:0;background:none;border-radius:28px;font:inherit;font-family:var(--cm-sans);font-size:12px;font-weight:600;color:var(--text2);padding:6px 0 5px;cursor:pointer}
  .cm-nav button svg{display:block;margin:0 auto 2px;width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
  .cm-nav button[aria-current=page]{background:#eceae1;color:#14130f}
  [data-theme="dark"] .cm-nav button[aria-current=page]{background:var(--hover);color:var(--text)}
  #chatPanel.cm.page.cm-tab .ch-msgs,#chatPanel.cm.page.cm-tab .ch-inp,#chatPanel.cm.page.cm-tab .ch-acct{display:none !important}
  #chatPanel.cm.page.cm-tab #cmView{display:block;flex:1;overflow-y:auto;width:100%;margin:0;padding:0 0 8px;-webkit-overflow-scrolling:touch}
  /* big screens: keep a comfortable centred column */
  @media (min-width:1001px){
    #chatPanel.cm.page .cm-head,#chatPanel.cm.page .ch-msgs,#chatPanel.cm.page.cm-tab #cmView{width:min(780px,100%);margin-left:auto;margin-right:auto}
    #chatPanel.cm.page .ch-inp{width:min(748px,calc(100% - 32px));margin:0 auto}
    #chatPanel.cm.page .cm-nav.on{width:min(520px,calc(100% - 32px));align-self:center}
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

  // header: hamburger (to Overview) on the left, title in the middle, new chat (or "new" on a tab) on the right
  const head = document.createElement("div"); head.className = "cm-head";
  head.innerHTML = `<button type="button" class="cm-rb" id="cmHome" aria-label="Back to Overview">${I.menu}</button><div id="cmTitle">New chat</div><button type="button" class="cm-rb" id="cmNew" aria-label="New chat">${I.pen}</button>`;
  panel.insertBefore(head, panel.firstChild);
  document.getElementById("cmHome").onclick = () => { cmTab("chat"); document.querySelector('.tab-btn[data-tab="overview"]')?.click(); };
  const NEW = {
    chat: ["New chat", I.pen, () => { chNew(); }],
    plans: ["New plan by chat", I.plus, () => { cmTab("chat"); askChat("Plan a campaign for one of my products. Ask me what you need.", "Plan a campaign"); }],
    code: ["New site by chat", I.plus, () => { cmTab("chat"); askChat("Build a sales page for one of my products. Ask me which product.", "Build a sales page"); }],
    projects: ["Start something new", I.plus, () => { cmTab("chat"); }],
  };
  document.getElementById("cmNew").onclick = () => NEW[current][2]();

  const msgs = document.getElementById("chMsgs");
  const star = document.createElement("div"); star.className = "cm-star";
  star.innerHTML = '<svg width="54" height="54" viewBox="0 0 54 54" aria-hidden="true"><g stroke="#1877F2" stroke-width="4" stroke-linecap="round"><path d="M27 4v14M27 36v14M4 27h14M36 27h14M11 11l10 10M33 33l10 10M43 11L33 21M21 33L11 43"/></g></svg>';
  msgs.insertBefore(star, msgs.firstChild);

  // composer: plus, hold-to-talk, send
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

  // pill bar and tabs (Plans, Code and Projects are added by 29-chat-tabs.js through window.cmTabs)
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
    const n = document.getElementById("cmNew"); n.innerHTML = NEW[t][1]; n.setAttribute("aria-label", NEW[t][0]);
    document.getElementById("cmTitle").textContent = t === "chat" ? cmTitleText() : { plans: "Plans", code: "Code", projects: "Projects" }[t] || "";
    if (t !== "chat") { view.innerHTML = ""; try { window.cmTabs[t]?.(view); } catch (e) { view.textContent = "Could not open this: " + e.message; } }
    cmNavPaint();
  }
  window.cmTab = cmTab;

  function cmTitleText() {
    const first = msgs.querySelector(".ch-msg.user");
    const t = (first?.textContent || "").trim().replace(/\s+/g, " ");
    return t ? (t.length > 34 ? t.slice(0, 33) + "…" : t) : "New chat";
  }
  // "Empty" means nothing has been said at all (a message that arrived by itself also counts as a chat), so the greeting never sits on top of a message
  function cmSync() {
    const has = !!msgs.querySelector(".ch-msg:not(#chWelcomeMsg), .cc");
    panel.classList.toggle("empty", !has);
    ta.placeholder = has ? "Reply or hold to talk" : "Type or hold to talk";
    if (current === "chat") document.getElementById("cmTitle").textContent = cmTitleText();
    cmNavPaint();
  }
  if (typeof chSyncEmpty === "function") {
    const orig = chSyncEmpty;
    window.chSyncEmpty = function () { orig(); cmSync(); };
  }
  // the greeting is one calm line ("Good afternoon, Name"); it wraps by itself on a narrow screen
  window.addEventListener("hashchange", () => { if (current !== "chat") cmTab("chat"); });
  cmSync();
  window.cmRepaint = cmSync;
})();
