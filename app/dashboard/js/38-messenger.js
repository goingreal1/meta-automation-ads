// Revora dashboard, part 38: MESSENGER chats inside the Inbox.
// Chats are synced every 2 minutes from each Page's Messenger inbox (channel_threads / channel_messages). They show in the same list as WhatsApp,
// with a Messenger badge. Opening one shows the conversation; replying sends through the Page (page-tools messenger_send).
(function () {
  const MX = { threads: [], last: {}, timer: 0 };
  const esc = (s) => (typeof escH === "function" ? escH(s) : String(s ?? ""));
  const css = `
  #mxThreadMsgs{padding:8px 16px 6px;display:flex;flex-direction:column;gap:6px;flex:1;min-height:0;overflow-y:auto;background:var(--bg)}
  #mxThreadMsgs .bubble{max-width:82%;box-shadow:none;font-size:15px;line-height:1.42;border-radius:16px;padding:10px 13px;white-space:pre-wrap;overflow-wrap:anywhere}
  #mxThreadMsgs .bubble.in{align-self:flex-start;background:var(--panel);color:var(--text);border:1px solid var(--border);border-top-left-radius:5px}
  #mxThreadMsgs .bubble.out{align-self:flex-end;background:var(--text);color:var(--panel);border:1px solid var(--text);border-top-right-radius:5px}
  #mxThreadMsgs .bubble small{display:block;font-size:11px;opacity:.65;margin-top:3px;text-align:right}
  .mx-compose{display:flex;gap:8px;align-items:flex-end;padding:10px 12px;background:var(--panel);border-top:1px solid var(--border);flex:none}
  .mx-compose textarea{flex:1;min-height:46px;max-height:140px;border:1px solid var(--border);border-radius:23px;padding:12px 16px;background:var(--panel2);color:var(--text);font:inherit;font-size:16px;line-height:1.35;resize:none;box-sizing:border-box}
  .mx-send{width:46px;height:46px;border-radius:50%;border:0;background:#2447d6;color:#fff;display:flex;align-items:center;justify-content:center;flex:none;cursor:pointer;padding:0}
  .mx-send:disabled{opacity:.5}.mx-send svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .mx-empty{padding:40px 24px;text-align:center;color:var(--text2);font-size:15px}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  const needs = (t) => MX.last[t.id] && MX.last[t.id].direction === "inbound";
  async function load() {
    const t = await sbQuery("channel_threads", "select=*&order=last_message_at.desc&limit=150").catch(() => []);
    MX.threads = t || [];
    MX.last = {};
    if (MX.threads.length) {
      const ms = await sbQuery("channel_messages", "select=thread_id,direction,content,created_at&order=created_at.desc&limit=400").catch(() => []);
      (ms || []).forEach((m) => { if (!MX.last[m.thread_id]) MX.last[m.thread_id] = m; });
    }
  }
  window.ixLoadExtra = load;
  window.ixExtraNeeds = () => MX.threads.filter(needs).length;
  window.ixExtraItems = function (now) {
    if (typeof bvSelectedNumberId !== "undefined" && bvSelectedNumberId) return [];   // a WhatsApp number is picked: show only that number's chats
    const q = (document.getElementById("convSearch") && document.getElementById("convSearch").value || "").toLowerCase();
    const K = window.ixKit; if (!K) return [];
    return MX.threads.filter((t) => {
      if (typeof bvListFilter !== "undefined") {
        if (bvListFilter === "needs" && !needs(t)) return false;
        if (bvListFilter === "unread" && !(t.unread_count > 0)) return false;
        if (bvListFilter === "handoff") return false;
      }
      return !q || String(t.name || "").toLowerCase().includes(q);
    }).map((t) => {
      const l = MX.last[t.id], at = Date.parse((l && l.created_at) || t.last_message_at) || 0, n = needs(t);
      return { t: at, needs: n, html: K.row({ ch: "ms", ini: K.ini(t.name), name: t.name || "Messenger user", un: t.unread_count > 0 || n, wait: n, time: n ? K.wait(now - at) : (typeof bvListTime === "function" ? bvListTime((l && l.created_at) || t.last_message_at) : ""), text: l ? ((l.direction === "outbound" ? "You: " : "") + (l.content || "")) : "", tags: [K.pageName(t.page_id)], cnt: t.unread_count, click: `mxOpen('${t.id}')`, active: false }) };
    });
  };

  function windowBar(t) {
    const at = t.last_inbound_at && Date.parse(t.last_inbound_at);
    const clock = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    if (!at) return { cls: "warn", html: clock + "<span>They have not written to the Page yet.</span>", blocked: true };
    const h = (Date.now() - at) / 3600000;
    if (h < 24) { const left = 24 * 3600000 - (Date.now() - at), hh = Math.floor(left / 3600000), mm = Math.floor((left % 3600000) / 60000); return { cls: "", html: clock + `<span>You can reply freely for ${hh ? hh + " h " : ""}${mm} min.</span>`, blocked: false }; }
    if (h < 168) return { cls: "warn", html: clock + "<span>More than 24 hours since they wrote. Meta may only allow a late reply for some accounts.</span>", blocked: false };
    return { cls: "warn", html: clock + "<span>More than 7 days since they wrote. Messenger only lets you reply after they message the Page again.</span>", blocked: true };
  }
  const bubble = (m) => `<div class="bubble ${m.direction === "outbound" ? "out" : "in"}">${esc(m.content || "[attachment]")}<small>${esc(typeof bvListTime === "function" ? bvListTime(m.created_at) : "")}</small></div>`;

  window.mxOpen = async function (id) {
    const t = MX.threads.find((x) => x.id === id); if (!t) return;
    const root = document.getElementById("convTabRoot"), th = document.getElementById("convThread"); if (!root || !th) return;
    if (typeof bvSelectedConvId !== "undefined") bvSelectedConvId = null;
    root.classList.add("thread-open");
    th.innerHTML = `<div class="mx-empty">Loading…</div>`;
    const msgs = (await sbQuery("channel_messages", `select=*&thread_id=eq.${id}&order=created_at.asc&limit=300`).catch(() => [])) || [];
    const K = window.ixKit, w = windowBar(t);
    th.innerHTML = `<div class="conv-thread-head ch2"><button type="button" class="conv-back-btn" onclick="bvBackToList()" aria-label="Back to inbox"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>
        <div class="ch2-av"><div class="ch2-ini">${esc(K ? K.ini(t.name) : "?")}</div>${K ? K.badge("ms") : ""}</div>
        <div class="ch2-nm"><b>${esc(t.name || "Messenger user")}</b><span>Messenger${K ? " · " + esc(K.pageName(t.page_id)) : ""}</span></div></div>
      <div id="mxThreadMsgs">${msgs.length ? msgs.map(bubble).join("") : '<div class="mx-empty">No messages yet.</div>'}</div>
      <div class="ch2-win ${w.cls}">${w.html}</div>
      <div class="mx-compose"><textarea id="mxInput" rows="1" placeholder="${w.blocked ? "You cannot reply yet" : "Reply on Messenger…"}" ${w.blocked ? "disabled" : ""}></textarea>
        <button type="button" class="mx-send" id="mxSend" aria-label="Send" ${w.blocked ? "disabled" : ""}><svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-3-7z"/></svg></button></div>`;
    const list = th.querySelector("#mxThreadMsgs"); list.scrollTop = list.scrollHeight;
    const input = th.querySelector("#mxInput"), btn = th.querySelector("#mxSend");
    const send = async () => {
      const text = input.value.trim(); if (!text || btn.disabled) return;
      btn.disabled = true; input.disabled = true;
      const r = await sbFn("page-tools", { action: "messenger_send", thread_id: id, text, ad_account_id: undefined }).catch(() => null);
      input.disabled = false; btn.disabled = false;
      if (r && r.ok) { input.value = ""; list.insertAdjacentHTML("beforeend", bubble({ direction: "outbound", content: text, created_at: new Date().toISOString() })); list.scrollTop = list.scrollHeight; t.last_message_at = new Date().toISOString(); MX.last[id] = { direction: "outbound", content: text, created_at: t.last_message_at, thread_id: id }; }
      else if (typeof bvToast === "function") bvToast((r && r.error) || "Could not send that.", "err");
    };
    btn.onclick = send;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && window.innerWidth > 820) { e.preventDefault(); send(); } });
    if (t.unread_count > 0) { t.unread_count = 0; sbFn("page-tools", { action: "messenger_read", thread_id: id, ad_account_id: undefined }).catch(() => {}); if (K) K.chrome(); }
    try { if (window.innerWidth <= 820 && !(history.state && history.state.ixChat)) history.pushState({ ixChat: id }, ""); } catch (_) { /* history is optional */ }
  };

  // Keep the list fresh while the Inbox is open (the server syncs every 2 minutes).
  MX.timer = setInterval(async () => {
    if (!document.getElementById("convListItems") || document.hidden) return;
    const root = document.getElementById("convTabRoot");
    if (root && root.classList.contains("thread-open")) return;
    await load(); if (typeof bvFilterList === "function") bvFilterList(); if (window.ixKit) window.ixKit.chrome();
  }, 60000);
})();
